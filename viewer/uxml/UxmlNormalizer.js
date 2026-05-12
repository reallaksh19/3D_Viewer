/**
 * UxmlNormalizer.js
 *
 * Agent 02: XML/InputXML/BenchmarkXML → UXML normalizer skeleton.
 *
 * Scope:
 * - Convert known XML profile text into UXML document object shape.
 * - Preserve source/provenance/loss/diagnostics.
 * - Extract simple components, anchors, ports and segments where safe.
 *
 * Out of scope:
 * - UniversalTopoGraph solving.
 * - Ray topology.
 * - PCF emission.
 * - Master resolution.
 * - PDF/REV/JSON/TXT raw parsing.
 */

import {
  ANCHOR_ROLES,
  COMPONENT_TYPES,
  CONFIDENCE_LEVELS,
  PORT_ROLES,
  SEGMENT_TYPES,
  SOURCE_FORMATS,
  UXML_PROFILES,
  XML_PROFILES,
} from './UxmlConstants.js';

import {
  createUxmlAnchor,
  createUxmlComponent,
  createUxmlDiagnostic,
  createUxmlDocument,
  createUxmlLoss,
  createUxmlMapping,
  createUxmlPipeline,
  createUxmlPort,
  createUxmlSegment,
  createUxmlSource,
} from './UxmlTypes.js';

import {
  assertXmlProfileBuildAllowed,
  detectUxmlProfile,
} from './UxmlProfileDetector.js';

const NORMALIZER_SCHEMA = 'uxml-normalizer/v1';

function clean(value) {
  return String(value ?? '').trim();
}

function upper(value) {
  return clean(value).toUpperCase();
}

function safeId(value, fallback) {
  const raw = clean(value);
  if (!raw) return fallback;
  return raw.replace(/[^\w:.-]+/g, '-');
}

function pad(num) {
  return String(num).padStart(5, '0');
}

function attrValue(attrs, ...names) {
  for (const name of names) {
    if (attrs[name] != null && clean(attrs[name])) return clean(attrs[name]);
    const lower = Object.keys(attrs).find(k => k.toLowerCase() === String(name).toLowerCase());
    if (lower && clean(attrs[lower])) return clean(attrs[lower]);
  }
  return '';
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseAttrs(attrText = '') {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;

  while ((match = re.exec(attrText))) {
    attrs[match[1]] = match[3] ?? match[4] ?? '';
  }

  return attrs;
}

function parseTagOpenAttrs(tagOpen = '') {
  const m = String(tagOpen).match(/^<\s*[A-Za-z_:][\w:.-]*\s*([\s\S]*?)\/?\s*>$/);
  return parseAttrs(m?.[1] || '');
}

function findElements(xmlText, tagName) {
  const tag = String(tagName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const results = [];

  const pair = new RegExp(`<\\s*(?:[\\w.-]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\s*\\/\\s*(?:[\\w.-]+:)?${tag}\\s*>`, 'gi');
  let match;

  while ((match = pair.exec(xmlText))) {
    results.push({
      open: match[0].slice(0, match[0].indexOf('>') + 1),
      attrs: parseAttrs(match[1] || ''),
      inner: match[2] || '',
      selfClosing: false,
      raw: match[0],
    });
  }

  const self = new RegExp(`<\\s*(?:[\\w.-]+:)?${tag}\\b([^>]*)\\/\\s*>`, 'gi');

  while ((match = self.exec(xmlText))) {
    results.push({
      open: match[0],
      attrs: parseAttrs(match[1] || ''),
      inner: '',
      selfClosing: true,
      raw: match[0],
    });
  }

  return results;
}

function parsePointText(value) {
  const text = clean(value);
  if (!text) return null;

  const parts = text
    .split(/[,\s]+/)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));

  if (parts.length < 3) return null;

  return {
    x: parts[0],
    y: parts[1],
    z: parts[2],
  };
}

function parsePointAttrs(attrs) {
  const x = numberOrNull(attrValue(attrs, 'x', 'X', 'e', 'E', 'east', 'EAST'));
  const y = numberOrNull(attrValue(attrs, 'y', 'Y', 'n', 'N', 'north', 'NORTH'));
  const z = numberOrNull(attrValue(attrs, 'z', 'Z', 'elev', 'ELEV', 'elevation', 'ELEVATION'));

  if (x == null || y == null || z == null) return null;

  return { x, y, z };
}

