/**
 * universal-xml-converter-tab.js
 * Universal XML converter workbench with CL1 route package chain.
 *
 * Inputs:
 * - XML, InputXML, or UXML source text plus optional source metadata.
 * Outputs:
 * - Profile detection, UXML pipeline state, route handoff, CL1 package,
 *   CL1 snapshot, replay validation, and one-screen CL1 summary.
 * Fallback:
 * - Raw PCF, JSON, TXT, PDF, and REV sources must use the existing
 *   converter bridge before UXML normalization.
 */

import { XML_PROFILES } from '../uxml/UxmlConstants.js';
import { detectXmlProfile } from '../uxml/UxmlProfileDetector.js';
import { normalizeXmlToUxml } from '../uxml/UxmlNormalizer.js';
import { validateUxmlDocument } from '../uxml/UxmlValidationGate.js';
import { buildUxmlFaceModel } from '../uxml/UxmlFaceModelBuilder.js';
import { buildUxmlUniversalTopoGraph } from '../uxml/UxmlUniversalTopoGraphBuilder.js';
import { buildUxmlRayTopoGraph } from '../uxml/UxmlRayTopoGraphBuilder.js';
import { compareUxmlTopoGraphs } from '../uxml/UxmlTopoGraphComparator.js';
import { decideUxmlTopologyAcceptance } from '../uxml/UxmlTopologyDecisionGate.js';
import {
  UXML_ROUTE_TARGETS,
  createUxmlRouteHandoffPayload,
  summarizeUxmlRouteHandoff,
} from '../uxml/UxmlRouteHandoffPolicy.js';
import {
  createUxmlCl1RoutePackage,
  summarizeUxmlCl1RoutePackage,
} from '../uxml/UxmlCl1RoutePackage.js';
import {
  buildUxmlCl1PackageSnapshot,
  serializeUxmlCl1PackageSnapshot,
} from '../uxml/UxmlCl1PackageSnapshot.js';
import {
  summarizeUxmlCl1SnapshotReplay,
  validateUxmlCl1SnapshotReplay,
} from '../uxml/UxmlCl1SnapshotReplayValidator.js';
import {
  buildUxmlCl1WorkbenchSummary,
  summarizeUxmlCl1WorkbenchSummary,
} from '../uxml/UxmlCl1WorkbenchSummary.js';

const SOURCE_TYPES = Object.freeze([
  { value: 'AUTO', label: 'Auto detect' },
  { value: 'EXISTING_XML', label: 'Existing XML / Standard XML' },
  { value: 'INPUT_XML', label: 'InputXML' },
  { value: 'UXML', label: 'UXML' },
  { value: 'PCF', label: 'PCF' },
  { value: 'PDF_TO_INPUTXML', label: 'PDF -> InputXML' },
  { value: 'REV_TO_XML', label: 'REV -> XML' },
  { value: 'JSON_TO_XML', label: 'JSON / staged JSON -> XML/InputXML' },
  { value: 'TXT_TO_XML', label: 'Attribute TXT -> XML' },
]);

const PIPELINE_STAGES = Object.freeze([
  { id: 'source', title: '1. Source Intake', description: 'Load PDF, REV, JSON, TXT, PCF, or XML source.' },
  { id: 'existing-converter', title: '2. Existing Converter Output', description: 'Use existing converter routes to produce InputXML or Standard XML.' },
  { id: 'uxml', title: '3. UXML Normalization', description: 'Normalize InputXML, Standard XML, or UXML into the Universal XML contract.' },
  { id: 'validation', title: '4. UXML Validation', description: 'Validate UXML structure, anchors, bore, branches, supports, and loss contract.' },
  { id: 'face-model', title: '5. Pre-Topology Face Model', description: 'Emit component/fitting faces for RayTopoBuilder before final topology.' },
  { id: 'universal-topology', title: '6. UniversalTopoGraph', description: 'Build a source-faithful topology graph from UXML faces.' },
  { id: 'ray-topology', title: '7. RayTopoGraph', description: 'Run the legacy-inspired Ray topology as an independent benchmark.' },
  { id: 'comparison', title: '8. Topology Comparison', description: 'Compare UniversalTopoGraph and RayTopoGraph evidence.' },
  { id: 'decision-gate', title: '9. Decision Gate', description: 'Convert comparator evidence into accepted, manual, or rejected topology decisions.' },
  { id: 'route-handoff', title: '10. Route Handoff Policy', description: 'Decide what downstream route may receive accepted topology evidence.' },
  { id: 'cl1-package', title: '11. CL1 Route Package', description: 'Create deterministic downstream route payload metadata without emitting PCF.' },
  { id: 'cl1-snapshot', title: '12. CL1 Snapshot JSON', description: 'Create deterministic debug/replay JSON snapshot from the CL1 package.' },
  { id: 'cl1-replay', title: '13. CL1 Replay Validator', description: 'Validate saved CL1 snapshot structure for debug/replay readiness.' },
  { id: 'cl1-summary', title: '14. CL1 QA Summary', description: 'One-screen status summary for decision, route handoff, CL1 package, and replay validation.' },
  { id: 'outputs', title: '15. Route Targets', description: 'Target routes such as Extract PCF, GLB, 2D, InputXML, or CII.' },
  { id: 'masters', title: '16. Masters by Target Route', description: 'Masters are handled by the downstream route. JSON/RVM -> PCF uses the existing legacy master route.' },
]);

