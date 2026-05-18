/**
 * RvmValveWeightMapper.js
 * Wave 6 – maps valve CA8 weight using legacy key: VALVE + Bore + Rating + Length.
 * Pure JS: no DOM, no three.js.
 */

export class RvmValveWeightMapper {
  constructor(masters = {}) {
    // masters: { valveWeightMaster: [...rows] }
    // Each master row normalized: { boreMm, ratingClass, lengthMm, valveWeight, valveType, sourceRowIndex, qualityOk }
    this._master = Array.isArray(masters.valveWeightMaster) ? masters.valveWeightMaster : [];
  }

  // ── Length resolution ──────────────────────────────────────────────────────

  _resolveLength(attrs) {
    // Priority 1: direct length fields
    for (const key of ['lengthMm', 'length', 'len']) {
      if (attrs[key] != null && typeof attrs[key] === 'number' && isFinite(attrs[key])) {
        return attrs[key];
      }
    }

    // Priority 2: nested lenAxis
    if (attrs.lenAxis) {
      for (const key of ['len1', 'length']) {
        if (attrs.lenAxis[key] != null && typeof attrs.lenAxis[key] === 'number' && isFinite(attrs.lenAxis[key])) {
          return attrs.lenAxis[key];
        }
      }
    }

    // axisLength
    if (attrs.axisLength != null && typeof attrs.axisLength === 'number' && isFinite(attrs.axisLength)) {
      return attrs.axisLength;
    }

    // Priority 3: Euclidean distance from ep1 to ep2
    const ep1 = this._parsePoint(attrs.ep1 ?? attrs.EP1 ?? attrs.APOS ?? attrs.A_POS ?? attrs.START);
    const ep2 = this._parsePoint(attrs.ep2 ?? attrs.EP2 ?? attrs.LPOS ?? attrs.L_POS ?? attrs.END);
    if (ep1 && ep2) {
      const dx = ep2.x - ep1.x;
      const dy = ep2.y - ep1.y;
      const dz = ep2.z - ep1.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    return null;
  }

  _parsePoint(value) {
    if (!value) return null;
    if (Array.isArray(value) && value.length >= 3) {
      const [x, y, z] = value;
      if ([x, y, z].every(v => typeof v === 'number' && isFinite(v))) return { x, y, z };
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const x = value.x ?? value.X;
      const y = value.y ?? value.Y;
      const z = value.z ?? value.Z;
      if ([x, y, z].every(v => typeof v === 'number' && isFinite(v))) return { x, y, z };
    }
    return null;
  }

  // ── Candidate search ───────────────────────────────────────────────────────

  findValveWeightCandidates({ boreMm, ratingClass, lengthMm }) {
    const ratingNorm = String(ratingClass).toLowerCase();
    return this._master.filter(m => {
      if (m.qualityOk === false) return false;
      if (m.boreMm !== boreMm) return false;
      if (String(m.ratingClass).toLowerCase() !== ratingNorm) return false;
      if (Math.abs(m.lengthMm - lengthMm) > 4) return false;
      return true;
    });
  }

  // ── Main mapping ───────────────────────────────────────────────────────────

  mapRow(row) {
    const result = {
      valveWeightSource: null,
      valveWeightLengthMm: null,
      ambiguousValveWeightRequests: [],
    };

    // Non-VALVE rows: skip
    if (row.type !== 'VALVE') {
      return result;
    }

    const attrs      = row.attributes || {};
    const boreMm     = row.convertedBore;
    const ratingClass = row.rating ?? attrs.rating ?? attrs.RATING ?? attrs.ratingClass ?? null;
    const lengthMm   = this._resolveLength(attrs);

    // Incomplete key check
    if (boreMm == null || ratingClass == null || lengthMm == null) {
      result.valveWeightSource = 'WM-VALVE-KEY-INCOMPLETE';
      if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
      row.diagnostics.push('WM-VALVE-KEY-INCOMPLETE');
      return result;
    }

    result.valveWeightLengthMm = lengthMm;

    const candidates = this.findValveWeightCandidates({ boreMm, ratingClass, lengthMm });

    if (candidates.length === 1) {
      const c = candidates[0];
      row.ca = row.ca || {};
      row.ca['8'] = c.valveWeight ?? c.directWeight ?? c.weight;
      result.valveWeightSource = 'WM-VALVE-CA8-MATCH';
    } else if (candidates.length > 1) {
      result.ambiguousValveWeightRequests.push({ rowNo: row.rowNo, candidates });
      result.valveWeightSource = 'WM-VALVE-CA8-AMBIGUOUS';
      if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
      row.diagnostics.push('WM-VALVE-CA8-AMBIGUOUS');
    } else {
      result.valveWeightSource = 'WM-VALVE-CA8-NO-MATCH';
      if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
      row.diagnostics.push('WM-VALVE-CA8-NO-MATCH');
    }

    return result;
  }
}