function parsePointFromComponentAttr(attrs, ...names) {
  for (const name of names) {
    const value = attrValue(attrs, name);
    const point = parsePointText(value);
    if (point) return point;
  }

  return null;
}

function detectComponentType(rawType) {
  const t = upper(rawType);

  if (!t) return COMPONENT_TYPES.UNKNOWN;
  if (t.includes('PIPE')) return COMPONENT_TYPES.PIPE;
  if (t.includes('TEE')) return COMPONENT_TYPES.TEE;
  if (t.includes('WELDOLET')) return COMPONENT_TYPES.WELDOLET;
  if (t.includes('SOCKOLET')) return COMPONENT_TYPES.SOCKOLET;
  if (t.includes('OLET')) return COMPONENT_TYPES.OLET;
  if (t.includes('BEND')) return COMPONENT_TYPES.BEND;
  if (t.includes('ELBOW')) return COMPONENT_TYPES.ELBOW;
  if (t.includes('VALVE')) return COMPONENT_TYPES.VALVE;
  if (t.includes('FLANGE') && t.includes('BLIND')) return COMPONENT_TYPES.BLIND_FLANGE;
  if (t.includes('FLANGE')) return COMPONENT_TYPES.FLANGE;
  if (t.includes('GASK')) return COMPONENT_TYPES.GASKET;
  if (t.includes('REDUCER') && t.includes('ECC')) return COMPONENT_TYPES.REDUCER_ECCENTRIC;
  if (t.includes('REDUCER')) return COMPONENT_TYPES.REDUCER_CONCENTRIC;
  if (t.includes('SUPPORT') || t.startsWith('PS')) return COMPONENT_TYPES.SUPPORT;

  return t;
}

function portRoleFor(type, anchorRole) {
  const t = upper(type);
  const role = upper(anchorRole);

  if (t === COMPONENT_TYPES.PIPE) {
    if (role === ANCHOR_ROLES.EP1) return PORT_ROLES.PIPE_END_1;
    if (role === ANCHOR_ROLES.EP2) return PORT_ROLES.PIPE_END_2;
  }

  if (t === COMPONENT_TYPES.TEE) {
    if (role === ANCHOR_ROLES.EP1) return PORT_ROLES.TEE_MAIN_1;
    if (role === ANCHOR_ROLES.EP2) return PORT_ROLES.TEE_MAIN_2;
    if (role === ANCHOR_ROLES.BP) return PORT_ROLES.TEE_BRANCH;
  }

  if (['OLET', 'WELDOLET', 'SOCKOLET'].includes(t)) {
    if (role === ANCHOR_ROLES.CP) return PORT_ROLES.OLET_HEADER_TAP;
    if (role === ANCHOR_ROLES.BP) return PORT_ROLES.OLET_BRANCH;
  }

  if (t.includes('VALVE')) {
    if (role === ANCHOR_ROLES.EP1) return PORT_ROLES.VALVE_END_1;
    if (role === ANCHOR_ROLES.EP2) return PORT_ROLES.VALVE_END_2;
  }

  if (t.includes('FLANGE')) {
    if (role === ANCHOR_ROLES.EP1) return PORT_ROLES.FLANGE_END_1;
    if (role === ANCHOR_ROLES.EP2) return PORT_ROLES.FLANGE_END_2;
  }

  if (t.includes('REDUCER')) {
    if (role === ANCHOR_ROLES.EP1) return PORT_ROLES.REDUCER_END_1;
    if (role === ANCHOR_ROLES.EP2) return PORT_ROLES.REDUCER_END_2;
  }

  if (role === ANCHOR_ROLES.SUPPORT_POINT || role === ANCHOR_ROLES.POS) {
    return PORT_ROLES.SUPPORT_POINT;
  }

  if (role === ANCHOR_ROLES.EP1) return `${t}_END_1`;
  if (role === ANCHOR_ROLES.EP2) return `${t}_END_2`;

  return `${t}_${role}`;
}