const FULL_PIPELINE_ACTIONS = Object.freeze([
  'detect-profile',
  'convert-uxml',
  'validate-uxml',
  'build-face-model',
  'build-universal-topology',
  'build-ray-topology',
  'compare-topology',
  'run-decision-gate',
  'run-route-handoff',
  'run-cl1-package',
  'run-cl1-snapshot',
  'run-cl1-replay',
  'run-cl1-summary',
]);

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isScalar(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function statusClass(kind) {
  const value = String(kind || 'info').toLowerCase();
  if (value === 'ok') return 'uxml-status-ok';
  if (value === 'warn') return 'uxml-status-warn';
  if (value === 'error') return 'uxml-status-error';
  return 'uxml-status-info';
}

function reportPass(report) {
  if (!report) return false;
  return report.pass === true ||
    report.ok === true ||
    report.ready === true ||
    report.replayReady === true ||
    report.allowed === true ||
    report.outputBridgeReady === true ||
    report.exportAllowed === true ||
    report.readyForRouteConsumption === true ||
    report.schema === 'uxml-cl1-package-snapshot/v1';
}

function summarizeReport(report) {
  if (!report) return { pass: false, label: 'Not run', rows: [] };

  const rows = [];
  const push = (key, value) => {
    if (isScalar(value)) rows.push([key, value]);
  };

  push('schema', report.schema);
  push('profile', report.profile);
  push('confidence', report.confidence);
  push('targetRoute', report.targetRoute);
  push('snapshotId', report.snapshotId);
  push('packageId', report.packageId);
  push('overallStatus', report.overallStatus);
  push('ready', report.ready);
  push('ok', report.ok);
  push('allowed', report.allowed);
  push('replayReady', report.replayReady);
  push('outputBridgeReady', report.outputBridgeReady);
  push('exportAllowed', report.exportAllowed);
  push('blockCode', report.blockCode);
  push('blockedReason', report.blockedReason);

  const stats = report.stats || report.summary || {};
  for (const [key, value] of Object.entries(stats)) push(key, value);

  for (const [key, value] of Object.entries(report)) {
    if ([
      'stats',
      'summary',
      'report',
      'payload',
      'policy',
      'diagnostics',
      'lossContract',
      'stages',
    ].includes(key)) continue;
    push(key, value);
  }

  return {
    pass: reportPass(report),
    label: reportPass(report) ? 'Ready' : 'Review',
    rows: rows.slice(0, 36),
  };
}

function createInitialState() {
  return {
    sourceFile: null,
    sourceText: '',
    selectedSourceType: 'AUTO',
    detectedSourceType: 'AUTO',
    activePanel: 'source',
    status: { kind: 'info', message: 'Universal XML Converter tab is ready.' },
    pipeline: {
      profileReport: null,
      normalizerResult: null,
      uxml: null,
      validationReport: null,
      faceModel: null,
      universalGraph: null,
      rayGraph: null,
      comparison: null,
      topologyDecision: null,
      routeHandoff: null,
      cl1RoutePackage: null,
      cl1Snapshot: null,
      cl1ReplayValidation: null,
      cl1WorkbenchSummary: null,
    },
    reports: {
      source: null,
      'existing-converter': null,
      uxml: null,
      validation: null,
      'face-model': null,
      'universal-topology': null,
      'ray-topology': null,
      comparison: null,
      'decision-gate': null,
      'route-handoff': null,
      'cl1-package': null,
      'cl1-snapshot': null,
      'cl1-replay': null,
      'cl1-summary': null,
      outputs: null,
      masters: null,
    },
  };
}

function sourceTypeFromProfile(profile) {
  if (profile === XML_PROFILES.UXML) return 'UXML';
  if (profile === XML_PROFILES.INPUT_XML) return 'INPUT_XML';
  if (profile === XML_PROFILES.STANDARD_XML || profile === XML_PROFILES.BENCHMARK_XML) return 'EXISTING_XML';
  return 'AUTO';
}

function extensionFallbackSourceType(fileName, text) {
  const name = String(fileName || '').toLowerCase();
  const trimmed = String(text || '').trimStart();

  if (name.endsWith('.pcf')) return 'PCF';
  if (name.endsWith('.pdf')) return 'PDF_TO_INPUTXML';
  if (name.endsWith('.rev') || name.endsWith('.rvm')) return 'REV_TO_XML';
  if (name.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) return 'JSON_TO_XML';
  if (name.endsWith('.txt')) return 'TXT_TO_XML';
  return 'AUTO';
}

export function detectSourceType(fileName, text) {
  const safeFileName = String(fileName || '');
  const profile = detectXmlProfile(text, { fileName: safeFileName });

  if (profile.isKnownProfile) {
    return sourceTypeFromProfile(profile.profile);
  }

  if (safeFileName.toLowerCase().includes('input') && safeFileName.toLowerCase().endsWith('.xml')) {
    return 'INPUT_XML';
  }

  return extensionFallbackSourceType(safeFileName, text);
}

function stageReport(stageId, report) {
  return {
    stageId,
    pass: reportPass(report),
    schema: report?.schema || '',
    summary: report?.summary || report?.stats || {},
    report,
  };
}

function ensureXmlSource(state) {
  const selected = state.selectedSourceType === 'AUTO' ? state.detectedSourceType : state.selectedSourceType;

  if (!String(state.sourceText || '').trim()) {
    throw new Error('Load XML/InputXML/UXML source text before running the UXML pipeline.');
  }

  if (!['AUTO', 'UXML', 'INPUT_XML', 'EXISTING_XML'].includes(selected)) {
    throw new Error(`${selected} must go through the existing converter bridge before UXML normalization.`);
  }
}

function setSourceReport(state, profileReport) {
  state.reports.source = stageReport('source', {
    pass: profileReport.isKnownProfile,
    profile: profileReport.profile,
    confidence: profileReport.confidence,
    blockers: profileReport.blockers || [],
    stats: profileReport.stats || {},
    shouldBlockTopologyBuild: profileReport.shouldBlockTopologyBuild,
    rootName: profileReport.rootName || '',
  });
}

export function runPipelineAction(state, action) {
  if (!state || typeof state !== 'object') {
    throw new Error('runPipelineAction requires a state object.');
  }

  if (action === 'detect-profile') {
    const profileReport = detectXmlProfile(state.sourceText, {
      fileName: state.sourceFile?.name || '',
      selectedSourceType: state.selectedSourceType,
    });

    state.pipeline.profileReport = profileReport;
    state.detectedSourceType = profileReport.isKnownProfile
      ? sourceTypeFromProfile(profileReport.profile)
      : extensionFallbackSourceType(state.sourceFile?.name || '', state.sourceText);
    setSourceReport(state, profileReport);
    state.status = profileReport.shouldBlockTopologyBuild
      ? { kind: 'warn', message: `Profile requires review: ${profileReport.blockers.join(', ') || profileReport.profile}` }
      : { kind: 'ok', message: `Detected XML profile: ${profileReport.profile}.` };
    return profileReport;
  }

  if (action === 'convert-uxml') {
    ensureXmlSource(state);
    const profileReport = state.pipeline.profileReport || runPipelineAction(state, 'detect-profile');
    const result = normalizeXmlToUxml(state.sourceText, {
      name: state.sourceFile?.name || '',
      fileName: state.sourceFile?.name || '',
      selectedSourceType: state.selectedSourceType,
      profileReport,
    });

    state.pipeline.normalizerResult = result;
    state.pipeline.uxml = result.uxml;
    state.reports.uxml = stageReport('uxml', result);
    state.status = result.ok
      ? { kind: 'ok', message: `UXML normalization complete. Components=${count(result.stats?.componentCount)}, Anchors=${count(result.stats?.anchorCount)}.` }
      : { kind: 'error', message: 'UXML normalization blocked. Review diagnostics and loss contract.' };
    return result;
  }

  if (action === 'validate-uxml') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');
    const report = validateUxmlDocument(state.pipeline.uxml);
    state.pipeline.validationReport = report;
    state.reports.validation = stageReport('validation', report);
    state.status = report.ready
      ? { kind: 'ok', message: 'UXML validation passed.' }
      : { kind: 'warn', message: `UXML validation needs review. Blockers=${count(report.stats?.blockerCount)}.` };
    return report;
  }

  if (action === 'build-face-model') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');
    const model = buildUxmlFaceModel(state.pipeline.uxml, { allowPartial: true });
    state.pipeline.faceModel = model;
    state.reports['face-model'] = stageReport('face-model', model);
    state.status = model.ok
      ? { kind: 'ok', message: `Face model built. Faces=${count(model.summary?.faceCount)}.` }
      : { kind: 'warn', message: 'Face model built with warnings or blockers.' };
    return model;
  }

  if (action === 'build-universal-topology') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');
    if (!state.pipeline.faceModel) runPipelineAction(state, 'build-face-model');
    const graph = buildUxmlUniversalTopoGraph(state.pipeline.uxml, {
      faceModel: state.pipeline.faceModel,
      allowPartialFaceModel: true,
      allowBlockedFaceModel: true,
    });
    state.pipeline.universalGraph = graph;
    state.reports['universal-topology'] = stageReport('universal-topology', graph);
    state.status = graph.ok
      ? { kind: 'ok', message: `UniversalTopoGraph built. Edges=${count(graph.summary?.edgeCount)}.` }
      : { kind: 'warn', message: `UniversalTopoGraph built with disconnected=${count(graph.summary?.disconnectedCount)}.` };
    return graph;
  }

  if (action === 'build-ray-topology') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');
    if (!state.pipeline.faceModel) runPipelineAction(state, 'build-face-model');
    if (!state.pipeline.universalGraph) runPipelineAction(state, 'build-universal-topology');
    const graph = buildUxmlRayTopoGraph(state.pipeline.uxml, {
      faceModel: state.pipeline.faceModel,
      universalGraph: state.pipeline.universalGraph,
      allowPartialFaceModel: true,
      allowBlockedFaceModel: true,
    });
    state.pipeline.rayGraph = graph;
    state.reports['ray-topology'] = stageReport('ray-topology', graph);
    state.status = graph.ok
      ? { kind: 'ok', message: `RayTopoGraph built. Candidates=${count(graph.summary?.rayCandidateCount)}.` }
      : { kind: 'warn', message: 'RayTopoGraph built with review items.' };
    return graph;
  }

  if (action === 'compare-topology') {
    if (!state.pipeline.universalGraph) runPipelineAction(state, 'build-universal-topology');
    if (!state.pipeline.rayGraph) runPipelineAction(state, 'build-ray-topology');
    const comparison = compareUxmlTopoGraphs(state.pipeline.uxml, {
      universalGraph: state.pipeline.universalGraph,
      rayGraph: state.pipeline.rayGraph,
      allowBlockedGraphs: true,
    });
    state.pipeline.comparison = comparison;
    state.reports.comparison = stageReport('comparison', comparison);
    state.status = comparison.ok
      ? { kind: 'ok', message: `Topology comparison complete. Promotions=${count(comparison.summary?.promotionCandidateCount)}, Manual=${count(comparison.summary?.manualReviewCount)}.` }
      : { kind: 'warn', message: 'Topology comparison needs review.' };
    return comparison;
  }

  if (action === 'run-decision-gate') {
    if (!state.pipeline.comparison) runPipelineAction(state, 'compare-topology');
    const decision = decideUxmlTopologyAcceptance(state.pipeline.uxml, {
      comparison: state.pipeline.comparison,
      allowPartialExport: true,
      acceptUniversalOnly: true,
      allowSafeRayPromotions: true,
      allowFaceProximityPromotions: false,
      maxPromotionDistanceAlongRayMm: 500,
      maxPromotionPerpendicularMissMm: 12,
    });
    state.pipeline.topologyDecision = decision;
    state.reports['decision-gate'] = stageReport('decision-gate', decision);
    state.status = decision.outputBridgeReady
      ? {
          kind: decision.exportAllowed ? 'ok' : 'warn',
          message: `Decision gate complete. Accepted=${count(decision.summary?.acceptedConnectionCount)}, Manual=${count(decision.summary?.manualReviewCount)}, Unresolved=${count(decision.summary?.unresolvedCount)}.`,
        }
      : { kind: 'warn', message: 'Decision gate complete, but output bridge is not ready.' };
    return decision;
  }

  if (action === 'run-route-handoff') {
    if (!state.pipeline.topologyDecision) runPipelineAction(state, 'run-decision-gate');
    const routeHandoff = createUxmlRouteHandoffPayload({
      targetRoute: UXML_ROUTE_TARGETS.DIAGNOSTICS_ONLY,
      uxml: state.pipeline.uxml,
      topologyDecision: state.pipeline.topologyDecision,
      acceptedTopologyHandoff: null,
      diagnostics: state.pipeline.uxml?.diagnostics || [],
      lossContract: state.pipeline.uxml?.lossContract || [],
      allowPartialExport: true,
    });
    state.pipeline.routeHandoff = routeHandoff;
    state.reports['route-handoff'] = stageReport('route-handoff', routeHandoff);
    state.status = {
      kind: routeHandoff.allowed ? 'ok' : 'warn',
      message: summarizeUxmlRouteHandoff(routeHandoff.policy),
    };
    return routeHandoff;
  }

  if (action === 'run-cl1-package') {
    if (!state.pipeline.routeHandoff) runPipelineAction(state, 'run-route-handoff');
    const cl1RoutePackage = createUxmlCl1RoutePackage({
      targetRoute: UXML_ROUTE_TARGETS.EXTRACT_PCF_LEGACY,
      uxml: state.pipeline.uxml,
      topologyDecision: state.pipeline.topologyDecision,
      acceptedTopologyHandoff: state.pipeline.routeHandoff,
      diagnostics: state.pipeline.uxml?.diagnostics || [],
      lossContract: state.pipeline.uxml?.lossContract || [],
      allowPartialExport: true,
      sourceInfo: {
        sourceFile: state.sourceFile?.name || '',
        selectedSourceType: state.selectedSourceType,
        detectedSourceType: state.detectedSourceType,
        profile: state.pipeline.profileReport?.profile || '',
      },
    });
    state.pipeline.cl1RoutePackage = cl1RoutePackage;
    state.reports['cl1-package'] = stageReport('cl1-package', cl1RoutePackage);
    state.status = {
      kind: cl1RoutePackage.allowed ? 'ok' : 'warn',
      message: summarizeUxmlCl1RoutePackage(cl1RoutePackage),
    };
    return cl1RoutePackage;
  }

  if (action === 'run-cl1-snapshot') {
    if (!state.pipeline.cl1RoutePackage) runPipelineAction(state, 'run-cl1-package');
    const cl1Snapshot = buildUxmlCl1PackageSnapshot(state.pipeline.cl1RoutePackage, {
      includePayload: false,
      includeDiagnostics: true,
      includeLossContract: true,
    });
    state.pipeline.cl1Snapshot = cl1Snapshot;
    state.reports['cl1-snapshot'] = stageReport('cl1-snapshot', { ok: true, ...cl1Snapshot });
    state.status = {
      kind: 'ok',
      message: `CL1 snapshot ready: ${cl1Snapshot.snapshotId}. Debug JSON only; no PCF or masters generated.`,
    };
    return cl1Snapshot;
  }

  if (action === 'run-cl1-replay') {
    if (!state.pipeline.cl1Snapshot) runPipelineAction(state, 'run-cl1-snapshot');
    const cl1ReplayValidation = validateUxmlCl1SnapshotReplay(state.pipeline.cl1Snapshot, {
      requirePayloadForReplay: false,
    });
    state.pipeline.cl1ReplayValidation = cl1ReplayValidation;
    state.reports['cl1-replay'] = stageReport('cl1-replay', cl1ReplayValidation);
    state.status = {
      kind: cl1ReplayValidation.replayReady ? 'ok' : 'warn',
      message: summarizeUxmlCl1SnapshotReplay(cl1ReplayValidation),
    };
    return cl1ReplayValidation;
  }

  if (action === 'run-cl1-summary') {
    if (!state.pipeline.cl1ReplayValidation) runPipelineAction(state, 'run-cl1-replay');
    const cl1WorkbenchSummary = buildUxmlCl1WorkbenchSummary({
      topologyDecision: state.pipeline.topologyDecision,
      routeHandoff: state.pipeline.routeHandoff,
      cl1RoutePackage: state.pipeline.cl1RoutePackage,
      cl1Snapshot: state.pipeline.cl1Snapshot,
      cl1ReplayValidation: state.pipeline.cl1ReplayValidation,
    });
    state.pipeline.cl1WorkbenchSummary = cl1WorkbenchSummary;
    state.reports['cl1-summary'] = stageReport('cl1-summary', { ok: cl1WorkbenchSummary.readyForRouteConsumption, ...cl1WorkbenchSummary });
    state.status = {
      kind: cl1WorkbenchSummary.overallStatus === 'PASS' ? 'ok' : cl1WorkbenchSummary.overallStatus === 'WARN' ? 'warn' : 'error',
      message: summarizeUxmlCl1WorkbenchSummary(cl1WorkbenchSummary),
    };
    return cl1WorkbenchSummary;
  }

  if (action === 'run-full-pipeline') {
    for (const step of FULL_PIPELINE_ACTIONS) runPipelineAction(state, step);
    return state.pipeline.cl1WorkbenchSummary || state.pipeline.routeHandoff;
  }

  throw new Error(`Unknown UXML action: ${action}`);
}

