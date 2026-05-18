/**
 * RvmPcfEmitter.js
 *
 * Phase 4 PCF emitter hardening.
 * Inputs: Final 2D CSV row objects.
 * Outputs: PCF text grouped by pipeline reference, plus structured errors/warnings.
 * Fallback: partial mode skips invalid blocks; missing coordinates are never emitted as origin.
 */

function _clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function _isFiniteCoord(pt) {
  if (!pt || typeof pt !== 'object') return false;

  return (
    Number.isFinite(Number(pt.x)) &&
    Number.isFinite(Number(pt.y)) &&
    Number.isFinite(Number(pt.z))
  );
}

function _fmtCoord(pt) {
  if (!_isFiniteCoord(pt)) return null;

  return [
    Number(pt.x).toFixed(3),
    Number(pt.y).toFixed(3),
    Number(pt.z).toFixed(3),
  ].join(' ');
}

function _angle(ep1, cp, ep2) {
  if (!_isFiniteCoord(ep1) || !_isFiniteCoord(cp) || !_isFiniteCoord(ep2)) {
    return 90;
  }

  const ax = Number(ep1.x) - Number(cp.x);
  const ay = Number(ep1.y) - Number(cp.y);
  const az = Number(ep1.z) - Number(cp.z);

  const bx = Number(ep2.x) - Number(cp.x);
  const by = Number(ep2.y) - Number(cp.y);
  const bz = Number(ep2.z) - Number(cp.z);

  const dot = ax * bx + ay * by + az * bz;
  const magA = Math.sqrt(ax * ax + ay * ay + az * az);
  const magB = Math.sqrt(bx * bx + by * by + bz * bz);

  if (magA === 0 || magB === 0) return 90;

  const cos = Math.max(-1, Math.min(1, dot / (magA * magB)));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

function _safeText(value) {
  return _clean(value).replace(/[\r\n]+/g, ' ');
}

function _diag(code, message, row, severity = 'ERROR', extra = {}) {
  return {
    severity,
    code,
    message,
    rowNo: row?.rowNo ?? null,
    type: row?.type ?? null,
    pipelineRef: row?.pipelineRef ?? null,
    sourceCanonicalId: row?.sourceCanonicalId ?? null,
    ...extra,
  };
}

function _coordLine(keyword, pt, row, diagnostics, required = true) {
  const formatted = _fmtCoord(pt);

  if (formatted) {
    return `    ${keyword} ${formatted}`;
  }

  const message = `${row?.type || 'ROW'} row ${row?.rowNo ?? '?'} missing ${keyword}`;

  diagnostics.push(
    _diag(
      required ? 'PCF-MISSING-COORDINATE' : 'PCF-OPTIONAL-COORDINATE-MISSING',
      message,
      row,
      required ? 'ERROR' : 'WARNING',
      { keyword }
    )
  );

  return null;
}

function _caLines(ca, options, diagnostics, row) {
  const lines = [];
  const allowed = new Set(options.allowedCaKeys || [
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    '97',
    '98',
  ]);

  for (const [rawKey, rawValue] of Object.entries(ca || {})) {
    const key = String(rawKey).trim();
    const value = _safeText(rawValue);

    if (value === '') continue;

    if (key === '21' && !options.emitSourceCa21) {
      diagnostics.push(
        _diag(
          'PCF-CA21-SUPPRESSED',
          'Source CA21 exists but is suppressed by default. ATTRIBUTE21 is the PCF attribute keyword, not permission to emit source CA21.',
          row,
          'WARNING',
          { ca21: value }
        )
      );
      continue;
    }

    if (!allowed.has(key)) {
      diagnostics.push(
        _diag(
          'PCF-CA-SUPPRESSED',
          `CA${key} suppressed because it is not in the allowed CA export list.`,
          row,
          'INFO',
          { caKey: key }
        )
      );
      continue;
    }

    lines.push(`    ${options.attributeKeyword} CA${key} ${value}`);
  }

  return lines;
}

const PCF_HEADER = pipelineRef => [
  'ISOGEN-FILES ISOGEN.FLS',
  'UNITS-BORE MM',
  'UNITS-CO-ORDS MM',
  'UNITS-WEIGHT KGS',
  'UNITS-BOLT-DIA MM',
  'UNITS-BOLT-LENGTH MM',
  `PIPELINE-REFERENCE ${_safeText(pipelineRef)}`,
  '    PROJECT-IDENTIFIER P1',
  '    AREA A1',
].join('\n');

function _validate(row) {
  const { type, ep1, ep2, cp, bp, supportCoor } = row;
  const errors = [];

  const need = (coord, name) => {
    if (!_isFiniteCoord(coord)) {
      errors.push(
        _diag(
          'MISSING-GEOMETRY',
          `${type} row ${row.rowNo} missing ${name}`,
          row,
          'ERROR',
          { coordinate: name }
        )
      );
    }
  };

  switch (type) {
    case 'PIPE':
      need(ep1, 'ep1');
      need(ep2, 'ep2');
      break;

    case 'BEND':
      need(ep1, 'ep1');
      need(ep2, 'ep2');
      need(cp, 'cp');
      break;

    case 'TEE':
      need(ep1, 'ep1');
      need(ep2, 'ep2');
      need(cp, 'cp');
      need(bp, 'bp');
      break;

    case 'OLET':
      need(cp, 'cp');
      need(bp, 'bp');
      break;

    case 'SUPPORT':
      if (!_isFiniteCoord(supportCoor) && !_isFiniteCoord(cp) && !_isFiniteCoord(ep1)) {
        errors.push(
          _diag(
            'MISSING-GEOMETRY',
            `SUPPORT row ${row.rowNo} missing supportCoor/cp/ep1`,
            row,
            'ERROR',
            { coordinate: 'supportCoor|cp|ep1' }
          )
        );
      }
      break;

    default:
      need(ep1, 'ep1');
      need(ep2, 'ep2');
  }

  return errors;
}

function _emitBlock(row, options, diagnostics) {
  const {
    type,
    skey,
    ca,
    ep1,
    ep2,
    cp,
    bp,
    supportCoor,
    supportName,
    supportGuid,
    pipelineRef,
  } = row;

  const lines = [type];

  const pushRequiredCoord = (keyword, pt) => {
    const line = _coordLine(keyword, pt, row, diagnostics, true);
    if (line) lines.push(line);
  };

  const pushOptionalCoord = (keyword, pt) => {
    const line = _coordLine(keyword, pt, row, diagnostics, false);
    if (line) lines.push(line);
  };

  const pushSkey = () => {
    if (_clean(skey)) {
      lines.push(`    SKEY ${_safeText(skey)}`);
    }
  };

  const pushCa = () => {
    lines.push(..._caLines(ca, options, diagnostics, row));
  };

  switch (type) {
    case 'PIPE':
      pushRequiredCoord('END-POINT', ep1);
      pushRequiredCoord('END-POINT', ep2);
      lines.push(`    PIPELINE-REFERENCE ${_safeText(pipelineRef || 'RVM-EXTRACT')}`);

      if (_clean(skey)) {
        if (options.emitPipeSkey) {
          lines.push(`    SKEY ${_safeText(skey)}`);
        } else {
          diagnostics.push(
            _diag(
              'PCF-PIPE-SKEY-SUPPRESSED',
              'PIPE SKEY suppressed by default.',
              row,
              'WARNING',
              { skey }
            )
          );
        }
      }

      pushCa();
      break;

    case 'BEND': {
      pushRequiredCoord('END-POINT', ep1);
      pushRequiredCoord('END-POINT', ep2);
      pushRequiredCoord('CENTRE-POINT', cp);
      lines.push(`    ANGLE ${_angle(ep1, cp, ep2)}`);
      pushSkey();
      pushCa();
      break;
    }

    case 'TEE':
      pushRequiredCoord('END-POINT', ep1);
      pushRequiredCoord('END-POINT', ep2);
      pushRequiredCoord('CENTRE-POINT', cp);
      pushRequiredCoord('BRANCH1-POINT', bp);
      pushSkey();
      pushCa();
      break;

    case 'OLET':
      pushRequiredCoord('CENTRE-POINT', cp);
      pushRequiredCoord('BRANCH1-POINT', bp);
      pushSkey();
      pushCa();
      break;

    case 'SUPPORT': {
      const coor = supportCoor || cp || ep1;
      pushRequiredCoord('CO-ORDS', coor);

      if (_clean(supportName)) {
        lines.push(`    SUPPORT-NAME ${_safeText(supportName)}`);
      }

      if (_clean(supportGuid)) {
        lines.push(`    SUPPORT-GUID ${_safeText(supportGuid)}`);
      }

      break;
    }

    default:
      pushRequiredCoord('END-POINT', ep1);
      pushRequiredCoord('END-POINT', ep2);
      pushOptionalCoord('CENTRE-POINT', cp);
      pushSkey();
      pushCa();
  }

  return lines.join('\n');
}

export class RvmPcfEmitter {
  constructor(options = {}) {
    this.allowPartialPcf = options.allowPartialPcf === true;

    this.options = {
      emitPipeSkey: options.emitPipeSkey === true,
      emitSourceCa21: options.emitSourceCa21 === true,
      attributeKeyword: options.attributeKeyword || 'ATTRIBUTE21',
      allowedCaKeys: options.allowedCaKeys || [
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '97',
        '98',
      ],
    };
  }

  emit(rows) {
    const errors = [];
    const warnings = [];

    const includedRows = (rows || []).filter(row => row.include !== false);

    for (const row of includedRows) {
      errors.push(..._validate(row));
    }

    if (errors.length > 0 && !this.allowPartialPcf) {
      return {
        pcfTextByPipelineRef: {},
        errors,
        warnings,
      };
    }

    const groups = new Map();

    for (const row of includedRows) {
      const ref = row.pipelineRef || 'RVM-EXTRACT';

      if (!groups.has(ref)) {
        groups.set(ref, []);
      }

      groups.get(ref).push(row);
    }

    const pcfTextByPipelineRef = {};

    for (const [ref, refRows] of groups) {
      const blocks = [PCF_HEADER(ref)];

      for (const row of refRows) {
        const rowErrors = _validate(row);

        if (rowErrors.length > 0) {
          if (this.allowPartialPcf) {
            warnings.push(
              _diag(
                'PCF-BLOCK-SKIPPED-PARTIAL',
                `${row.type} row ${row.rowNo} skipped because required geometry is missing.`,
                row,
                'WARNING',
                { rowErrors }
              )
            );
            continue;
          }

          continue;
        }

        const blockDiagnostics = [];
        const block = _emitBlock(row, this.options, blockDiagnostics);

        for (const diag of blockDiagnostics) {
          if (diag.severity === 'ERROR') {
            errors.push(diag);
          } else {
            warnings.push(diag);
          }
        }

        blocks.push(block);
      }

      pcfTextByPipelineRef[ref] = `${blocks.join('\n')}\n`;
    }

    return {
      pcfTextByPipelineRef,
      errors,
      warnings,
    };
  }
}