function segmentTypeFor(type) {
  const t = upper(type);

  if (t === COMPONENT_TYPES.PIPE) return SEGMENT_TYPES.PIPE_RUN;
  if (t === COMPONENT_TYPES.TEE) return SEGMENT_TYPES.TEE_MAIN_RUN;
  if (t === COMPONENT_TYPES.OLET || t === COMPONENT_TYPES.WELDOLET || t === COMPONENT_TYPES.SOCKOLET) {
    return SEGMENT_TYPES.OLET_BRANCH_LEG;
  }
  if (t === COMPONENT_TYPES.BEND || t === COMPONENT_TYPES.ELBOW) return SEGMENT_TYPES.BEND_CHORD;
  if (t.includes('VALVE')) return SEGMENT_TYPES.VALVE_AXIS;
  if (t.includes('FLANGE')) return SEGMENT_TYPES.FLANGE_AXIS;
  if (t.includes('REDUCER')) return SEGMENT_TYPES.REDUCER_AXIS;

  return '';
}

function ensurePipeline(doc, pipelineRef, lineKey = '') {
  const ref = clean(pipelineRef);
  if (!ref) return '';

  const existing = doc.pipelines.find(p => p.pipelineRef === ref);
  if (existing) return existing.id;

  const id = `PL-${pad(doc.pipelines.length + 1)}`;

  doc.pipelines.push(createUxmlPipeline({
    id,
    pipelineRef: ref,
    lineKey: lineKey || ref,
    lineNo: lineKey || '',
  }));

  return id;
}

function pushDiagnostic(doc, overrides) {
  const diagnostic = createUxmlDiagnostic({
    id: `D-${pad(doc.diagnostics.length + 1)}`,
    ...overrides,
  });

  doc.diagnostics.push(diagnostic);
  return diagnostic;
}

function pushLoss(doc, overrides) {
  const loss = createUxmlLoss({
    id: `L-${pad(doc.lossContract.length + 1)}`,
    ...overrides,
  });

  doc.lossContract.push(loss);
  return loss;
}

function addSource(doc, xmlText, options, profileReport) {
  const source = createUxmlSource({
    id: 'SRC-00001',
    format: options.sourceFormat || profileReport.profile || SOURCE_FORMATS.XML,
    path: options.path || '',
    name: options.name || options.fileName || '',
    role: 'PRIMARY',
    diagnostics: [],
  });

  source.hash = options.hash || `chars:${xmlText.length}`;
  doc.sources.push(source);

  return source.id;
}

function addMapping(doc, sourceField, targetField, profile) {
  doc.mappings.push(createUxmlMapping({
    id: `MAP-${pad(doc.mappings.length + 1)}`,
    profile,
    sourceFormat: profile,
    sourceField,
    targetField,
    confidence: CONFIDENCE_LEVELS.ALIASED_SOURCE,
  }));
}

function addAnchorPort(doc, component, role, point, sourceField, connectsTo = 'ENDPOINT') {
  if (!point) return null;

  const anchorId = `A-${component.id}-${role}`;

  const anchor = createUxmlAnchor({
    id: anchorId,
    componentId: component.id,
    role,
    point,
    sourceField,
    confidence: CONFIDENCE_LEVELS.ALIASED_SOURCE,
  });

  const portRole = portRoleFor(component.normalizedType || component.type, role);
  const portId = `P-${component.id}-${portRole}`;

  const isPipeEndpoint =
    component.normalizedType === COMPONENT_TYPES.PIPE &&
    [ANCHOR_ROLES.EP1, ANCHOR_ROLES.EP2].includes(role);

  const port = createUxmlPort({
    id: portId,
    componentId: component.id,
    anchorId,
    role: portRole,
    point,
    bore: component.bore,
    branchBore: component.branchBore,
    fixed: !isPipeEndpoint,
    futureMovable: isPipeEndpoint,
    mutableNow: false,
    connectsTo,
    maxDegree: 1,
  });

  doc.anchors.push(anchor);
  doc.ports.push(port);

  component.anchorIds.push(anchorId);
  component.portIds.push(portId);

  return { anchor, port };
}

