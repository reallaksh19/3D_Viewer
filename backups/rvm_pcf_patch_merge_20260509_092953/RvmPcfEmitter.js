function _fmtCoord(pt) {
  if (!pt) return '0.000 0.000 0.000';
  return `${Number(pt.x || 0).toFixed(3)} ${Number(pt.y || 0).toFixed(3)} ${Number(pt.z || 0).toFixed(3)}`;
}

function _angle(ep1, cp, ep2) {
  if (!ep1 || !cp || !ep2) return 90;
  const ax = ep1.x - cp.x, ay = ep1.y - cp.y, az = ep1.z - cp.z;
  const bx = ep2.x - cp.x, by = ep2.y - cp.y, bz = ep2.z - cp.z;
  const dot = ax * bx + ay * by + az * bz;
  const magA = Math.sqrt(ax * ax + ay * ay + az * az);
  const magB = Math.sqrt(bx * bx + by * by + bz * bz);
  if (magA === 0 || magB === 0) return 90;
  const cos = Math.max(-1, Math.min(1, dot / (magA * magB)));
  return Math.round(Math.acos(cos) * 180 / Math.PI);
}

function _caLines(ca) {
  const lines = [];
  const allowed = new Set(['1','2','3','4','5','6','7','8','9','10','97','98']);
  for (const [k, v] of Object.entries(ca || {})) {
    if (allowed.has(String(k)) && v != null) {
      lines.push(`    ATTRIBUTE21 CA${k} ${v}`);
    }
  }
  return lines;
}

const PCF_HEADER = (pipelineRef) => [
  'ISOGEN-FILES ISOGEN.FLS',
  'UNITS-BORE MM',
  'UNITS-CO-ORDS MM',
  'UNITS-WEIGHT KGS',
  'UNITS-BOLT-DIA MM',
  'UNITS-BOLT-LENGTH MM',
  `PIPELINE-REFERENCE ${pipelineRef}`,
  '    PROJECT-IDENTIFIER P1',
  '    AREA A1',
].join('\n');

function _emitBlock(row) {
  const { type, skey, ca, ep1, ep2, cp, bp, supportCoor, supportName, supportGuid, pipelineRef } = row;
  const lines = [type];

  switch (type) {
    case 'PIPE':
      lines.push(`    END-POINT ${_fmtCoord(ep1)}`);
      lines.push(`    END-POINT ${_fmtCoord(ep2)}`);
      lines.push(`    PIPELINE-REFERENCE ${pipelineRef}`);
      if (skey) lines.push(`    SKEY ${skey}`);
      lines.push(..._caLines(ca));
      break;

    case 'BEND': {
      const ang = _angle(ep1, cp, ep2);
      lines.push(`    END-POINT ${_fmtCoord(ep1)}`);
      lines.push(`    END-POINT ${_fmtCoord(ep2)}`);
      lines.push(`    CENTRE-POINT ${_fmtCoord(cp)}`);
      lines.push(`    ANGLE ${ang}`);
      if (skey) lines.push(`    SKEY ${skey}`);
      lines.push(..._caLines(ca));
      break;
    }

    case 'TEE':
      lines.push(`    END-POINT ${_fmtCoord(ep1)}`);
      lines.push(`    END-POINT ${_fmtCoord(ep2)}`);
      lines.push(`    CENTRE-POINT ${_fmtCoord(cp)}`);
      lines.push(`    BRANCH1-POINT ${_fmtCoord(bp)}`);
      if (skey) lines.push(`    SKEY ${skey}`);
      lines.push(..._caLines(ca));
      break;

    case 'OLET':
      lines.push(`    CENTRE-POINT ${_fmtCoord(cp)}`);
      lines.push(`    BRANCH1-POINT ${_fmtCoord(bp)}`);
      if (skey) lines.push(`    SKEY ${skey}`);
      lines.push(..._caLines(ca));
      break;

    case 'SUPPORT': {
      const coor = supportCoor || cp || ep1;
      lines.push(`    CO-ORDS ${_fmtCoord(coor)}`);
      if (supportName) lines.push(`    SUPPORT-NAME ${supportName}`);
      if (supportGuid) lines.push(`    SUPPORT-GUID ${supportGuid}`);
      break;
    }

    default:
      // VALVE, FLANGE, REDUCER-CONCENTRIC, REDUCER-ECCENTRIC
      lines.push(`    END-POINT ${_fmtCoord(ep1)}`);
      lines.push(`    END-POINT ${_fmtCoord(ep2)}`);
      if (skey) lines.push(`    SKEY ${skey}`);
      lines.push(..._caLines(ca));
  }

  return lines.join('\n');
}

function _validate(row) {
  const { type, ep1, ep2, cp, bp, supportCoor } = row;
  const errors = [];

  const need = (coord, name) => {
    if (!coord) errors.push({ code: 'MISSING-GEOMETRY', message: `${type} row ${row.rowNo} missing ${name}`, rowNo: row.rowNo, type });
  };

  switch (type) {
    case 'PIPE':
      need(ep1, 'ep1'); need(ep2, 'ep2'); break;
    case 'BEND':
      need(ep1, 'ep1'); need(ep2, 'ep2'); need(cp, 'cp'); break;
    case 'TEE':
      need(ep1, 'ep1'); need(ep2, 'ep2'); need(cp, 'cp'); need(bp, 'bp'); break;
    case 'OLET':
      need(cp, 'cp'); need(bp, 'bp'); break;
    case 'SUPPORT':
      if (!supportCoor && !cp && !ep1) errors.push({ code: 'MISSING-GEOMETRY', message: `SUPPORT row ${row.rowNo} missing supportCoor/cp/ep1`, rowNo: row.rowNo, type }); break;
    default:
      need(ep1, 'ep1'); need(ep2, 'ep2');
  }

  return errors;
}

export class RvmPcfEmitter {
  constructor(options = {}) {
    this.allowPartialPcf = options.allowPartialPcf !== false ? options.allowPartialPcf : false;
  }

  emit(rows) {
    const errors = [];
    const warnings = [];

    const includedRows = rows.filter((r) => r.include !== false);

    // Validate all
    for (const row of includedRows) {
      errors.push(..._validate(row));
    }

    if (errors.length > 0 && !this.allowPartialPcf) {
      return { pcfTextByPipelineRef: {}, errors, warnings };
    }

    // Group by pipelineRef
    const groups = new Map();
    for (const row of includedRows) {
      const ref = row.pipelineRef || 'RVM-EXTRACT';
      if (!groups.has(ref)) groups.set(ref, []);
      groups.get(ref).push(row);
    }

    const pcfTextByPipelineRef = {};
    for (const [ref, refRows] of groups) {
      const blocks = [PCF_HEADER(ref)];
      for (const row of refRows) {
        const rowErrors = _validate(row);
        if (rowErrors.length > 0 && !this.allowPartialPcf) continue;
        blocks.push(_emitBlock(row));
      }
      pcfTextByPipelineRef[ref] = blocks.join('\n') + '\n';
    }

    return { pcfTextByPipelineRef, errors, warnings };
  }
}
