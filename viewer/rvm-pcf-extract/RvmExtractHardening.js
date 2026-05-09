const NPS_TO_MM = {
  '1/2': 15, '3/4': 20, '1': 25, '1-1/4': 32, '1-1/2': 40,
  '2': 50, '2-1/2': 65, '3': 80, '3-1/2': 90, '4': 100,
  '5': 125, '6': 150, '8': 200, '10': 250, '12': 300,
  '14': 350, '16': 400, '18': 450, '20': 500, '24': 600,
  '30': 750, '36': 900, '42': 1050, '48': 1200,
};

function _clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function _hasCoord(value) {
  if (!value || typeof value !== 'object') return false;
  return Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z));
}

function _safePcfFilename(ref) {
  return `${_clean(ref || 'RVM-EXTRACT').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')}.pcf`;
}

export class RvmExtractHardening {
  // ── Deterministic row order ──────────────────────────────────────────────
  sortRows(rows) {
    rows.sort((a, b) => {
      const r = (a.pipelineRef || '').localeCompare(b.pipelineRef || '');
      if (r !== 0) return r;
      const s = (a.sourcePath || '').localeCompare(b.sourcePath || '');
      if (s !== 0) return s;
      const t = (a.type || '').localeCompare(b.type || '');
      if (t !== 0) return t;
      return (a.sourceCanonicalId || '').localeCompare(b.sourceCanonicalId || '');
    });
    rows.forEach((row, i) => {
      row.rowNo = (i + 1) * 10;
      if (row.ca && row.ca['98'] != null) {
        // keep existing ca98
      } else {
        if (!row.ca) row.ca = {};
        row.ca['98'] = row.rowNo;
      }
    });
    return rows;
  }

  // ── Masters import/export ───────────────────────────────────────────────
  exportMasters(masters) {
    return {
      schema: 'rvm-json-pcf-extract-masters/v1',
      exportedAt: new Date().toISOString(),
      masters,
    };
  }

  importMasters(jsonStringOrObj) {
    try {
      let parsed = typeof jsonStringOrObj === 'string' ? JSON.parse(jsonStringOrObj) : jsonStringOrObj;
      if (parsed && parsed.masters) return { masters: parsed.masters, diagnostics: [] };
      if (parsed && typeof parsed === 'object') return { masters: parsed, diagnostics: [] };
      return { masters: null, diagnostics: ['MASTERS-IMPORT-FAILED'] };
    } catch (e) {
      return { masters: null, diagnostics: ['MASTERS-IMPORT-FAILED'] };
    }
  }

  // ── Valve ambiguity resolution ──────────────────────────────────────────
  resolveValveAmbiguity(rows, rowNo, candidateIndex) {
    const row = rows.find(r => r.rowNo === rowNo);
    if (!row) return { resolved: false, row: null };
    const requests = row.ambiguousValveWeightRequests;
    if (!requests || !requests.length) return { resolved: false, row };
    const candidates = requests[0].candidates;
    if (!candidates || candidateIndex >= candidates.length) return { resolved: false, row };
    if (!row.ca) row.ca = {};
    row.ca['8'] = candidates[candidateIndex].weight;
    row.ambiguousValveWeightRequests = [];
    row.valveWeightSource = 'WM-VALVE-CA8-RESOLVED';
    return { resolved: true, row };
  }

  // ── Phase 1 PCF audit helpers ───────────────────────────────────────────
  parseLineKeyBoreMm(value) {
    const text = _clean(value).toUpperCase();
    if (!text) return null;
    const directDn = text.match(/(?:^|[^A-Z0-9])DN\s*([0-9]{2,4})(?:[^0-9]|$)/);
    if (directDn) return Number(directDn[1]);
    const delimited = text.match(/(?:^|[-_\s])([0-9]{1,2}(?:-[0-9]\/[0-9]|\/[0-9])?)(?=[-_\s])/);
    if (delimited && NPS_TO_MM[delimited[1]] != null) return NPS_TO_MM[delimited[1]];
    const explicit = text.match(/(?:NPS|SIZE|BORE)\s*[-:=]?\s*([0-9]{1,2}(?:-[0-9]\/[0-9]|\/[0-9])?)/);
    if (explicit && NPS_TO_MM[explicit[1]] != null) return NPS_TO_MM[explicit[1]];
    return null;
  }