function canRunXmlActions(state) {
  const selected = state.selectedSourceType === 'AUTO' ? state.detectedSourceType : state.selectedSourceType;
  return Boolean(String(state.sourceText || '').trim()) && ['AUTO', 'UXML', 'INPUT_XML', 'EXISTING_XML'].includes(selected);
}

function renderStageCard(stage, state) {
  const report = state.reports?.[stage.id] || null;
  const isActive = state.activePanel === stage.id;
  const pass = reportPass(report);
  const deferred = stage.deferred === true;
  return `<button class="uxml-stage-card ${isActive ? 'is-active' : ''} ${deferred ? 'is-deferred' : ''}" data-uxml-panel="${esc(stage.id)}" type="button"><div class="uxml-stage-title">${esc(stage.title)}</div><div class="uxml-stage-description">${esc(stage.description)}</div><div class="uxml-stage-meta">${deferred ? '<span class="uxml-pill muted">Deferred</span>' : report ? `<span class="uxml-pill ${pass ? 'ok' : 'warn'}">${pass ? 'Ready' : 'Review'}</span>` : '<span class="uxml-pill muted">Not run</span>'}</div></button>`;
}

function sourceSummaryHtml(state) {
  const file = state.sourceFile;
  if (!file) return '<div class="uxml-empty">No source loaded.</div>';
  return `<div class="uxml-kv-grid"><div>File</div><div>${esc(file.name)}</div><div>Size</div><div>${esc(`${count(file.size)} B`)}</div><div>Selected source type</div><div>${esc(state.selectedSourceType)}</div><div>Detected source type</div><div>${esc(state.detectedSourceType)}</div><div>Characters loaded</div><div>${esc(state.sourceText.length)}</div></div>`;
}

