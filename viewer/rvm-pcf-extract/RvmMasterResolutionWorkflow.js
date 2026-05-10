/**
 * RvmMasterResolutionWorkflow.js
 *
 * Handles interactive/manual master resolution for PCF extraction:
 * 1) Derived piping class approximate / no match against piping class master.
 * 2) Multiple / no matches in weight master for VALVE and FLANGE.
 * 3) No match in line list, with manual CA entry.
 *
 * Resolution decisions are persisted in localStorage and reused.
 */

const STORAGE_KEY = 'rvm_pcf_master_resolution_overrides_v1';

const DEFAULT_PIPING_CLASS_REGEX =
  '(?:^|\\/)[^-\\/]+-[^-]+-[^-]+-[^-]+-([A-Z0-9]+)-[^\\/]+';

const DEFAULT_PIPING_CLASS_REGEX_GROUP = 1;

const HIGH_CONFIDENCE_SCORE = 0.92;
const MIN_FUZZY_SCORE = 0.72;
const LENGTH_TOLERANCE_MM = 4;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function norm(value) {
  return upper(value).replace(/[^A-Z0-9]/g, '');
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides || {}));
  } catch {
    // ignore localStorage write failure
  }
}

function ensureBucket(overrides, bucket) {
  if (!overrides[bucket]) overrides[bucket] = {};
  return overrides[bucket];
}

function levenshtein(a, b) {
  const s = norm(a);
  const t = norm(b);

  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const prev = Array(t.length + 1).fill(0);
  const curr = Array(t.length + 1).fill(0);

  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;

    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;

      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }

    for (let j = 0; j <= t.length; j += 1) prev[j] = curr[j];
  }

  return prev[t.length];
}

function similarity(a, b) {
  const s = norm(a);
  const t = norm(b);

  if (!s && !t) return 1;
  if (!s || !t) return 0;
  if (s === t) return 1;

  if (s.includes(t) || t.includes(s)) {
    const min = Math.min(s.length, t.length);
    const max = Math.max(s.length, t.length);
    return Math.max(0.86, min / max);
  }

  const dist = levenshtein(s, t);
  return Math.max(0, 1 - dist / Math.max(s.length, t.length));
}

function rowValue(row, keys) {
  const allKeys = Object.keys(row || {});
  for (const key of keys) {
    const exact = allKeys.find(k => k === key);
    if (exact && row[exact] != null && clean(row[exact]) !== '') return row[exact];

    const ci = allKeys.find(k => upper(k) === upper(key));
    if (ci && row[ci] != null && clean(row[ci]) !== '') return row[ci];
  }
  return '';
}

function getRowsFromMaster(masters, key) {
  const block = masters?.[key] || {};

  if (Array.isArray(block)) return block;
  if (Array.isArray(block.rows)) return block.rows;
  if (Array.isArray(block.blocks)) return block.blocks;

  return [];
}

function getLineListRows(masters) {
  return getRowsFromMaster(masters, 'linelist');
}

function getPipingClassRows(masters) {
  return getRowsFromMaster(masters, 'pipingClass');
}

function getWeightRows(masters) {
  const weightBlockRows = getRowsFromMaster(masters, 'weight');
  if (weightBlockRows.length) return weightBlockRows;

  if (Array.isArray(masters?.valveWeightMaster)) return masters.valveWeightMaster;

  return [];
}

