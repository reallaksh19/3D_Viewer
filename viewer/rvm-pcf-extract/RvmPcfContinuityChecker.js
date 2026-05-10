import { parsePcfText } from '../js/pcf2glb/pcf/parsePcfText.js';
import { normalizePcfModel } from '../js/pcf2glb/pcf/normalizePcfModel.js';

const DEFAULT_TOLERANCE_MM = 6;
const DEFAULT_MOVE_PRIORITY = ['PIPE', 'FLANGE', 'VALVE', 'BEND', 'TEE'];
const NON_MOVABLE_TYPES = new Set(['SUPPORT', 'MESSAGE-SQUARE', 'MESSAGE-CIRCLE']);

function _clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function _upper(value) {
  return _clean(value).toUpperCase();
}

function _isFinitePoint(point) {
  if (!point || typeof point !== 'object') return false;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function _clonePoint(point) {
  if (!_isFinitePoint(point)) return null;
  return {
    x: Number(point.x),
    y: Number(point.y),
    z: Number(point.z),
    ...(Number.isFinite(Number(point.bore)) ? { bore: Number(point.bore) } : {}),
  };
}

function _round3(value) {
  return Number(Number(value || 0).toFixed(3));
}

function _cloneComponent(component) {
  const clone = { ...component };
  clone.attributes = component && component.attributes && typeof component.attributes === 'object'
    ? JSON.parse(JSON.stringify(component.attributes))
    : {};

  for (const key of ['ep1', 'ep2', 'cp', 'bp', 'coOrds', 'supportCoor', 'circleCoord']) {
    if (component && component[key]) {
      clone[key] = _clonePoint(component[key]) || null;
    }
  }

  if (Array.isArray(component?.points)) {
    clone.points = component.points.map((pt) => _clonePoint(pt) || pt);
  }

  return clone;
}

function _translatePoint(point, delta) {
  if (!_isFinitePoint(point) || !delta) return point;
  return {
    x: Number(point.x) + Number(delta.x || 0),
    y: Number(point.y) + Number(delta.y || 0),
    z: Number(point.z) + Number(delta.z || 0),
    ...(Number.isFinite(Number(point.bore)) ? { bore: Number(point.bore) } : {}),
  };
}

function _translateComponent(component, delta) {
  const out = component;
  for (const key of ['ep1', 'ep2', 'cp', 'bp', 'coOrds', 'supportCoor', 'circleCoord']) {
    if (_isFinitePoint(out[key])) out[key] = _translatePoint(out[key], delta);
  }
  if (Array.isArray(out.points)) {
    out.points = out.points.map((pt) => (_isFinitePoint(pt) ? _translatePoint(pt, delta) : pt));
  }
  return out;
}

function _distance(a, b) {
  if (!_isFinitePoint(a) || !_isFinitePoint(b)) return null;
  const dx = Number(b.x) - Number(a.x);
  const dy = Number(b.y) - Number(a.y);
  const dz = Number(b.z) - Number(a.z);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function _deltaVector(fromPoint, toPoint) {
  if (!_isFinitePoint(fromPoint) || !_isFinitePoint(toPoint)) return null;
  return {
    x: Number(toPoint.x) - Number(fromPoint.x),
    y: Number(toPoint.y) - Number(fromPoint.y),
    z: Number(toPoint.z) - Number(fromPoint.z),
  };
}

function _dominantAxisSignedDeviation(deltaVector, distanceMm) {
  if (!deltaVector || !Number.isFinite(Number(distanceMm))) return Number(distanceMm) || 0;
  const absX = Math.abs(Number(deltaVector.x || 0));
  const absY = Math.abs(Number(deltaVector.y || 0));
  const absZ = Math.abs(Number(deltaVector.z || 0));
  const dominant = Math.max(absX, absY, absZ);
  if (dominant === 0) return Number(distanceMm) || 0;
  const signSource = dominant === absX ? Number(deltaVector.x || 0) : dominant === absY ? Number(deltaVector.y || 0) : Number(deltaVector.z || 0);
  return (signSource < 0 ? -1 : 1) * Number(distanceMm);
}

function _parsePriorityList(priorityValue) {
  if (Array.isArray(priorityValue)) {
    return priorityValue.map((entry) => _upper(entry)).filter(Boolean);
  }

  const text = _clean(priorityValue);
  if (!text) return [...DEFAULT_MOVE_PRIORITY];
  return text.split(',').map((entry) => _upper(entry)).filter(Boolean);
}

function _normalizeOptions(rawOptions) {
  const source = rawOptions && typeof rawOptions === 'object' ? rawOptions : {};
  const toleranceSource =
    source.continuityMismatchToleranceMm ??
    source.mismatchToleranceMm;
  const autoAdjustSource =
    source.continuityAutoAdjustEnabled ??
    source.autoAdjustEnabled;
  const movePrioritySource =
    source.continuityMovePriority ??
    source.movePriority;
  const preferUpstreamSource =
    source.preferUpstreamComponent;
  const toleranceMm = Number.isFinite(Number(toleranceSource))
    ? Number(toleranceSource)
    : DEFAULT_TOLERANCE_MM;
  return {
    continuityMismatchToleranceMm: toleranceMm,
    continuityAutoAdjustEnabled: autoAdjustSource !== false,
    continuityMovePriority: _parsePriorityList(movePrioritySource),
    preferUpstreamComponent: preferUpstreamSource !== false,
  };
}

function _componentType(component) {
  return _upper(component?.type || component?.kind || component?.attributes?.TYPE || component?.attributes?.['COMPONENT-TYPE']);
}

function _isMovableType(type, movePriority) {
  if (!type) return false;
  if (NON_MOVABLE_TYPES.has(type)) return false;
  return movePriority.includes(type);
}

function _typeRank(type, movePriority) {
  const index = movePriority.indexOf(type);
  return index >= 0 ? index : Number.POSITIVE_INFINITY;
}

function _componentId(component, fallbackIndex) {
  return _clean(
    component?.sourceCanonicalId
      || component?.id
      || component?.rowNo
      || component?.attributes?.['COMPONENT-ATTRIBUTE97']
      || component?.attributes?.['PIPELINE-REFERENCE']
      || fallbackIndex
  ) || String(fallbackIndex);
}

function _pipelineRef(component, fallback) {
  return _clean(
    component?.pipelineRef
      || component?.attributes?.['PIPELINE-REFERENCE']
      || component?.attributes?.PIPELINE_REFERENCE
      || component?.attributes?.PIPELINE
      || fallback
  ) || 'RVM-EXTRACT';
}

function _entryPoint(component) {
  return _clonePoint(component?.ep1 || component?.coOrds || component?.supportCoor || null);
}

function _exitPoint(component) {
  return _clonePoint(component?.ep2 || component?.bp || component?.coOrds || null);
}

function _buildChain(components) {
  const chain = [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (component?.include === false) {
      continue;
    }
    const type = _componentType(component);
    if (!type || NON_MOVABLE_TYPES.has(type) || type.startsWith('MESSAGE-')) {
      continue;
    }
    const entry = _entryPoint(component);
    const exit = _exitPoint(component);
    if (!_isFinitePoint(entry) && !_isFinitePoint(exit)) continue;
    chain.push({
      index,
      id: _componentId(component, index),
      type,
      pipelineRef: _pipelineRef(component, 'RVM-EXTRACT'),
      component,
      entry,
      exit,
    });
  }
  return chain;
}

function _selectMover(upstreamEntry, downstreamEntry, options, movePriority) {
  const upstreamRank = _typeRank(upstreamEntry.type, movePriority);
  const downstreamRank = _typeRank(downstreamEntry.type, movePriority);
  const upstreamMovable = _isMovableType(upstreamEntry.type, movePriority);
  const downstreamMovable = _isMovableType(downstreamEntry.type, movePriority);

  if (!upstreamMovable && !downstreamMovable) {
    return null;
  }
  if (upstreamMovable && !downstreamMovable) {
    return { side: 'upstream', mover: upstreamEntry, fixed: downstreamEntry };
  }
  if (!upstreamMovable && downstreamMovable) {
    return { side: 'downstream', mover: downstreamEntry, fixed: upstreamEntry };
  }

  if (upstreamRank < downstreamRank) {
    return { side: 'upstream', mover: upstreamEntry, fixed: downstreamEntry };
  }
  if (downstreamRank < upstreamRank) {
    return { side: 'downstream', mover: downstreamEntry, fixed: upstreamEntry };
  }

  return options.preferUpstreamComponent
    ? { side: 'upstream', mover: upstreamEntry, fixed: downstreamEntry }
    : { side: 'downstream', mover: downstreamEntry, fixed: upstreamEntry };
}

function _buildMismatchRecord(group, upstreamEntry, downstreamEntry, gapVector, gapMm, toleranceMm, passIndex, pairIndex) {
  const signedDeviationMm = _dominantAxisSignedDeviation(gapVector, gapMm);
  return {
    pipelineRef: group.pipelineRef,
    passIndex,
    pairIndex,
    upstream: {
      id: upstreamEntry.id,
      type: upstreamEntry.type,
      index: upstreamEntry.index,
    },
    downstream: {
      id: downstreamEntry.id,
      type: downstreamEntry.type,
      index: downstreamEntry.index,
    },
    gapMm: _round3(gapMm),
    signedDeviationMm: _round3(signedDeviationMm),
    classification: signedDeviationMm < 0 ? 'OVERLAP' : 'GAP',
    deltaVector: {
      x: _round3(gapVector?.x),
      y: _round3(gapVector?.y),
      z: _round3(gapVector?.z),
    },
    fixable: gapMm <= toleranceMm,
  };
}

function _evaluateGroups(groups, options, allowAdjustments) {
  const report = {
    ok: true,
    maxDeviationMm: 0,
    fixableCount: 0,
    fatalCount: 0,
    mismatches: [],
    adjustments: [],
    unresolved: [],
  };
  const movePriority = Array.isArray(options.continuityMovePriority) ? options.continuityMovePriority : [...DEFAULT_MOVE_PRIORITY];
  const toleranceMm = Number(options.continuityMismatchToleranceMm);
  const enableAdjust = allowAdjustments && options.continuityAutoAdjustEnabled !== false;
  const dedupe = new Set();

  const workingGroups = Array.isArray(groups) ? groups : [];

  for (const group of workingGroups) {
    const chain = _buildChain(group.components);
    const pairIndices = [];
    for (let pairIndex = 0; pairIndex < chain.length - 1; pairIndex += 1) {
      pairIndices.push(pairIndex);
    }
    if (enableAdjust) {
      pairIndices.reverse();
    }

    for (const pairIndex of pairIndices) {
      const upstreamEntry = chain[pairIndex];
      const downstreamEntry = chain[pairIndex + 1];
      const key = `${group.pipelineRef}|${upstreamEntry.id}|${downstreamEntry.id}`;
      const gapVector = _deltaVector(upstreamEntry.exit, downstreamEntry.entry);
      const gapMm = _distance(upstreamEntry.exit, downstreamEntry.entry);
      if (gapMm == null) continue;
      if (gapMm === 0) continue;

      report.maxDeviationMm = Math.max(report.maxDeviationMm, gapMm);
      const mismatch = _buildMismatchRecord(group, upstreamEntry, downstreamEntry, gapVector, gapMm, toleranceMm, 0, pairIndex);

      if (!dedupe.has(key)) {
        report.mismatches.push(mismatch);
        dedupe.add(key);
      }

      if (gapMm > toleranceMm) {
        report.fatalCount += 1;
        report.unresolved.push({
          ...mismatch,
          reason: 'ABOVE_TOLERANCE',
        });
        report.ok = false;
        continue;
      }

      report.fixableCount += 1;

      if (!enableAdjust) {
        continue;
      }

      const selection = _selectMover(upstreamEntry, downstreamEntry, options, movePriority);
      if (!selection) {
        report.fatalCount += 1;
        report.ok = false;
        report.unresolved.push({
          ...mismatch,
          reason: 'NO_MOVABLE_COMPONENT',
        });
        continue;
      }

      const translation = selection.side === 'upstream'
        ? gapVector
        : {
            x: -Number(gapVector.x || 0),
            y: -Number(gapVector.y || 0),
            z: -Number(gapVector.z || 0),
          };

      const moverExitBefore = _clonePoint(selection.mover.exit);
      const fixedEntryBefore = _clonePoint(selection.fixed.entry);
      const moved = _translateComponent(selection.mover.component, translation);
      selection.mover.component = moved;
      selection.mover.entry = _entryPoint(moved);
      selection.mover.exit = _exitPoint(moved);

      report.adjustments.push({
        pipelineRef: group.pipelineRef,
        side: selection.side,
        movedComponent: {
          id: selection.mover.id,
          type: selection.mover.type,
          index: selection.mover.index,
        },
        fixedComponent: {
          id: selection.fixed.id,
          type: selection.fixed.type,
          index: selection.fixed.index,
        },
        translationMm: {
          x: Number((translation.x || 0).toFixed(3)),
          y: Number((translation.y || 0).toFixed(3)),
          z: Number((translation.z || 0).toFixed(3)),
        },
        before: {
          moverExit: moverExitBefore,
          fixedEntry: fixedEntryBefore,
        },
        after: {
          moverExit: _clonePoint(selection.mover.exit),
          fixedEntry: _clonePoint(selection.fixed.entry),
        },
      });
    }
  }

  return {
    report,
    groups: workingGroups,
  };
}

function _groupComponents(components) {
  const groups = [];
  let currentRef = null;
  let current = null;

  for (const component of components) {
    if (component?.include === false) {
      continue;
    }
    const type = _componentType(component);
    if (!type || NON_MOVABLE_TYPES.has(type) || type.startsWith('MESSAGE-')) {
      continue;
    }

    const pipelineRef = _pipelineRef(component, currentRef || 'RVM-EXTRACT');
    if (current && currentRef === pipelineRef) {
      current.components.push(component);
      continue;
    }

    current = { pipelineRef, components: [component] };
    currentRef = pipelineRef;
    groups.push(current);
  }

  return groups;
}

/**
 * Check TEE branch points for connectivity.
 * A TEE whose branch1Point (bp) does not land on any component's ep1/ep2 within tolerance
 * is considered a "disconnected branch" — a common source of continuity issues.
 * Returns an array of disconnection records.
 */
function _checkTeeBranchConnectivity(components, toleranceMm) {
  const tol = Number(toleranceMm) || DEFAULT_TOLERANCE_MM;
  const disconnections = [];

  // Build a flat list of all non-message entry/exit points for proximity check
  const allPoints = [];
  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp?.include === false) continue;
    const type = _componentType(comp);
    if (!type || NON_MOVABLE_TYPES.has(type) || type.startsWith('MESSAGE-')) continue;
    const entry = _clonePoint(comp?.ep1 || comp?.coOrds || null);
    const exit  = _clonePoint(comp?.ep2 || comp?.bp || null);
    if (_isFinitePoint(entry)) allPoints.push({ point: entry, compIndex: i, role: 'entry', comp });
    if (_isFinitePoint(exit))  allPoints.push({ point: exit, compIndex: i, role: 'exit', comp });
  }

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp?.include === false) continue;
    const type = _componentType(comp);
    if (type !== 'TEE') continue;

    // bp is the branch1Point (third port of TEE)
    const bp = _clonePoint(comp?.bp || comp?.coOrds || null);
    // cp is the centrePoint — if bp == cp the branch is zero-length in PCF
    const cp = _clonePoint(comp?.cp || comp?.coOrds || null);

    if (!_isFinitePoint(bp)) continue;

    // If bp == cp (BP1 = CP in PCF: branch-1-point at centre), it means the branch has no
    // downstream pipe. This is a disconnected branch.
    if (_isFinitePoint(cp) && _distance(bp, cp) < tol) {
      disconnections.push({
        pipelineRef: _pipelineRef(comp, 'RVM-EXTRACT'),
        compIndex: i,
        id: _componentId(comp, i),
        type: 'TEE',
        issue: 'BRANCH_AT_CENTRE',
        branchPoint: bp,
        centrePoint: cp,
        message: `TEE branch1-point equals centre-point (BP1=CP in PCF). No downstream branch pipe connected.`,
        fatal: true,
      });
      continue;
    }

    // Otherwise check if the bp is connected to any other component's endpoint
    let connected = false;
    for (const { point, compIndex } of allPoints) {
      if (compIndex === i) continue; // skip self
      if (_isFinitePoint(point) && _distance(bp, point) <= tol) {
        connected = true;
        break;
      }
    }

    if (!connected) {
      disconnections.push({
        pipelineRef: _pipelineRef(comp, 'RVM-EXTRACT'),
        compIndex: i,
        id: _componentId(comp, i),
        type: 'TEE',
        issue: 'BRANCH_DISCONNECTED',
        branchPoint: bp,
        message: `TEE branch-point not connected to any component within ${tol}mm tolerance. Disconnected branch pipe.`,
        fatal: true,
      });
    }
  }

  return disconnections;
}