function reportSummaryHtml(report, title) {
  if (!report) return '<div class="uxml-empty">Not run yet.</div>';
  const summary = summarizeReport(report);
  const rows = summary.rows.map(([key, value]) => `<div>${esc(key)}</div><div>${esc(value)}</div>`).join('');
  return `<div class="uxml-report-card"><div class="uxml-report-title">${esc(title)} <span class="uxml-pill ${summary.pass ? 'ok' : 'warn'}">${esc(summary.label)}</span></div><div class="uxml-kv-grid uxml-kv-compact">${rows}</div></div>`;
}

function renderRouteAndCl1Guide() {
  return `<div class="uxml-placeholder"><b>Route Handoff</b><br>Topology decisions are routed through the handoff policy before any downstream package is created.</div><div class="uxml-placeholder"><b>CL1 Route Package</b><br>This route package is deterministic metadata only. It does not emit PCF, does not resolve masters, and does not mutate topology.</div><div class="uxml-placeholder"><b>Masters by Target Route</b><br>Masters are handled by the downstream route. This tab only prepares topology and CL1 route evidence.</div><div class="uxml-placeholder"><b>Route contract</b><br>UXML mutates coordinates: NO<br>UXML applies fixes: NO<br>UXML emits PCF directly: NO</div>`;
}