function addSegmentIfPossible(doc, component, startRole = ANCHOR_ROLES.EP1, endRole = ANCHOR_ROLES.EP2) {
  const startAnchorId = `A-${component.id}-${startRole}`;
  const endAnchorId = `A-${component.id}-${endRole}`;

  const hasStart = doc.anchors.some(a => a.id === startAnchorId);
  const hasEnd = doc.anchors.some(a => a.id === endAnchorId);

  if (!hasStart || !hasEnd) return null;

  const type = segmentTypeFor(component.normalizedType || component.type);
  if (!type) return null;

  const segment = createUxmlSegment({
    id: `S-${component.id}-001`,
    componentId: component.id,
    type,
    startAnchorId,
    endAnchorId,
    bore: component.bore,
  });

  doc.segments.push(segment);
  component.segmentIds.push(segment.id);

  return segment;
}

function extractInlinePoint(componentInner, tagNames, fallbackRole) {
  for (const tagName of tagNames) {
    const tags = findElements(componentInner, tagName);

    for (const tag of tags) {
      const attrs = tag.attrs;
      const role = upper(attrValue(attrs, 'role', 'name', 'key', 'type'));
      const point = parsePointAttrs(attrs) || parsePointText(clean(tag.inner));

      if (!point) continue;

      if (!role && fallbackRole) return { role: fallbackRole, point, sourceField: tagName };
      if (role === fallbackRole) return { role: fallbackRole, point, sourceField: tagName };
      if (fallbackRole === ANCHOR_ROLES.EP1 && ['EP1', 'END1', 'START'].includes(role)) {
        return { role: fallbackRole, point, sourceField: tagName };
      }
      if (fallbackRole === ANCHOR_ROLES.EP2 && ['EP2', 'END2', 'END'].includes(role)) {
        return { role: fallbackRole, point, sourceField: tagName };
      }
      if (fallbackRole === ANCHOR_ROLES.CP && ['CP', 'CENTRE', 'CENTER', 'CENTRE-POINT', 'CENTER-POINT'].includes(role)) {
        return { role: fallbackRole, point, sourceField: tagName };
      }
      if (fallbackRole === ANCHOR_ROLES.BP && ['BP', 'BRANCH', 'BRANCH-POINT'].includes(role)) {
        return { role: fallbackRole, point, sourceField: tagName };
      }
    }
  }

  return null;
}

function extractStandardComponentPoints(attrs, inner) {
  const points = {};

  points.ep1 =
    parsePointFromComponentAttr(attrs, 'ep1', 'EP1', 'start', 'startPoint', 'start-point') ||
    extractInlinePoint(inner, ['EndPoint', 'Endpoint', 'Point'], ANCHOR_ROLES.EP1)?.point ||
    null;

  points.ep2 =
    parsePointFromComponentAttr(attrs, 'ep2', 'EP2', 'end', 'endPoint', 'end-point') ||
    extractInlinePoint(inner, ['EndPoint', 'Endpoint', 'Point'], ANCHOR_ROLES.EP2)?.point ||
    null;

  points.cp =
    parsePointFromComponentAttr(attrs, 'cp', 'CP', 'centrePoint', 'centerPoint', 'centre-point', 'center-point') ||
    extractInlinePoint(inner, ['CentrePoint', 'CenterPoint', 'Point'], ANCHOR_ROLES.CP)?.point ||
    null;

  points.bp =
    parsePointFromComponentAttr(attrs, 'bp', 'BP', 'branchPoint', 'branch-point') ||
    extractInlinePoint(inner, ['BranchPoint', 'Point'], ANCHOR_ROLES.BP)?.point ||
    null;

  return points;
}