function _cloneItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => _cloneComponent(item));
}

function _reportFromEvaluation(evaluation, options, teeDisconnections) {
  const report = evaluation.report;
  const teeDC = Array.isArray(teeDisconnections) ? teeDisconnections : [];
  const teeFatalCount = teeDC.filter(d => d.fatal).length;
  return {
    ok: report.fatalCount === 0 && teeFatalCount === 0,
    toleranceMm: Number(options.continuityMismatchToleranceMm),
    movePriority: [...options.continuityMovePriority],
    autoAdjustEnabled: options.continuityAutoAdjustEnabled !== false,
    preferUpstreamComponent: options.preferUpstreamComponent !== false,
    maxDeviationMm: Number(report.maxDeviationMm.toFixed(3)),
    fixableCount: report.fixableCount,
    fatalCount: report.fatalCount + teeFatalCount,
    mismatches: report.mismatches,
    adjustments: report.adjustments,
    unresolved: report.unresolved,
    teeDisconnections: teeDC,
  };
}

export function analyzeContinuityComponents(components, rawOptions) {
  const options = _normalizeOptions(rawOptions);
  const safeComponents = Array.isArray(components) ? components : [];
  const groups = _groupComponents(safeComponents);
  const evaluation = _evaluateGroups(groups, options, false);
  const teeDisconnections = _checkTeeBranchConnectivity(safeComponents, options.continuityMismatchToleranceMm);
  return _reportFromEvaluation(evaluation, options, teeDisconnections);
}



