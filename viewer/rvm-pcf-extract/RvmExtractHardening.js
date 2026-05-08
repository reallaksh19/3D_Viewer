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
