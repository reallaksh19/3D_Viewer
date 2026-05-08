/**
 * RvmFinal2dCsvBuilder.js
 * Wave 3/4 – builds rows for the Final 2D CSV from an RVM index.
 * Pure JS: no DOM, no three.js.
 */

import { RvmPipelineRefResolver } from './RvmPipelineRefResolver.js';
import { RvmBoreConverter }       from './RvmBoreConverter.js';
import { RvmPipingClassMapper }   from './RvmPipingClassMapper.js';
import { RvmValveWeightMapper }   from './RvmValveWeightMapper.js';

// ─── Type mapping ────────────────────────────────────────────────────────────

const TYPE_MAP = [
  { keys: ['TUBI', 'PIPE'],                        type: 'PIPE',               include: true  },
  { keys: ['ELBO', 'ELBOW', 'BEND'],               type: 'BEND',               include: true  },
  { keys: ['TEE'],                                  type: 'TEE',                include: true  },
  { keys: ['OLET', 'WELDOLET', 'SOCKOLET'],        type: 'OLET',               include: true  },
  { keys: ['FLAN', 'FLANGE', 'FBLI'],              type: 'FLANGE',             include: true  },
  { keys: ['VALV', 'VALVE'],                        type: 'VALVE',              include: true  },
  { keys: ['REDU', 'REDUCER'],                      type: 'REDUCER-CONCENTRIC', include: true  },
  { keys: ['ATTA', 'ANCI', 'SUPPORT'],             type: 'SUPPORT',            include: true  },
  { keys: ['GASK'],                                 type: 'GASK',               include: false },
  { keys: ['INST'],                                 type: 'INST',               include: false },
  { keys: ['WELD'],                                 type: 'WELD',               include: false },
];

function resolveType(node) {
  const raw = (node.kind || node.type || '').toUpperCase().trim();
  for (const entry of TYPE_MAP) {
    if (entry.keys.includes(raw)) {
      return { type: entry.type, include: entry.include };
    }
  }
  return { type: 'UNKNOWN', include: false };
}

// ─── Coordinate key lists ────────────────────────────────────────────────────

const EP1_KEYS     = ['APOS', 'A_POS', 'EP1', 'START', 'END_POINT1', 'ABOP', 'POS_START', 'START_POINT'];
const EP2_KEYS     = ['LPOS', 'L_POS', 'EP2', 'END', 'END_POINT2', 'LBOP', 'POS_END', 'END_POINT'];
const CP_KEYS      = ['CPOS', 'CENTRE_POINT', 'CENTER_POINT', 'CENTRE-POINT', 'CENTER-POINT', 'CP'];
const BP_KEYS      = ['BPOS', 'BRANCH_POINT', 'BRANCH1_POINT', 'BRANCH-POINT', 'BRANCH1-POINT', 'BP', 'BPOS1'];
const SUPP_KEYS    = ['POS', 'CO_ORDS', 'COORDS', 'CO_ORD', 'SUPPORT_COOR', 'SUPPORT_COORD'];

// ─── Coordinate normalisation ────────────────────────────────────────────────

function parseCoord(value) {
  if (value == null) return null;

  if (Array.isArray(value) && value.length >= 3) {
    const [x, y, z] = value;
    if ([x, y, z].every(v => typeof v === 'number' && isFinite(v))) {
      return { x, y, z };
    }
    return null;
  }

  if (typeof value === 'object') {
    const x = value.x ?? value.X;
    const y = value.y ?? value.Y;
    const z = value.z ?? value.Z;
    if ([x, y, z].every(v => typeof v === 'number' && isFinite(v))) {
      return { x, y, z };
    }
    return null;
  }

  if (typeof value === 'string') {
    const parts = value.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 3 && parts.every(v => isFinite(v))) {
      return { x: parts[0], y: parts[1], z: parts[2] };
    }
    return null;
  }

  return null;
}

function findCoord(attrs, keys) {
  for (const k of keys) {
    if (k in attrs) {
      const c = parseCoord(attrs[k]);
      if (c) return c;
    }
  }
  return null;
}