function normalizeStandardXml(xmlText, doc, sourceId) {
  addMapping(doc, 'Component', 'components[]', XML_PROFILES.STANDARD_XML);
  addMapping(doc, 'EndPoint/EP1', 'anchors[role=EP1]', XML_PROFILES.STANDARD_XML);
  addMapping(doc, 'EndPoint/EP2', 'anchors[role=EP2]', XML_PROFILES.STANDARD_XML);
  addMapping(doc, 'CentrePoint/CP', 'anchors[role=CP]', XML_PROFILES.STANDARD_XML);
  addMapping(doc, 'BranchPoint/BP', 'anchors[role=BP]', XML_PROFILES.STANDARD_XML);

  const componentTags = [
    ...findElements(xmlText, 'Component'),
    ...findElements(xmlText, 'Pipe'),
    ...findElements(xmlText, 'Fitting'),
    ...findElements(xmlText, 'Support'),
  ];

  const seenRaw = new Set();
  const uniqueTags = componentTags.filter(tag => {
    if (seenRaw.has(tag.raw)) return false;
    seenRaw.add(tag.raw);
    return true;
  });

  if (!uniqueTags.length) {
    pushDiagnostic(doc, {
      severity: 'WARNING',
      code: 'UXML-NORMALIZER-STANDARD-NO-COMPONENTS',
      message: 'STANDARD_XML profile detected but no Component/Pipe/Fitting/Support tags were extracted.',
      sourceId,
    });
  }

  uniqueTags.forEach((tag, index) => {
    const attrs = tag.attrs;
    const explicitType = attrValue(attrs, 'type', 'componentType', 'component-type', 'class', 'skey') || tag.open.match(/^<\s*([\w:.-]+)/)?.[1];
    const normalizedType = detectComponentType(explicitType);
    const id = safeId(attrValue(attrs, 'id', 'componentId', 'refNo', 'ref'), `C-${pad(index + 1)}`);
    const pipelineRef = attrValue(attrs, 'pipelineRef', 'pipeline-ref', 'pipeline', 'line', 'lineRef');
    const lineKey = attrValue(attrs, 'lineKey', 'line-key', 'lineNo', 'line-no');

    ensurePipeline(doc, pipelineRef, lineKey);

    const component = createUxmlComponent({
      id,
      sourceRefs: [sourceId],
      type: clean(explicitType) || normalizedType,
      normalizedType,
      pipelineRef,
      lineKey,
      refNo: attrValue(attrs, 'refNo', 'ref-no', 'ca97', 'CA97', 'ref'),
      seqNo: attrValue(attrs, 'seqNo', 'seq-no', 'ca98', 'CA98', 'sequence'),
      name: attrValue(attrs, 'name', 'tag'),
      bore: numberOrNull(attrValue(attrs, 'bore', 'convertedBore', 'size', 'nps')),
      branchBore: numberOrNull(attrValue(attrs, 'branchBore', 'branchConvertedBore', 'branch-size')),
      skey: attrValue(attrs, 'skey', 'SKEY'),
      rawAttributes: { ...attrs },
      confidence: CONFIDENCE_LEVELS.ALIASED_SOURCE,
    });

    const points = extractStandardComponentPoints(attrs, tag.inner);

    addAnchorPort(doc, component, ANCHOR_ROLES.EP1, points.ep1, 'EP1');
    addAnchorPort(doc, component, ANCHOR_ROLES.EP2, points.ep2, 'EP2');
    addAnchorPort(doc, component, ANCHOR_ROLES.CP, points.cp, 'CP', normalizedType === COMPONENT_TYPES.OLET ? 'SEGMENT' : 'ENDPOINT');
    addAnchorPort(doc, component, ANCHOR_ROLES.BP, points.bp, 'BP');

    addSegmentIfPossible(doc, component);

    if (normalizedType === COMPONENT_TYPES.TEE && !points.bp) {
      pushLoss(doc, {
        severity: 'WARNING',
        code: 'UXML-TEE-BP-MISSING',
        componentId: component.id,
        sourceId,
        message: 'TEE component has no BP/branch point in STANDARD_XML extraction.',
      });
    }

    if (
      [COMPONENT_TYPES.OLET, COMPONENT_TYPES.WELDOLET, COMPONENT_TYPES.SOCKOLET].includes(normalizedType) &&
      (!points.cp || !points.bp)
    ) {
      pushLoss(doc, {
        severity: 'WARNING',
        code: 'UXML-OLET-CP-BP-INCOMPLETE',
        componentId: component.id,
        sourceId,
        message: 'OLET component needs CP and BP for robust branch topology.',
      });
    }

    doc.components.push(component);
  });

  return doc;
}