function panelHtml(state) {
  const panel = state.activePanel;
  const pipeline = state.pipeline;

  if (panel === 'source') {
    return `<section class="uxml-panel-section"><h3>Source Intake</h3><p>Load XML, InputXML, or UXML directly. For JSON/RVM -> PCF, use the RVM / JSON -> PCF Extract tab and select UXML topology mode.</p>${renderRouteAndCl1Guide()}${sourceSummaryHtml(state)}${reportSummaryHtml(pipeline.profileReport, 'Profile Detection')}<div class="uxml-preview-block"><div class="uxml-preview-title">Source Preview</div><pre>${esc((state.sourceText || '').slice(0, 12000))}</pre></div></section>`;
  }

  if (panel === 'existing-converter') {
    return `<section class="uxml-panel-section"><h3>Existing Converter Output</h3><div class="uxml-placeholder">This tab is a standalone XML/InputXML/UXML topology workbench. It does not own the JSON/RVM -> PCF production export workflow.</div><div class="uxml-placeholder" style="margin-top:12px;"><b>Standalone XML path</b><pre style="white-space:pre-wrap;margin:8px 0 0;">XML / InputXML / UXML\n  -> UXML normalization\n  -> Validation\n  -> Face model\n  -> UniversalTopoGraph\n  -> RayTopoGraph\n  -> Comparator\n  -> Decision gate\n  -> Route handoff\n  -> CL1 package\n  -> CL1 snapshot\n  -> CL1 replay\n  -> CL1 summary</pre></div></section>`;
  }

  if (panel === 'uxml') {
    return `<section class="uxml-panel-section"><h3>UXML Normalization</h3>${reportSummaryHtml(pipeline.uxml, 'UXML Result')}<div class="uxml-preview-block"><div class="uxml-preview-title">Normalized UXML</div><pre>${esc(JSON.stringify(pipeline.uxml?.uxml || null, null, 2).slice(0, 24000))}</pre></div></section>`;
  }

  if (panel === 'validation') return `<section class="uxml-panel-section"><h3>UXML Validation</h3>${reportSummaryHtml(pipeline.validationReport, 'Validation')}</section>`;
  if (panel === 'face-model') return `<section class="uxml-panel-section"><h3>Face Model</h3>${reportSummaryHtml(pipeline.faceModel, 'Face Model')}</section>`;
  if (panel === 'universal-topology') return `<section class="uxml-panel-section"><h3>UniversalTopoGraph</h3>${reportSummaryHtml(pipeline.universalGraph, 'UniversalTopoGraph')}</section>`;
  if (panel === 'ray-topology') return `<section class="uxml-panel-section"><h3>RayTopoGraph</h3>${reportSummaryHtml(pipeline.rayGraph, 'RayTopoGraph')}</section>`;
  if (panel === 'comparison') return `<section class="uxml-panel-section"><h3>Topology Comparison</h3>${reportSummaryHtml(pipeline.comparison, 'Comparison')}</section>`;
  if (panel === 'decision-gate') return `<section class="uxml-panel-section"><h3>Decision Gate</h3>${reportSummaryHtml(pipeline.topologyDecision, 'Decision Gate')}</section>`;

  if (panel === 'route-handoff') {
    return `<section class="uxml-panel-section"><h3>Route Handoff</h3><p>This stage only prepares route-handoff decisions.</p>${pipeline.routeHandoff ? `<div class="uxml-placeholder"><b>Route handoff</b><br>${esc(summarizeUxmlRouteHandoff(pipeline.routeHandoff.policy))}</div>` : '<div class="uxml-placeholder">Run decision gate, then route handoff.</div>'}<div class="uxml-placeholder" style="margin-top:12px;"><b>Route contract</b><br>UXML mutates coordinates: NO<br>UXML applies fixes: NO<br>UXML emits PCF directly: NO<br>Masters resolved here: NO</div></section>`;
  }

  if (panel === 'cl1-package') {
    return `<section class="uxml-panel-section"><h3>CL1 Route Package</h3><p>This route package is deterministic metadata only. It does not emit PCF, does not resolve masters, and does not mutate topology.</p>${pipeline.cl1RoutePackage ? `<div class="uxml-kv-grid"><div><b>Schema</b></div><div>${esc(pipeline.cl1RoutePackage.schema)}</div><div><b>Package ID</b></div><div>${esc(pipeline.cl1RoutePackage.packageId)}</div><div><b>Target route</b></div><div>${esc(pipeline.cl1RoutePackage.targetRoute)}</div><div><b>Allowed</b></div><div>${pipeline.cl1RoutePackage.allowed ? 'YES' : 'NO'}</div><div><b>Components</b></div><div>${count(pipeline.cl1RoutePackage.entityCounts?.componentCount)}</div><div><b>Accepted topology</b></div><div>${count(pipeline.cl1RoutePackage.topologyCounts?.acceptedConnectionCount)}</div></div><div class="uxml-placeholder" style="margin-top:12px;"><b>Route contract</b><br>Does not emit PCF: ${pipeline.cl1RoutePackage.routeContract?.uxmlEmitsPcfDirectly ? 'YES' : 'NO'}<br>Does not resolve masters: YES<br>Does not mutate coordinates: ${pipeline.cl1RoutePackage.routeContract?.uxmlMutatesCoordinates ? 'NO' : 'YES'}</div>` : '<div class="uxml-placeholder">Run route handoff, then build CL1 package.</div>'}</section>`;
  }

  if (panel === 'cl1-snapshot') {
    return `<section class="uxml-panel-section"><h3>CL1 Snapshot JSON</h3><p>Creates a deterministic debug/replay JSON snapshot from the CL1 route package. This is not PCF export and does not resolve masters.</p>${pipeline.cl1Snapshot ? `<div class="uxml-kv-grid"><div><b>Schema</b></div><div>${esc(pipeline.cl1Snapshot.schema)}</div><div><b>Snapshot ID</b></div><div>${esc(pipeline.cl1Snapshot.snapshotId)}</div><div><b>Package ID</b></div><div>${esc(pipeline.cl1Snapshot.packageId)}</div><div><b>Target route</b></div><div>${esc(pipeline.cl1Snapshot.targetRoute)}</div><div><b>Debug only</b></div><div>${pipeline.cl1Snapshot.debugOnly ? 'YES' : 'NO'}</div><div><b>Payload included</b></div><div>${pipeline.cl1Snapshot.payloadIncluded ? 'YES' : 'NO'}</div><div><b>Components</b></div><div>${count(pipeline.cl1Snapshot.entityCounts?.componentCount)}</div><div><b>Accepted topology</b></div><div>${count(pipeline.cl1Snapshot.topologyCounts?.acceptedConnectionCount)}</div></div><div class="uxml-placeholder" style="margin-top:12px;"><b>Snapshot contract</b><br>PCF generated: ${pipeline.cl1Snapshot.pcfGenerated ? 'YES' : 'NO'}<br>Masters resolved: ${pipeline.cl1Snapshot.mastersResolved ? 'YES' : 'NO'}<br>Coordinates mutated: ${pipeline.cl1Snapshot.coordinatesMutated ? 'YES' : 'NO'}<br>Fixes applied: ${pipeline.cl1Snapshot.fixesApplied ? 'YES' : 'NO'}</div><div class="uxml-preview-block" style="margin-top:12px;"><div class="uxml-preview-title">Snapshot preview</div><pre>${esc(serializeUxmlCl1PackageSnapshot(pipeline.cl1Snapshot))}</pre></div>` : '<div class="uxml-placeholder">Run route handoff, then build CL1 snapshot.</div>'}</section>`;
  }

  if (panel === 'cl1-replay') {
    return `<section class="uxml-panel-section"><h3>CL1 Replay Validator</h3><p>Validates a CL1 snapshot for debug/replay readiness. This does not parse XML, rebuild topology, emit PCF, resolve masters, mutate coordinates, or apply fixes.</p>${pipeline.cl1ReplayValidation ? `<div class="uxml-kv-grid"><div><b>Schema</b></div><div>${esc(pipeline.cl1ReplayValidation.schema)}</div><div><b>Replay ready</b></div><div>${pipeline.cl1ReplayValidation.replayReady ? 'YES' : 'NO'}</div><div><b>Blocking issues</b></div><div>${count(pipeline.cl1ReplayValidation.summary?.blockingIssueCount)}</div><div><b>Warnings</b></div><div>${count(pipeline.cl1ReplayValidation.summary?.warningCount)}</div><div><b>Components</b></div><div>${count(pipeline.cl1ReplayValidation.countSummary?.componentCount)}</div><div><b>Accepted topology</b></div><div>${count(pipeline.cl1ReplayValidation.countSummary?.acceptedConnectionCount)}</div><div><b>Manual / rejected / unresolved</b></div><div>${count(pipeline.cl1ReplayValidation.countSummary?.manualReviewCount)} / ${count(pipeline.cl1ReplayValidation.countSummary?.rejectedCount)} / ${count(pipeline.cl1ReplayValidation.countSummary?.unresolvedCount)}</div></div><div class="uxml-placeholder" style="margin-top:12px;"><b>Replay safety flags</b><br>Debug only: ${pipeline.cl1ReplayValidation.debugOnly ? 'YES' : 'NO'}<br>PCF generated: ${pipeline.cl1ReplayValidation.pcfGenerated ? 'YES' : 'NO'}<br>Masters resolved: ${pipeline.cl1ReplayValidation.mastersResolved ? 'YES' : 'NO'}<br>Coordinates mutated: ${pipeline.cl1ReplayValidation.coordinatesMutated ? 'YES' : 'NO'}<br>Fixes applied: ${pipeline.cl1ReplayValidation.fixesApplied ? 'YES' : 'NO'}</div>${pipeline.cl1ReplayValidation.issues?.length ? `<div class="uxml-placeholder" style="margin-top:12px;"><b>Issues</b><ul>${pipeline.cl1ReplayValidation.issues.map((issue) => `<li><code>${esc(issue.code)}</code> - ${esc(issue.message)}</li>`).join('')}</ul></div>` : ''}` : '<div class="uxml-placeholder">Build CL1 snapshot, then validate replay readiness.</div>'}</section>`;
  }

  if (panel === 'cl1-summary') {
    return `<section class="uxml-panel-section"><h3>CL1 QA Summary</h3><p>One-screen status for Decision Gate, Route Handoff, CL1 Route Package, Snapshot, and Replay Validation. This is read-only QA status.</p>${pipeline.cl1WorkbenchSummary ? `<div class="uxml-kv-grid"><div><b>Overall status</b></div><div>${esc(pipeline.cl1WorkbenchSummary.overallStatus)}</div><div><b>Ready for route consumption</b></div><div>${pipeline.cl1WorkbenchSummary.readyForRouteConsumption ? 'YES' : 'NO'}</div><div><b>Blocked / warning / not-run</b></div><div>${count(pipeline.cl1WorkbenchSummary.blockedCount)} / ${count(pipeline.cl1WorkbenchSummary.warningCount)} / ${count(pipeline.cl1WorkbenchSummary.notRunCount)}</div><div><b>Components</b></div><div>${count(pipeline.cl1WorkbenchSummary.counts?.componentCount)}</div><div><b>Accepted topology</b></div><div>${count(pipeline.cl1WorkbenchSummary.counts?.acceptedConnectionCount)}</div></div><div class="uxml-placeholder" style="margin-top:12px;"><b>Safety summary</b><br>PCF generated: ${pipeline.cl1WorkbenchSummary.safety?.pcfGenerated ? 'YES' : 'NO'}<br>Masters resolved: ${pipeline.cl1WorkbenchSummary.safety?.mastersResolved ? 'YES' : 'NO'}<br>Coordinates mutated: ${pipeline.cl1WorkbenchSummary.safety?.coordinatesMutated ? 'YES' : 'NO'}<br>Fixes applied: ${pipeline.cl1WorkbenchSummary.safety?.fixesApplied ? 'YES' : 'NO'}</div>` : '<div class="uxml-placeholder">Run CL1 replay validator, then build CL1 QA summary.</div>'}</section>`;
  }

  if (panel === 'masters') {
    return `<section class="uxml-panel-section"><h3>Masters by Target Route</h3><div class="uxml-placeholder">Masters are owned by the downstream route. This tab only prepares topology and CL1 route evidence.</div></section>`;
  }

  if (panel === 'outputs') {
    return `<section class="uxml-panel-section"><h3>Route Targets</h3><div class="uxml-placeholder">Target routes include Extract PCF, GLB, 2D, InputXML, and CII.</div></section>`;
  }

  return `<section class="uxml-panel-section"><h3>Unknown panel</h3><div class="uxml-placeholder">${esc(panel)}</div></section>`;
}