function resolveLengthMm(row) {
  const direct =
    toNumber(row.lengthMm) ??
    toNumber(row.length) ??
    toNumber(row.len) ??
    toNumber(row.valveWeightLengthMm) ??
    toNumber(row.attributes?.lengthMm) ??
    toNumber(row.attributes?.length) ??
    toNumber(row.attributes?.len) ??
    toNumber(row.attributes?.axisLength);

  if (direct != null) return direct;

  const ep1 = row.ep1;
  const ep2 = row.ep2;

  if (
    ep1 &&
    ep2 &&
    Number.isFinite(Number(ep1.x)) &&
    Number.isFinite(Number(ep1.y)) &&
    Number.isFinite(Number(ep1.z)) &&
    Number.isFinite(Number(ep2.x)) &&
    Number.isFinite(Number(ep2.y)) &&
    Number.isFinite(Number(ep2.z))
  ) {
    const dx = Number(ep2.x) - Number(ep1.x);
    const dy = Number(ep2.y) - Number(ep1.y);
    const dz = Number(ep2.z) - Number(ep1.z);

    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  return null;
}

function extractPipingClassFromPipelineRef(pipelineRef, options = {}) {
  const ref = clean(pipelineRef);
  if (!ref) return '';

  const regexText =
    options.pipingClassRegex ||
    localStorage.getItem('rvm_pcf_piping_class_regex') ||
    DEFAULT_PIPING_CLASS_REGEX;

  const group =
    Number(options.pipingClassRegexGroup ?? localStorage.getItem('rvm_pcf_piping_class_regex_group') ?? DEFAULT_PIPING_CLASS_REGEX_GROUP);

  try {
    const re = new RegExp(regexText);
    const match = ref.match(re);

    if (match && match[group]) return clean(match[group]);
  } catch {
    // fallback below
  }

  const parts = ref.replace(/^\/+/, '').split(/[/-]+/).filter(Boolean);
  return clean(parts[4] || '');
}

function normalizeRating(value) {
  return upper(value).replace(/#/g, '');
}

function getPipingClassFromMasterRow(row) {
  return clean(
    row.pipingClass ??
    row.PipingClass ??
    row['Piping Class'] ??
    row.PIPING_CLASS ??
    row.Class ??
    row.CLASS ??
    row.Spec ??
    row.SPEC ??
    row._raw?.['Piping Class'] ??
    row._raw?.PIPING_CLASS ??
    ''
  );
}

function getBoreFromMasterRow(row) {
  return (
    toNumber(row.convertedBore) ??
    toNumber(row['Converted Bore']) ??
    toNumber(row.bore) ??
    toNumber(row.Bore) ??
    toNumber(row.DN) ??
    toNumber(row.NB) ??
    toNumber(row._raw?.['Converted Bore']) ??
    toNumber(row._raw?.DN) ??
    toNumber(row._raw?.NB)
  );
}

function getRatingFromMasterRow(row) {
  return clean(
    row.rating ??
    row.Rating ??
    row.RATING ??
    row.ratingClass ??
    row['Pressure Class'] ??
    row.Class ??
    row.CLASS ??
    row._raw?.Rating ??
    row._raw?.RATING ??
    row._raw?.['Pressure Class'] ??
    ''
  );
}

function getLengthFromWeightRow(row) {
  return (
    toNumber(row.length) ??
    toNumber(row.lengthMm) ??
    toNumber(row['Length (RF-F/F)']) ??
    toNumber(row['RF-F/F']) ??
    toNumber(row.LEN) ??
    toNumber(row.faceToFace) ??
    toNumber(row._raw?.['Length (RF-F/F)']) ??
    toNumber(row._raw?.['RF-F/F']) ??
    toNumber(row._raw?.Length)
  );
}

function getWeightFromWeightRow(row) {
  return (
    toNumber(row.weight) ??
    toNumber(row.valveWeight) ??
    toNumber(row.directWeight) ??
    toNumber(row['RF/RTJ KG']) ??
    toNumber(row['Valve Weight']) ??
    toNumber(row.Weight) ??
    toNumber(row._raw?.['RF/RTJ KG']) ??
    toNumber(row._raw?.['Valve Weight']) ??
    toNumber(row._raw?.Weight)
  );
}

function getDescriptionFromWeightRow(row) {
  return clean(
    row.valveType ??
    row.componentType ??
    row.description ??
    row.Description ??
    row['Type Description'] ??
    row['Valve Type'] ??
    row.Type ??
    row._raw?.['Type Description'] ??
    row._raw?.['Valve Type'] ??
    row._raw?.Type ??
    ''
  );
}

function getLineListKey(row) {
  return clean(
    row.lineNo ??
    row.lineNoKey ??
    row.ColumnX1 ??
    row.COLUMNX1 ??
    row.pipelineRef ??
    row.PIPELINE_REF ??
    row['Pipeline Ref'] ??
    row['Pipeline Reference'] ??
    row._raw?.ColumnX1 ??
    row._raw?.lineNo ??
    row._raw?.lineNoKey ??
    row._raw?.['Pipeline Ref'] ??
    ''
  );
}

function getLineListCandidateValues(row) {
  return {
    lineNo: getLineListKey(row),
    pipingClass: clean(
      row.pipingClass ??
      row.PipingClass ??
      row['Piping Class'] ??
      row.PIPING_CLASS ??
      row._raw?.['Piping Class'] ??
      ''
    ),
    convertedBore:
      toNumber(row.convertedBore) ??
      toNumber(row['Converted Bore']) ??
      toNumber(row.bore) ??
      toNumber(row.Bore) ??
      toNumber(row._raw?.['Converted Bore']) ??
      null,
    p1: clean(row.p1 ?? row.P1 ?? row.CA1 ?? row._raw?.P1 ?? ''),
    t1: clean(row.t1 ?? row.T1 ?? row.CA2 ?? row._raw?.T1 ?? ''),
    insThk: clean(row.insThk ?? row.InsThk ?? row.CA5 ?? row._raw?.InsThk ?? ''),
    hp: clean(row.hp ?? row.HP ?? row.CA10 ?? row._raw?.HP ?? '')
  };
}

function applyLineListValuesToRow(row, values, source) {
  if (!row.ca) row.ca = {};

  if (values.pipingClass) row.pipingClass = values.pipingClass;
  if (values.convertedBore != null) row.convertedBore = values.convertedBore;

  if (values.p1 !== '') row.ca['1'] = values.p1;
  if (values.t1 !== '') row.ca['2'] = values.t1;
  if (values.insThk !== '') row.ca['5'] = values.insThk;
  if (values.hp !== '') row.ca['10'] = values.hp;

  row.lineListMatchSource = source;

  if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
  row.diagnostics.push(source);
}

function applyPipingClassMasterToRow(row, candidate, source) {
  const pc = getPipingClassFromMasterRow(candidate);

  if (pc) row.pipingClass = pc;

  const rating = getRatingFromMasterRow(candidate);
  if (rating) row.rating = rating;

  row.pipingClassMasterMatch = {
    source,
    pipingClass: pc,
    rating,
    componentType: clean(candidate.componentType ?? candidate['Component Type'] ?? candidate.Type ?? ''),
    raw: candidate._raw || candidate
  };

  if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
  row.diagnostics.push(source);
}

function applyWeightToRow(row, candidate, source) {
  const weight = getWeightFromWeightRow(candidate);

  if (weight == null) return false;

  if (!row.ca) row.ca = {};
  row.ca['8'] = weight;

  row.weightMatchSource = source;
  row.weightMatchDescription = getDescriptionFromWeightRow(candidate);
  row.valveWeightSource = source;

  if (!Array.isArray(row.diagnostics)) row.diagnostics = [];
  row.diagnostics.push(source);

  return true;
}

function requestId(prefix, row, key) {
  return `${prefix}:${row.sourceCanonicalId || row.rowNo || row.name || 'row'}:${norm(key).slice(0, 80)}`;
}

function byScoreDesc(a, b) {
  return b.score - a.score;
}

export class RvmMasterResolutionWorkflow {
  constructor({ masters = {}, options = {} } = {}) {
    this.masters = masters || {};
    this.options = options || {};
    this.overrides = loadOverrides();
  }

  processRows(rows = []) {
    const requests = [];
    const diagnostics = [];

    for (const row of rows) {
      if (!row || row.include === false) continue;

      this._resolveLineList(row, requests, diagnostics);
      this._resolvePipingClass(row, requests, diagnostics);
      this._resolveWeight(row, requests, diagnostics);
    }

    saveOverrides(this.overrides);

    return { rows, requests, diagnostics };
  }

  applyRequestResolution(rows, request, payload) {
    if (!request || !payload) return { applied: 0, diagnostics: [] };

    const diagnostics = [];
    const applyAll = payload.applyAll !== false;
    let applied = 0;

    const targetRows = (rows || []).filter(row => {
      if (!applyAll) {
        return String(row.sourceCanonicalId || row.rowNo) === String(request.rowId);
      }

      if (request.kind === 'PIPING_CLASS') {
        return norm(this._derivedPipingClass(row)) === norm(request.derivedPipingClass);
      }

      if (request.kind === 'LINELIST') {
        return norm(this._lineListLookupKey(row)) === norm(request.lookupKey);
      }

      if (request.kind === 'WEIGHT') {
        return this._weightKey(row) === request.weightKey;
      }

      return false;
    });

    for (const row of targetRows) {
      if (request.kind === 'PIPING_CLASS') {
        const bucket = ensureBucket(this.overrides, 'pipingClass');

        if (payload.action === 'candidate') {
          const candidate = request.candidates[payload.candidateIndex];
          applyPipingClassMasterToRow(row, candidate.row, 'PCF-CLASS-USER-RESOLVED');
          bucket[norm(request.derivedPipingClass)] = {
            action: 'candidate',
            candidate: candidate.row
          };
          applied += 1;
        }

        if (payload.action === 'manual') {
          row.pipingClass = clean(payload.pipingClass);
          if (payload.rating) row.rating = clean(payload.rating);
          row.pipingClassMasterMatch = {
            source: 'PCF-CLASS-MANUAL',
            pipingClass: row.pipingClass,
            rating: row.rating || ''
          };
          bucket[norm(request.derivedPipingClass)] = {
            action: 'manual',
            pipingClass: row.pipingClass,
            rating: row.rating || ''
          };
          applied += 1;
        }
      }

      if (request.kind === 'LINELIST') {
        const bucket = ensureBucket(this.overrides, 'linelist');

        if (payload.action === 'candidate') {
          const candidate = request.candidates[payload.candidateIndex];
          const values = getLineListCandidateValues(candidate.row);
          applyLineListValuesToRow(row, values, 'LINELIST-USER-RESOLVED');
          bucket[norm(request.lookupKey)] = {
            action: 'candidate',
            candidate: candidate.row
          };
          applied += 1;
        }

        if (payload.action === 'manual') {
          const values = {
            pipingClass: clean(payload.pipingClass),
            convertedBore: toNumber(payload.convertedBore),
            p1: clean(payload.p1),
            t1: clean(payload.t1),
            insThk: clean(payload.insThk),
            hp: clean(payload.hp)
          };
          applyLineListValuesToRow(row, values, 'LINELIST-MANUAL');
          bucket[norm(request.lookupKey)] = {
            action: 'manual',
            values
          };
          applied += 1;
        }
      }

      if (request.kind === 'WEIGHT') {
        const bucket = ensureBucket(this.overrides, 'weight');

        if (payload.action === 'candidate') {
          const candidate = request.candidates[payload.candidateIndex];
          if (applyWeightToRow(row, candidate.row, 'WM-WEIGHT-CA8-USER-RESOLVED')) {
            bucket[request.weightKey] = {
              action: 'candidate',
              candidate: candidate.row
            };
            applied += 1;
          }
        }

        if (payload.action === 'manual') {
          if (!row.ca) row.ca = {};
          row.ca['8'] = toNumber(payload.weight);
          row.weightMatchSource = 'WM-WEIGHT-CA8-MANUAL';
          row.valveWeightSource = 'WM-WEIGHT-CA8-MANUAL';
          bucket[request.weightKey] = {
            action: 'manual',
            weight: row.ca['8']
          };
          applied += 1;
        }
      }
    }

    saveOverrides(this.overrides);

    diagnostics.push({
      severity: applied ? 'INFO' : 'WARNING',
      code: applied ? 'MASTER-RESOLUTION-APPLIED' : 'MASTER-RESOLUTION-NOT-APPLIED',
      message: `${applied} row(s) updated for ${request.kind}.`,
      requestId: request.id
    });

    return { applied, diagnostics };
  }

  _resolveLineList(row, requests, diagnostics) {
    const key = this._lineListLookupKey(row);
    if (!key) return;

    const override = this.overrides?.linelist?.[norm(key)];
    if (override) {
      if (override.action === 'candidate') {
        applyLineListValuesToRow(row, getLineListCandidateValues(override.candidate), 'LINELIST-OVERRIDE');
      } else if (override.action === 'manual') {
        applyLineListValuesToRow(row, override.values, 'LINELIST-OVERRIDE-MANUAL');
      }
      return;
    }

    const rows = getLineListRows(this.masters);
    if (!rows.length) {
      requests.push(this._lineListRequest(row, key, [], 'NO_MASTER'));
      return;
    }

    const exact = rows
      .map(r => ({ row: r, key: getLineListKey(r), score: norm(getLineListKey(r)) === norm(key) ? 1 : 0 }))
      .filter(c => c.score === 1);

    if (exact.length === 1) {
      applyLineListValuesToRow(row, getLineListCandidateValues(exact[0].row), 'LINELIST-EXACT-MATCH');
      return;
    }

    if (exact.length > 1) {
      requests.push(this._lineListRequest(row, key, exact, 'AMBIGUOUS_EXACT'));
      return;
    }

    const fuzzy = rows
      .map(r => {
        const candidateKey = getLineListKey(r);
        return { row: r, key: candidateKey, score: similarity(key, candidateKey) };
      })
      .filter(c => c.score >= MIN_FUZZY_SCORE)
      .sort(byScoreDesc)
      .slice(0, 10);

    if (fuzzy.length === 1 && fuzzy[0].score >= HIGH_CONFIDENCE_SCORE) {
      applyLineListValuesToRow(row, getLineListCandidateValues(fuzzy[0].row), 'LINELIST-FUZZY-MATCH');
      diagnostics.push({
        severity: 'WARNING',
        code: 'LINELIST-FUZZY-MATCH',
        message: `Line list fuzzy match used: ${key} -> ${fuzzy[0].key}`,
        rowNo: row.rowNo,
        score: fuzzy[0].score
      });
      return;
    }

    requests.push(this._lineListRequest(row, key, fuzzy, fuzzy.length ? 'AMBIGUOUS_FUZZY' : 'NO_MATCH'));
  }

  _resolvePipingClass(row, requests, diagnostics) {
    const derived = this._derivedPipingClass(row);
    if (!derived) return;

    const override = this.overrides?.pipingClass?.[norm(derived)];
    if (override) {
      if (override.action === 'candidate') {
        applyPipingClassMasterToRow(row, override.candidate, 'PCF-CLASS-OVERRIDE');
      } else if (override.action === 'manual') {
        row.pipingClass = override.pipingClass;
        if (override.rating) row.rating = override.rating;
        row.pipingClassMasterMatch = {
          source: 'PCF-CLASS-OVERRIDE-MANUAL',
          pipingClass: row.pipingClass,
          rating: row.rating || ''
        };
      }
      return;
    }

    const rows = getPipingClassRows(this.masters);
    if (!rows.length) {
      requests.push(this._pipingClassRequest(row, derived, [], 'NO_MASTER'));
      return;
    }

    const exact = rows
      .map(r => {
        const pc = getPipingClassFromMasterRow(r);
        return { row: r, pipingClass: pc, score: norm(pc) === norm(derived) ? 1 : 0 };
      })
      .filter(c => c.score === 1);

    if (exact.length === 1) {
      applyPipingClassMasterToRow(row, exact[0].row, 'PCF-CLASS-EXACT-MATCH');
      return;
    }

    if (exact.length > 1) {
      requests.push(this._pipingClassRequest(row, derived, exact, 'AMBIGUOUS_EXACT'));
      return;
    }

    const fuzzy = rows
      .map(r => {
        const pc = getPipingClassFromMasterRow(r);
        return { row: r, pipingClass: pc, score: similarity(derived, pc) };
      })
      .filter(c => c.score >= MIN_FUZZY_SCORE)
      .sort(byScoreDesc)
      .slice(0, 10);

    if (
      fuzzy.length === 1 &&
      fuzzy[0].score >= HIGH_CONFIDENCE_SCORE
    ) {
      applyPipingClassMasterToRow(row, fuzzy[0].row, 'PCF-CLASS-FUZZY-MATCH');
      diagnostics.push({
        severity: 'WARNING',
        code: 'PCF-CLASS-FUZZY-MATCH',
        message: `Piping class fuzzy match used: ${derived} -> ${fuzzy[0].pipingClass}`,
        rowNo: row.rowNo,
        score: fuzzy[0].score
      });
      return;
    }

    if (
      fuzzy.length >= 2 &&
      fuzzy[0].score >= HIGH_CONFIDENCE_SCORE &&
      fuzzy[0].score - fuzzy[1].score >= 0.08
    ) {
      applyPipingClassMasterToRow(row, fuzzy[0].row, 'PCF-CLASS-FUZZY-MATCH');
      diagnostics.push({
        severity: 'WARNING',
        code: 'PCF-CLASS-FUZZY-MATCH',
        message: `Piping class fuzzy match used: ${derived} -> ${fuzzy[0].pipingClass}`,
        rowNo: row.rowNo,
        score: fuzzy[0].score
      });
      return;
    }

    requests.push(this._pipingClassRequest(row, derived, fuzzy, fuzzy.length ? 'AMBIGUOUS_FUZZY' : 'NO_MATCH'));
  }

  _resolveWeight(row, requests) {
    const type = upper(row.type);
    if (!['VALVE', 'FLANGE'].includes(type)) return;

    const weightKey = this._weightKey(row);
    if (!weightKey) return;

    const override = this.overrides?.weight?.[weightKey];
    if (override) {
      if (override.action === 'candidate') {
        applyWeightToRow(row, override.candidate, 'WM-WEIGHT-CA8-OVERRIDE');
      } else if (override.action === 'manual') {
        if (!row.ca) row.ca = {};
        row.ca['8'] = override.weight;
        row.weightMatchSource = 'WM-WEIGHT-CA8-OVERRIDE-MANUAL';
        row.valveWeightSource = 'WM-WEIGHT-CA8-OVERRIDE-MANUAL';
      }
      return;
    }

    const boreMm = toNumber(row.convertedBore);
    const rating = row.rating ?? row.ratingClass ?? row.pipingClass ?? '';
    const lengthMm = resolveLengthMm(row);

    if (boreMm == null || !clean(rating) || lengthMm == null) {
      requests.push(this._weightRequest(row, weightKey, [], 'KEY_INCOMPLETE'));
      return;
    }

    const rows = getWeightRows(this.masters);

    if (!rows.length) {
      requests.push(this._weightRequest(row, weightKey, [], 'NO_MASTER'));
      return;
    }

    const candidates = rows
      .map(r => {
        const bore = getBoreFromMasterRow(r);
        const rRating = getRatingFromMasterRow(r);
        const length = getLengthFromWeightRow(r);
        const weight = getWeightFromWeightRow(r);

        const ratingMatch = normalizeRating(rRating) === normalizeRating(rating);
        const boreMatch = bore != null && Math.abs(bore - boreMm) < 1;
        const lengthDelta = length == null ? Infinity : Math.abs(length - lengthMm);
        const lengthMatch = lengthDelta <= LENGTH_TOLERANCE_MM;

        return {
          row: r,
          bore,
          rating: rRating,
          length,
          lengthDelta,
          weight,
          description: getDescriptionFromWeightRow(r),
          score: ratingMatch && boreMatch && lengthMatch ? 1 : 0
        };
      })
      .filter(c => c.score === 1);

    if (candidates.length === 1) {
      applyWeightToRow(row, candidates[0].row, 'WM-WEIGHT-CA8-MATCH');
      return;
    }

    requests.push(
      this._weightRequest(
        row,
        weightKey,
        candidates,
        candidates.length > 1 ? 'AMBIGUOUS' : 'NO_MATCH'
      )
    );
  }

  _derivedPipingClass(row) {
    return clean(
      row.pipingClass ||
      row.pipingClassDerived ||
      extractPipingClassFromPipelineRef(row.pipelineRef, this.options)
    );
  }

  _lineListLookupKey(row) {
    return clean(row.lineNoKey || row.lineKey || row.pipelineRef || row.name || row.sourcePath || '');
  }

  _weightKey(row) {
    const boreMm = toNumber(row.convertedBore);
    const rating = clean(row.rating || row.ratingClass || row.pipingClass || '');
    const lengthMm = resolveLengthMm(row);
    const type = upper(row.type);

    if (boreMm == null || !rating || lengthMm == null) {
      return `${type}|${rating || 'NO_RATING'}|${boreMm ?? 'NO_BORE'}|${lengthMm ?? 'NO_LENGTH'}`;
    }

    return `${type}|${normalizeRating(rating)}|DN${Math.round(boreMm)}|L${Math.round(lengthMm)}`;
  }

  _pipingClassRequest(row, derivedPipingClass, candidates, reason) {
    return {
      id: requestId('PIPING_CLASS', row, derivedPipingClass),
      kind: 'PIPING_CLASS',
      reason,
      rowId: String(row.sourceCanonicalId || row.rowNo),
      rowNo: row.rowNo,
      componentType: row.type,
      pipelineRef: row.pipelineRef || '',
      derivedPipingClass,
      candidates
    };
  }

  _lineListRequest(row, lookupKey, candidates, reason) {
    return {
      id: requestId('LINELIST', row, lookupKey),
      kind: 'LINELIST',
      reason,
      rowId: String(row.sourceCanonicalId || row.rowNo),
      rowNo: row.rowNo,
      componentType: row.type,
      pipelineRef: row.pipelineRef || '',
      lookupKey,
      candidates
    };
  }

  _weightRequest(row, weightKey, candidates, reason) {
    return {
      id: requestId('WEIGHT', row, weightKey),
      kind: 'WEIGHT',
      reason,
      rowId: String(row.sourceCanonicalId || row.rowNo),
      rowNo: row.rowNo,
      componentType: row.type,
      pipelineRef: row.pipelineRef || '',
      weightKey,
      boreMm: toNumber(row.convertedBore),
      rating: clean(row.rating || row.ratingClass || row.pipingClass || ''),
      lengthMm: resolveLengthMm(row),
      candidates
    };
  }
}

function requestTitle(request) {
  if (request.kind === 'PIPING_CLASS') {
    return `Piping class resolution — ${request.derivedPipingClass || '(blank)'}`;
  }

  if (request.kind === 'LINELIST') {
    return `Line list resolution — ${request.lookupKey || '(blank)'}`;
  }

  if (request.kind === 'WEIGHT') {
    return `Weight resolution — ${request.weightKey || '(blank)'}`;
  }

  return 'Master resolution';
}

function renderCandidateRows(request) {
  const candidates = request.candidates || [];

  if (!candidates.length) {
    return `<div style="font-size:12px;color:#fca5a5;margin:8px 0;">No candidates found. Use manual entry.</div>`;
  }

  return `
    <div style="max-height:220px;overflow:auto;border:1px solid #334155;border-radius:8px;">
      ${candidates.map((c, index) => {
        let text = '';

        if (request.kind === 'PIPING_CLASS') {
          text = `${c.pipingClass || getPipingClassFromMasterRow(c.row)} | rating=${getRatingFromMasterRow(c.row) || '-'} | score=${Number(c.score || 0).toFixed(3)}`;
        } else if (request.kind === 'LINELIST') {
          const v = getLineListCandidateValues(c.row);
          text = `${c.key || v.lineNo || '-'} | PC=${v.pipingClass || '-'} | Bore=${v.convertedBore ?? '-'} | CA1=${v.p1 || '-'} | score=${Number(c.score || 0).toFixed(3)}`;
        } else if (request.kind === 'WEIGHT') {
          text = `Rating=${c.rating || '-'} | Bore=${c.bore ?? '-'} | Length=${c.length ?? '-'} | Weight=${c.weight ?? '-'} | ${c.description || ''}`;
        }

        return `
          <label style="display:block;padding:8px 10px;border-bottom:1px solid #1e293b;cursor:pointer;font-size:12px;">
            <input type="radio" name="candidate-${esc(request.id)}" value="${index}" ${index === 0 ? 'checked' : ''}>
            <span>${esc(text)}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

function renderManualFields(request) {
  if (request.kind === 'PIPING_CLASS') {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">
        <label style="font-size:12px;">Piping Class
          <input data-manual="pipingClass" value="${esc(request.derivedPipingClass || '')}" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">Rating
          <input data-manual="rating" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
      </div>
    `;
  }

  if (request.kind === 'LINELIST') {
    return `
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px;">
        <label style="font-size:12px;">Piping Class
          <input data-manual="pipingClass" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">Converted Bore
          <input data-manual="convertedBore" value="${esc(request.boreMm ?? '')}" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">P1 / CA1
          <input data-manual="p1" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">T1 / CA2
          <input data-manual="t1" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">InsThk / CA5
          <input data-manual="insThk" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
        <label style="font-size:12px;">HP / CA10
          <input data-manual="hp" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
      </div>
    `;
  }

  if (request.kind === 'WEIGHT') {
    return `
      <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:8px;">
        <label style="font-size:12px;">Manual Weight / CA8
          <input data-manual="weight" value="" style="width:100%;box-sizing:border-box;background:#020617;color:#e2e8f0;border:1px solid #334155;border-radius:6px;padding:6px;">
        </label>
      </div>
    `;
  }

  return '';
}

export function showRvmMasterResolutionDialog({
  requests = [],
  rows = [],
  resolver,
  onApplied
} = {}) {
  if (typeof document === 'undefined') return;
  if (!requests.length || !resolver) return;

  const existing = document.getElementById('rvm-master-resolution-dialog');
  if (existing) existing.remove();

  let index = 0;

  const overlay = document.createElement('div');
  overlay.id = 'rvm-master-resolution-dialog';
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(2,6,23,.74);
    z-index:99999;
    display:flex;
    align-items:center;
    justify-content:center;
    color:#e2e8f0;
    font-family:Inter,Arial,sans-serif;
  `;

  const shell = document.createElement('div');
  shell.style.cssText = `
    width:min(960px,calc(100vw - 48px));
    max-height:calc(100vh - 48px);
    background:#0f172a;
    border:1px solid #334155;
    border-radius:14px;
    box-shadow:0 24px 80px rgba(0,0,0,.45);
    display:flex;
    flex-direction:column;
    overflow:hidden;
  `;

  overlay.appendChild(shell);
  document.body.appendChild(overlay);

  const render = () => {
    const request = requests[index];
    const hasCandidates = (request.candidates || []).length > 0;

    shell.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:10px;">
        <div style="font-weight:700;font-size:15px;">${esc(requestTitle(request))}</div>
        <div style="margin-left:auto;font-size:12px;color:#94a3b8;">${index + 1} / ${requests.length}</div>
        <button data-close style="background:transparent;color:#cbd5e1;border:1px solid #475569;border-radius:8px;padding:5px 9px;cursor:pointer;">Close</button>
      </div>

      <div style="padding:14px 16px;overflow:auto;">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;font-size:12px;">
          <div><b>Reason</b><br>${esc(request.reason)}</div>
          <div><b>Row</b><br>${esc(request.rowNo)}</div>
          <div><b>Type</b><br>${esc(request.componentType)}</div>
          <div><b>Pipeline Ref</b><br>${esc(request.pipelineRef || '-')}</div>
        </div>

        ${request.kind === 'WEIGHT' ? `
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px;font-size:12px;">
            <div><b>Bore</b><br>${esc(request.boreMm ?? '-')}</div>
            <div><b>Rating / Class</b><br>${esc(request.rating || '-')}</div>
            <div><b>Length</b><br>${esc(request.lengthMm != null ? Number(request.lengthMm).toFixed(2) : '-')}</div>
          </div>
        ` : ''}

        ${renderCandidateRows(request)}

        <div style="margin-top:12px;padding:10px;border:1px solid #334155;border-radius:8px;background:#111827;">
          <div style="font-weight:700;font-size:12px;color:#fbbf24;margin-bottom:6px;">Manual entry</div>
          ${renderManualFields(request)}
        </div>

        <label style="display:flex;align-items:center;gap:7px;margin-top:12px;font-size:12px;color:#cbd5e1;">
          <input type="checkbox" data-apply-all checked>
          Apply to all rows with same unresolved key
        </label>
      </div>

      <div style="padding:12px 16px;border-top:1px solid #334155;display:flex;gap:8px;justify-content:flex-end;">
        <button data-prev ${index === 0 ? 'disabled' : ''} style="padding:7px 12px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;cursor:pointer;">Previous</button>
        <button data-use-candidate ${hasCandidates ? '' : 'disabled'} style="padding:7px 12px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:white;cursor:pointer;">Use selected candidate</button>
        <button data-use-manual style="padding:7px 12px;border-radius:8px;border:1px solid #d97706;background:#d97706;color:white;cursor:pointer;">Use manual entry</button>
        <button data-skip style="padding:7px 12px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;cursor:pointer;">Skip</button>
        <button data-next ${index >= requests.length - 1 ? 'disabled' : ''} style="padding:7px 12px;border-radius:8px;border:1px solid #475569;background:#020617;color:#e2e8f0;cursor:pointer;">Next</button>
      </div>
    `;

    shell.querySelector('[data-close]')?.addEventListener('click', () => overlay.remove());

    shell.querySelector('[data-prev]')?.addEventListener('click', () => {
      index = Math.max(0, index - 1);
      render();
    });

    shell.querySelector('[data-next]')?.addEventListener('click', () => {
      index = Math.min(requests.length - 1, index + 1);
      render();
    });

    shell.querySelector('[data-skip]')?.addEventListener('click', () => {
      if (index < requests.length - 1) {
        index += 1;
        render();
      } else {
        overlay.remove();
      }
    });

    shell.querySelector('[data-use-candidate]')?.addEventListener('click', () => {
      const selected = shell.querySelector(`input[name="candidate-${CSS.escape(request.id)}"]:checked`);
      const candidateIndex = Number(selected?.value ?? 0);
      const applyAll = shell.querySelector('[data-apply-all]')?.checked !== false;

      const result = resolver.applyRequestResolution(rows, request, {
        action: 'candidate',
        candidateIndex,
        applyAll
      });

      if (onApplied) onApplied(result);

      if (index < requests.length - 1) {
        index += 1;
        render();
      } else {
        overlay.remove();
      }
    });

    shell.querySelector('[data-use-manual]')?.addEventListener('click', () => {
      const applyAll = shell.querySelector('[data-apply-all]')?.checked !== false;
      const inputs = Array.from(shell.querySelectorAll('[data-manual]'));
      const payload = { action: 'manual', applyAll };

      for (const input of inputs) {
        payload[input.dataset.manual] = input.value;
      }

      const result = resolver.applyRequestResolution(rows, request, payload);

      if (onApplied) onApplied(result);

      if (index < requests.length - 1) {
        index += 1;
        render();
      } else {
        overlay.remove();
      }
    });
  };

  render();
}