export function applyContinuityAutoBalanceComponents(components, rawOptions) {
  const options = _normalizeOptions(rawOptions);
  const clonedComponents = _cloneItems(Array.isArray(components) ? components : []);
  const groups = _groupComponents(clonedComponents);
  const evaluation = _evaluateGroups(groups, options, true);
  const teeDisconnections = _checkTeeBranchConnectivity(clonedComponents, options.continuityMismatchToleranceMm);

  return {
    components: clonedComponents,
    report: _reportFromEvaluation(evaluation, options, teeDisconnections),
  };
}


export function analyzePcfTextContinuity(pcfText, rawOptions) {
  const parsed = parsePcfText(String(pcfText || ''), null);
  const normalized = normalizePcfModel(parsed, null);
  return analyzeContinuityComponents(normalized.components || [], rawOptions);
}

export function applyPcfTextContinuityAutoBalance(pcfText, rawOptions) {
  const parsed = parsePcfText(String(pcfText || ''), null);
  const normalized = normalizePcfModel(parsed, null);
  const result = applyContinuityAutoBalanceComponents(normalized.components || [], rawOptions);
  return {
    ...result,
    parsed,
    normalized,
  };
}

export class RvmPcfContinuityChecker {
  analyzeComponents(components, options) {
    return analyzeContinuityComponents(components, options);
  }

  applyAutoBalanceComponents(components, options) {
    return applyContinuityAutoBalanceComponents(components, options);
  }

  analyzePcfText(pcfText, options) {
    return analyzePcfTextContinuity(pcfText, options);
  }

  applyPcfTextAutoBalance(pcfText, options) {
    return applyPcfTextContinuityAutoBalance(pcfText, options);
  }
}