function render(container, state) {
  const xmlReady = canRunXmlActions(state);
  const selected = state.selectedSourceType === 'AUTO' ? state.detectedSourceType : state.selectedSourceType;
  const canConvert = xmlReady && ['AUTO', 'UXML', 'INPUT_XML', 'EXISTING_XML'].includes(selected);

  container.innerHTML = `<div class="uxml-tab"><header class="uxml-header"><div><h2>Universal XML Converter</h2><p>XML/InputXML/UXML topology workbench: source -> UXML -> validation -> face model -> UniversalTopoGraph + RayTopoGraph comparison -> route handoff -> CL1 package -> CL1 snapshot -> CL1 replay -> CL1 summary.</p></div><div class="uxml-header-badges"><span class="uxml-badge">Agent 09</span><span class="uxml-badge">Integrated Pipeline</span><span class="uxml-badge muted">Masters by target route</span></div></header><section class="uxml-toolbar"><label class="uxml-field"><span>Source type</span><select data-uxml-source-type>${SOURCE_TYPES.map((option) => `<option value="${esc(option.value)}" ${state.selectedSourceType === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label><label class="uxml-file-btn">Load Source<input data-uxml-file-input type="file" /></label><button data-uxml-action="run-existing-converter" type="button" disabled>Run existing converter</button><button data-uxml-action="detect-profile" type="button">Detect Profile</button><button data-uxml-action="convert-uxml" type="button" ${canConvert ? '' : 'disabled'}>Convert to UXML</button><button data-uxml-action="validate-uxml" type="button" ${state.pipeline.uxml ? '' : 'disabled'}>Validate UXML</button><button data-uxml-action="build-face-model" type="button" ${state.pipeline.uxml ? '' : 'disabled'}>Build Face Model</button><button data-uxml-action="build-universal-topology" type="button" ${state.pipeline.faceModel ? '' : 'disabled'}>Build UniversalTopoGraph</button><button data-uxml-action="build-ray-topology" type="button" ${state.pipeline.faceModel ? '' : 'disabled'}>Build RayTopoGraph</button><button data-uxml-action="compare-topology" type="button" ${state.pipeline.universalGraph && state.pipeline.rayGraph ? '' : 'disabled'}>Compare</button><button data-uxml-action="run-decision-gate" type="button" ${state.pipeline.comparison ? '' : 'disabled'}>Run decision gate</button><button data-uxml-action="run-route-handoff" type="button" ${state.pipeline.topologyDecision ? '' : 'disabled'}>Run route handoff</button><button data-uxml-action="run-cl1-package" type="button" ${state.pipeline.routeHandoff ? '' : 'disabled'}>Build CL1 package</button><button data-uxml-action="run-cl1-snapshot" type="button" ${state.pipeline.cl1RoutePackage ? '' : 'disabled'}>Build CL1 snapshot</button><button data-uxml-action="run-cl1-replay" type="button" ${state.pipeline.cl1Snapshot ? '' : 'disabled'}>Validate CL1 replay</button><button data-uxml-action="run-cl1-summary" type="button" ${state.pipeline.cl1ReplayValidation ? '' : 'disabled'}>Build CL1 QA summary</button><button data-uxml-action="run-full-pipeline" type="button" ${canConvert ? '' : 'disabled'}>Run Full Pipeline</button><button data-uxml-action="export-summary" type="button">Export Summary JSON</button></section><div class="uxml-status ${statusClass(state.status.kind)}">${esc(state.status.message)}</div><main class="uxml-layout"><aside class="uxml-stages">${PIPELINE_STAGES.map((stage) => renderStageCard(stage, state)).join('')}</aside><section class="uxml-panel">${panelHtml(state)}</section></main></div>`;
}

function buildSummary(state) {
  return {
    schema: 'pcf-glb-viewer/universal-xml-converter-tab-summary/v2',
    phase: 'Agent09',
    generatedAt: new Date().toISOString(),
    source: state.sourceFile
      ? {
          name: state.sourceFile.name,
          size: state.sourceFile.size,
          selectedSourceType: state.selectedSourceType,
          detectedSourceType: state.detectedSourceType,
          charactersLoaded: state.sourceText.length,
        }
      : null,
    reports: Object.fromEntries(
      Object.entries(state.reports).map(([key, value]) => [
        key,
        value ? { pass: reportPass(value), summary: value.summary || value.stats || null } : null,
      ])
    ),
    comparator: state.pipeline.comparison ? state.pipeline.comparison.summary || state.pipeline.comparison : null,
    deferred: {
      existingConverterBridge: true,
      outputBridges: true,
      masters: true,
    },
  };
}

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportSummary(state) {
  downloadText(
    'universal_xml_converter_agent09_summary.json',
    JSON.stringify(buildSummary(state), null, 2),
    'application/json'
  );
}

function bindEvents(container, state) {
  const onChange = async (event) => {
    const sourceSelect = event.target.closest('[data-uxml-source-type]');
    if (sourceSelect) {
      state.selectedSourceType = sourceSelect.value || 'AUTO';
      state.status = { kind: 'info', message: `Source type set to ${state.selectedSourceType}.` };
      render(container, state);
      return;
    }

    const fileInput = event.target.closest('[data-uxml-file-input]');
    if (!fileInput) return;

    const file = fileInput.files?.[0] || null;
    if (!file) {
      state.status = { kind: 'warn', message: 'No file selected.' };
      render(container, state);
      return;
    }

    try {
      const text = await file.text();
      state.sourceFile = {
        name: file.name,
        size: file.size,
        type: file.type || '',
        lastModified: file.lastModified || null,
      };
      state.sourceText = text;
      state.detectedSourceType = detectSourceType(file.name, text);
      state.reports.source = {
        pass: true,
        fileName: file.name,
        size: file.size,
        detectedSourceType: state.detectedSourceType,
      };
      state.status = {
        kind: 'ok',
        message: `Loaded ${file.name}. Detected source type: ${state.detectedSourceType}.`,
      };
    } catch (error) {
      state.status = { kind: 'error', message: `Failed to read source file: ${error.message}` };
    }

    render(container, state);
  };

  const onClick = (event) => {
    const panelButton = event.target.closest('[data-uxml-panel]');
    if (panelButton) {
      state.activePanel = panelButton.dataset.uxmlPanel || 'source';
      render(container, state);
      return;
    }

    const actionButton = event.target.closest('[data-uxml-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.uxmlAction;

    if (action === 'run-existing-converter') {
      state.status = { kind: 'warn', message: 'Use the existing converter bridge before UXML normalization.' };
      render(container, state);
      return;
    }

    if (action === 'detect-profile' && !String(state.sourceText || '').trim()) {
      state.status = { kind: 'warn', message: 'Load a source file before detecting profile.' };
      render(container, state);
      return;
    }

    try {
      if (action === 'export-summary') {
        exportSummary(state);
        state.status = { kind: 'ok', message: 'Universal XML Converter summary exported.' };
      } else {
        runPipelineAction(state, action);
      }
    } catch (error) {
      state.status = { kind: 'error', message: error.message };
    }

    render(container, state);
  };

  container.addEventListener('change', onChange);
  container.addEventListener('click', onClick);

  return () => {
    container.removeEventListener('change', onChange);
    container.removeEventListener('click', onClick);
  };
}

export function renderUniversalXmlConverterTab(container) {
  if (!container) {
    throw new Error('renderUniversalXmlConverterTab requires a container element.');
  }

  const state = createInitialState();
  render(container, state);
  return bindEvents(container, state);
}

export function runUniversalXmlPipelineFromText(text, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const sourceName = opts.sourceName || 'inline.xml';
  const state = createInitialState();

  state.sourceFile = {
    name: sourceName,
    size: String(text ?? '').length,
    type: 'text/xml',
    lastModified: null,
  };
  state.sourceText = String(text ?? '');
  state.selectedSourceType = opts.selectedSourceType || 'AUTO';
  state.detectedSourceType = detectSourceType(sourceName, state.sourceText);
  state.reports.source = { pass: true, fileName: sourceName, detectedSourceType: state.detectedSourceType };

  for (const action of FULL_PIPELINE_ACTIONS) {
    runPipelineAction(state, action);
  }

  return state;
}

export const _test = Object.freeze({
  createInitialState,
  summarizeReport,
  buildSummary,
  canRunXmlActions,
  PIPELINE_STAGES,
});