function normalizeInputXml(xmlText, doc, sourceId) {
  addMapping(doc, 'Node', 'anchors[]', XML_PROFILES.INPUT_XML);
  addMapping(doc, 'Element', 'components[]/segments[]', XML_PROFILES.INPUT_XML);

  const nodeMap = new Map();

  for (const nodeTag of findElements(xmlText, 'Node')) {
    const attrs = nodeTag.attrs;
    const id = attrValue(attrs, 'id', 'name', 'number', 'nodeNo', 'node-no');
    const point = parsePointAttrs(attrs) || parsePointText(clean(nodeTag.inner));

    if (id && point) {
      nodeMap.set(id, point);
    }
  }

  const elementTags = [
    ...findElements(xmlText, 'Element'),
    ...findElements(xmlText, 'PipeElement'),
    ...findElements(xmlText, 'Member'),
  ];

  if (!elementTags.length) {
    pushDiagnostic(doc, {
      severity: 'WARNING',
      code: 'UXML-NORMALIZER-INPUTXML-NO-ELEMENTS',
      message: 'INPUT_XML profile detected but no Element/PipeElement/Member tags were extracted.',
      sourceId,
    });
  }

  elementTags.forEach((tag, index) => {
    const attrs = tag.attrs;
    const id = safeId(attrValue(attrs, 'id', 'elementNo', 'element-no', 'number'), `E-${pad(index + 1)}`);
    const type = detectComponentType(attrValue(attrs, 'type', 'componentType', 'kind') || 'PIPE');
    const startNode = attrValue(attrs, 'startNode', 'start-node', 'from', 'fromNode', 'node1', 'start');
    const endNode = attrValue(attrs, 'endNode', 'end-node', 'to', 'toNode', 'node2', 'end');

    const ep1 = nodeMap.get(startNode) || parsePointFromComponentAttr(attrs, 'ep1', 'startPoint');
    const ep2 = nodeMap.get(endNode) || parsePointFromComponentAttr(attrs, 'ep2', 'endPoint');

    const pipelineRef = attrValue(attrs, 'pipelineRef', 'pipeline-ref', 'line', 'lineNo');
    ensurePipeline(doc, pipelineRef, attrValue(attrs, 'lineKey', 'lineNo'));

    const component = createUxmlComponent({
      id,
      sourceRefs: [sourceId],
      type,
      normalizedType: type,
      pipelineRef,
      lineKey: attrValue(attrs, 'lineKey', 'lineNo'),
      refNo: attrValue(attrs, 'refNo', 'ca97'),
      seqNo: attrValue(attrs, 'seqNo', 'ca98', 'number'),
      bore: numberOrNull(attrValue(attrs, 'bore', 'diameter', 'size')),
      rawAttributes: {
        ...attrs,
        startNode,
        endNode,
      },
      confidence: CONFIDENCE_LEVELS.ALIASED_SOURCE,
    });

    addAnchorPort(doc, component, ANCHOR_ROLES.EP1, ep1, startNode ? `Node:${startNode}` : 'EP1');
    addAnchorPort(doc, component, ANCHOR_ROLES.EP2, ep2, endNode ? `Node:${endNode}` : 'EP2');
    addSegmentIfPossible(doc, component);

    if (!ep1 || !ep2) {
      pushLoss(doc, {
        severity: 'WARNING',
        code: 'UXML-INPUTXML-ELEMENT-ENDPOINT-INCOMPLETE',
        componentId: component.id,
        sourceId,
        message: `InputXML element ${id} does not resolve both endpoint nodes.`,
        details: { startNode, endNode },
      });
    }

    doc.components.push(component);
  });

  pushDiagnostic(doc, {
    severity: 'INFO',
    code: 'UXML-NORMALIZER-INPUTXML-NODES-READ',
    message: `Read ${nodeMap.size} InputXML node coordinate(s).`,
    sourceId,
  });

  return doc;
}

function normalizeUxmlPassthrough(xmlText, doc, sourceId) {
  doc.profile = UXML_PROFILES.TOPOLOGY_FULL;

  pushDiagnostic(doc, {
    severity: 'INFO',
    code: 'UXML-PASSTHROUGH-PROFILE-DETECTED',
    message: 'Input is already UXML. Agent 02 preserves it as source and does not destructively reparse full UXML yet.',
    sourceId,
    details: {
      characterCount: xmlText.length,
    },
  });

  return doc;
}