  buildPcfAuditReport(rows = [], pcfTextByPipelineRef = {}, sourceLabel = '') {
    const diagnostics = [];
    const summary = {
      rowCount: rows.length,
      includedRows: 0,
      excludedRows: 0,
      missingCoordinateRows: 0,
      rowsWithPipeSkey: 0,
      rowsWithCa21: 0,
      rowsWithConvertedBore: 0,
      rowsWithLineKeyBoreCandidate: 0,
      pipelineRefs: {},
      componentTypes: {},
      pcfPipelineCount: Object.keys(pcfTextByPipelineRef || {}).length,
      expectedDownloadMode: Object.keys(pcfTextByPipelineRef || {}).length > 1 ? 'zip' : 'single-file',
      pcfFilenames: Object.keys(pcfTextByPipelineRef || {}).map(_safePcfFilename),
      generatedPipeBlocksWithSkey: 0,
      generatedOriginCoordinateLines: 0,
      generatedAttribute21Lines: 0,
    };

    const push = (severity, code, message, row = {}, extra = {}) => diagnostics.push({
      severity, code, message,
      rowNo: row.rowNo ?? null,
      type: row.type ?? null,
      pipelineRef: row.pipelineRef ?? null,
      sourceCanonicalId: row.sourceCanonicalId ?? null,
      ...extra,
    });

    const requiredByType = {
      PIPE: ['ep1', 'ep2'],
      BEND: ['ep1', 'ep2', 'cp'],
      TEE: ['ep1', 'ep2', 'cp', 'bp'],
      OLET: ['cp', 'bp'],
    };

    for (const row of rows) {
      const type = _clean(row.type || 'UNKNOWN').toUpperCase();
      const ref = _clean(row.pipelineRef || 'RVM-EXTRACT');
      summary.componentTypes[type] = (summary.componentTypes[type] || 0) + 1;
      summary.pipelineRefs[ref] = (summary.pipelineRefs[ref] || 0) + 1;
      if (row.include === false) summary.excludedRows += 1; else summary.includedRows += 1;

      const required = requiredByType[type] || (type === 'SUPPORT' ? [] : ['ep1', 'ep2']);
      for (const key of required) {
        if (!_hasCoord(row[key])) {
          summary.missingCoordinateRows += 1;
          push('ERROR', 'PCF-MISSING-COORDINATE', `${type} row missing ${key}`, row, { required: key });
        }
      }
      if (type === 'SUPPORT' && !_hasCoord(row.supportCoor) && !_hasCoord(row.cp) && !_hasCoord(row.ep1)) {
        summary.missingCoordinateRows += 1;
        push('ERROR', 'PCF-MISSING-COORDINATE', 'SUPPORT row missing supportCoor/cp/ep1', row, { required: ['supportCoor', 'cp', 'ep1'] });
      }

      if (type === 'PIPE' && _clean(row.skey)) {
        summary.rowsWithPipeSkey += 1;
        push('WARNING', 'PCF-PIPE-SKEY-RISK', 'PIPE row has SKEY; suppress by default in emitter phase.', row, { skey: row.skey });
      }
      if (row.ca && row.ca['21'] != null) {
        summary.rowsWithCa21 += 1;
        push('WARNING', 'PCF-CA21-SOURCE', 'Source row contains CA21; verify whether this is intended.', row, { ca21: row.ca['21'] });
      }
      if (row.convertedBore != null) summary.rowsWithConvertedBore += 1;
      const parsedLineKeyBore = this.parseLineKeyBoreMm(row.lineKey || row.pipelineRef || row.name || row.sourcePath || '');
      if (parsedLineKeyBore != null) {
        summary.rowsWithLineKeyBoreCandidate += 1;
        if (row.convertedBore == null) {
          push('WARNING', 'PCF-LINEKEY-BORE-NOT-WIRED', 'Line key contains bore candidate but convertedBore is empty.', row, { parsedLineKeyBore });
        }
      }
    }

    for (const [ref, text] of Object.entries(pcfTextByPipelineRef || {})) {
      const body = String(text || '');
      const pipeBlocks = body.split(/\n(?=[A-Z][A-Z0-9-]*\n)/g).filter(block => /^PIPE\s*$/m.test(block));
      const pipeSkeyBlocks = pipeBlocks.filter(block => /^\s*SKEY\s+/m.test(block)).length;
      summary.generatedPipeBlocksWithSkey += pipeSkeyBlocks;
      if (pipeSkeyBlocks) push('WARNING', 'PCF-TEXT-PIPE-SKEY', `Generated PCF ${ref} has PIPE SKEY block(s).`, { pipelineRef: ref });
      const originLines = body.match(/^\s*(END-POINT|CENTRE-POINT|BRANCH1-POINT|CO-ORDS)\s+0\.000\s+0\.000\s+0\.000\s*$/gm) || [];
      summary.generatedOriginCoordinateLines += originLines.length;
      if (originLines.length) push('ERROR', 'PCF-FAKE-ORIGIN-COORDINATE', `Generated PCF ${ref} has origin coordinate line(s).`, { pipelineRef: ref }, { count: originLines.length });
      const attr21 = body.match(/^\s*ATTRIBUTE21\s+/gm) || [];
      summary.generatedAttribute21Lines += attr21.length;
    }

    const bySeverity = diagnostics.reduce((acc, item) => {
      acc[item.severity] = (acc[item.severity] || 0) + 1;
      return acc;
    }, {});
    return {
      schema: 'pcf-extract-audit/v1',
      sourceLabel,
      generatedAt: new Date().toISOString(),
      pass: !bySeverity.ERROR,
      bySeverity,
      summary,
      diagnostics,
    };
  }