// ─── Bounding box helpers ────────────────────────────────────────────────────

function parseBbox(bbox) {
  if (!bbox) return null;

  let min, max;

  if (Array.isArray(bbox.min) && Array.isArray(bbox.max)) {
    min = { x: bbox.min[0], y: bbox.min[1], z: bbox.min[2] };
    max = { x: bbox.max[0], y: bbox.max[1], z: bbox.max[2] };
  } else if (
    bbox.minX != null && bbox.minY != null && bbox.minZ != null &&
    bbox.maxX != null && bbox.maxY != null && bbox.maxZ != null
  ) {
    min = { x: bbox.minX, y: bbox.minY, z: bbox.minZ };
    max = { x: bbox.maxX, y: bbox.maxY, z: bbox.maxZ };
  } else {
    return null;
  }

  return { min, max };
}

function bboxMidpoint(parsed) {
  return {
    x: (parsed.min.x + parsed.max.x) / 2,
    y: (parsed.min.y + parsed.max.y) / 2,
    z: (parsed.min.z + parsed.max.z) / 2,
  };
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export class RvmFinal2dCsvBuilder {
  /**
   * @param {object} rvmIndex  – { nodes: [...] }
   * @param {object} options   – { selectedCanonicalIds?: string[], masters?: {}, selectedRootIds?: string[] }
   */
  constructor(rvmIndex, options = {}) {
    this._index   = rvmIndex;
    this._selected = options.selectedCanonicalIds || [];
    this._masters  = options.masters || {};

    this._resolver           = new RvmPipelineRefResolver(rvmIndex, { selectedRootIds: options.selectedRootIds || [] });
    this._boreConverter      = new RvmBoreConverter();
    this._pipingClassMapper  = new RvmPipingClassMapper(this._masters);
    this._valveWeightMapper  = new RvmValveWeightMapper(this._masters);

    // Build ancestor map: canonicalObjectId → ancestor chain (closest first)
    const allNodes = (rvmIndex && rvmIndex.nodes) || [];
    const nodeById = new Map(allNodes.map(n => [n.canonicalObjectId, n]));
    this._nodeById = nodeById;
    this._ancestorMap = new Map();
    for (const n of allNodes) {
      const chain = [];
      let current = nodeById.get(n.parentCanonicalObjectId);
      while (current) {
        chain.push(current);
        current = nodeById.get(current.parentCanonicalObjectId);
      }
      this._ancestorMap.set(n.canonicalObjectId, chain);
    }
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  build() {
    const nodes      = this._resolveScope();
    const rows       = nodes.map(n => this._buildRow(n));
    const diagnostics = [];

    // Sort
    rows.sort((a, b) => {
      const sp = (a.sourcePath || '').localeCompare(b.sourcePath || '');
      if (sp !== 0) return sp;
      const tp = (a.type || '').localeCompare(b.type || '');
      if (tp !== 0) return tp;
      return (a.sourceCanonicalId || '').localeCompare(b.sourceCanonicalId || '');
    });

    // Assign rowNo
    rows.forEach((r, i) => { r.rowNo = (i + 1) * 10; });

    return { rows, diagnostics };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _resolveScope() {
    const allNodes = this._index.nodes || [];

    if (this._selected.length === 0) {
      return allNodes;
    }

    // Build parent→children map
    const childrenOf = new Map();
    for (const n of allNodes) {
      const pid = n.parentCanonicalObjectId;
      if (pid != null) {
        if (!childrenOf.has(pid)) childrenOf.set(pid, []);
        childrenOf.get(pid).push(n.canonicalObjectId);
      }
    }

    const nodeById = new Map(allNodes.map(n => [n.canonicalObjectId, n]));

    // Expand each selected id to itself + descendants
    const included = new Set();
    const expand = (id) => {
      if (included.has(id)) return;
      included.add(id);
      for (const cid of (childrenOf.get(id) || [])) {
        expand(cid);
      }
    };

    for (const id of this._selected) expand(id);

    return allNodes.filter(n => included.has(n.canonicalObjectId));
  }

  _buildRow(node) {
    const { type, include } = resolveType(node);
    const attrs             = node.attributes || {};
    const bbox              = parseBbox(node.bbox);
    const rowDiags          = [];

    // ── Pipeline Ref ──
    const ancestorChain = this._ancestorMap.get(node.canonicalObjectId) || [];
    const { pipelineRef, source: pipelineRefSource } = this._resolver.resolve(node, ancestorChain);

    // ── Bore ──
    const rawBore    = this._boreConverter.findRawBore(attrs);
    const boreResult = this._boreConverter.convertBore(rawBore);

    // ── Coordinates ──

    let ep1 = findCoord(attrs, EP1_KEYS);
    let ep1Fallback = false;
    if (!ep1 && bbox) {
      ep1 = bbox.min;
      ep1Fallback = true;
      rowDiags.push('EP1-BBOX-FALLBACK');
    }

    let ep2 = findCoord(attrs, EP2_KEYS);
    let ep2Fallback = false;
    if (!ep2 && bbox) {
      ep2 = bbox.max;
      ep2Fallback = true;
      rowDiags.push('EP2-BBOX-FALLBACK');
    }

    let cp = findCoord(attrs, CP_KEYS);
    let cpFallback = false;
    if (!cp && bbox) {
      cp = bboxMidpoint(bbox);
      cpFallback = true;
      rowDiags.push('CP-MIDPOINT-FALLBACK');
    }

    const bp = findCoord(attrs, BP_KEYS);

    let supportCoor = findCoord(attrs, SUPP_KEYS);
    if (!supportCoor && bbox) {
      supportCoor = bboxMidpoint(bbox);
      rowDiags.push('SUPPORT-COOR-BBOX-FALLBACK');
    }

    if (type === 'UNKNOWN') rowDiags.push('TYPE-UNKNOWN');

    const epFallback = ep1Fallback || ep2Fallback || cpFallback;

    // ── Piping Class (Wave 5) ──
    const partialRow = {
      attributes:    attrs,
      pipelineRef,
      convertedBore: boreResult.convertedBore,
      type,
    };
    const classResult = this._pipingClassMapper.mapRow(partialRow);

    // ── Valve Weight (Wave 6) ──
    const valveRow = {
      attributes:    attrs,
      type,
      convertedBore: boreResult.convertedBore,
      rating:        classResult.pipingClassRating ?? null,
      rowNo:         null,
      ca:            {},
      diagnostics:   rowDiags,
    };
    const valveResult = this._valveWeightMapper.mapRow(valveRow);

    return {
      rowNo:                null,
      sourceCanonicalId:    node.canonicalObjectId,
      sourcePath:           node.path || node.name || node.canonicalObjectId,
      name:                 node.name || node.canonicalObjectId,
      type,
      kind:                 node.kind,
      include,
      ep1:                  ep1 || null,
      ep2:                  ep2 || null,
      cp:                   cp  || null,
      bp:                   bp  || null,
      supportCoor:          supportCoor || null,
      _epFallback:          epFallback,
      attributes:           attrs,
      diagnostics:          rowDiags,
      // Wave 4 fields
      pipelineRef,
      pipelineRefSource,
      rawBore,
      bore:                 boreResult.bore,
      convertedBore:        boreResult.convertedBore,
      convertedBoreStatus:  boreResult.convertedBoreStatus,
      convertedBoreSource:  boreResult.convertedBoreSource,
      boreMapping:          boreResult.boreMapping,
      // Wave 5 fields
      ...classResult,
      // Wave 6 fields
      ca:                          valveRow.ca,
      valveWeightSource:           valveResult.valveWeightSource,
      valveWeightLengthMm:         valveResult.valveWeightLengthMm,
      ambiguousValveWeightRequests: valveResult.ambiguousValveWeightRequests,
    };
  }
}