function normalizeBenchmarkXml(xmlText, doc, sourceId) {
  pushDiagnostic(doc, {
    severity: 'INFO',
    code: 'UXML-BENCHMARK-PROFILE-DETECTED',
    message: 'Benchmark XML detected. Agent 02 preserves benchmark XML as source only; topology normalization is not attempted.',
    sourceId,
    details: {
      characterCount: xmlText.length,
    },
  });

  pushLoss(doc, {
    severity: 'INFO',
    code: 'UXML-BENCHMARK-NOT-TOPOLOGY-SOURCE',
    sourceId,
    message: 'Benchmark XML is not treated as topology source in Agent 02 skeleton.',
  });

  return doc;
}

function blockedResult(xmlText, options, profileReport, reasonCode) {
  const doc = createUxmlDocument({
    profile: UXML_PROFILES.TOPOLOGY_LITE,
  });

  const sourceId = addSource(doc, xmlText, options, profileReport);

  pushDiagnostic(doc, {
    severity: 'ERROR',
    code: reasonCode,
    message: `UXML normalization blocked: ${profileReport.blockers.join(', ') || reasonCode}`,
    sourceId,
    details: {
      profileReport,
    },
  });

  pushLoss(doc, {
    severity: 'ERROR',
    code: reasonCode,
    sourceId,
    message: 'Input could not be normalized because XML profile detection blocked topology build.',
    details: {
      blockers: profileReport.blockers,
    },
  });

  return {
    schema: NORMALIZER_SCHEMA,
    ok: false,
    blocked: true,
    profileReport,
    uxml: doc,
    diagnostics: doc.diagnostics,
    stats: makeStats(doc),
  };
}

function makeStats(doc) {
  return {
    sourceCount: doc.sources.length,
    mappingCount: doc.mappings.length,
    pipelineCount: doc.pipelines.length,
    componentCount: doc.components.length,
    anchorCount: doc.anchors.length,
    portCount: doc.ports.length,
    segmentCount: doc.segments.length,
    supportCount: doc.supports.length,
    lossCount: doc.lossContract.length,
    diagnosticCount: doc.diagnostics.length,
  };
}

export function normalizeXmlToUxml(xmlText, options = {}) {
  const text = String(xmlText ?? '');
  const profileReport = options.profileReport || detectUxmlProfile(text);
  const buildAllowed = assertXmlProfileBuildAllowed(profileReport);

  if (!buildAllowed.ok) {
    return blockedResult(text, options, profileReport, profileReport.blockers[0] || 'UXML-NORMALIZER-BLOCKED');
  }

  const doc = createUxmlDocument({
    profile: UXML_PROFILES.TOPOLOGY_FULL,
  });

  const sourceId = addSource(doc, text, options, profileReport);

  pushDiagnostic(doc, {
    severity: 'INFO',
    code: 'UXML-NORMALIZER-STARTED',
    message: `Started UXML normalization for profile ${profileReport.profile}.`,
    sourceId,
  });

  if (profileReport.profile === XML_PROFILES.UXML) {
    normalizeUxmlPassthrough(text, doc, sourceId);
  } else if (profileReport.profile === XML_PROFILES.STANDARD_XML) {
    normalizeStandardXml(text, doc, sourceId);
  } else if (profileReport.profile === XML_PROFILES.INPUT_XML) {
    normalizeInputXml(text, doc, sourceId);
  } else if (profileReport.profile === XML_PROFILES.BENCHMARK_XML) {
    normalizeBenchmarkXml(text, doc, sourceId);
  } else {
    return blockedResult(text, options, profileReport, 'UXML-NORMALIZER-UNKNOWN-PROFILE');
  }

  pushDiagnostic(doc, {
    severity: 'INFO',
    code: 'UXML-NORMALIZER-COMPLETED',
    message: `Completed UXML normalization skeleton. Components=${doc.components.length}, Anchors=${doc.anchors.length}, Ports=${doc.ports.length}.`,
    sourceId,
  });

  return {
    schema: NORMALIZER_SCHEMA,
    ok: true,
    blocked: false,
    profileReport,
    uxml: doc,
    diagnostics: doc.diagnostics,
    stats: makeStats(doc),
  };
}

export const normalizeToUxml = normalizeXmlToUxml;