  // ── Validation register ─────────────────────────────────────────────────
  buildValidationRegister(rows) {
    const register = [];
    for (const row of rows) {
      const meta = {
        rowNo: row.rowNo,
        type: row.type,
        name: row.name,
        pipelineRef: row.pipelineRef,
        sourceCanonicalId: row.sourceCanonicalId,
      };
      // From diagnostics strings
      if (row.diagnostics && Array.isArray(row.diagnostics)) {
        for (const code of row.diagnostics) {
          register.push({
            severity: this._severity(code),
            code,
            message: code,
            ...meta,
          });
        }
      }
      // From ambiguousValveWeightRequests
      if (row.ambiguousValveWeightRequests && row.ambiguousValveWeightRequests.length) {
        const code = 'WM-VALVE-CA8-AMBIGUOUS';
        register.push({
          severity: this._severity(code),
          code,
          message: `Valve weight ambiguous: ${row.ambiguousValveWeightRequests.length} candidate(s)`,
          ...meta,
        });
      }
    }
    return register;
  }

  _severity(code) {
    if (code.includes('MISSING-GEOMETRY')) return 'ERROR';
    if (code.includes('AMBIGUOUS') || code.includes('UNRESOLVED') || code.includes('INCOMPLETE') || code.includes('NO-MATCH')) return 'WARNING';
    return 'INFO';
  }

  // ── Multiple PCF download ───────────────────────────────────────────────
  downloadAllPcf(pcfTextByPipelineRef) {
    const filenames = Object.keys(pcfTextByPipelineRef).map(ref => `${ref}.pcf`);
    if (typeof document === 'undefined') {
      return filenames;
    }
    filenames.forEach((filename, i) => {
      setTimeout(() => {
        const pipelineRef = Object.keys(pcfTextByPipelineRef)[i];
        const text = pcfTextByPipelineRef[pipelineRef];
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, i * 100);
    });
    return filenames;
  }
}
