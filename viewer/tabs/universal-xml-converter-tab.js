/**
 * universal-xml-converter-tab.js
 *
 * Agent 09: Universal XML Converter tab integration.
 *
 * Scope:
 * - Wire the completed UXML modules into the existing standalone tab.
 * - Provide source loading, profile detection, UXML normalization, validation,
 *   face model, UniversalTopoGraph, RayTopoGraph, and comparison actions.
 * - Keep output bridges and masters as placeholders only.
 * - Do not mutate existing PCF/RVM extraction state.
 */

import { XML_PROFILES } from '../uxml/UxmlConstants.js';
import { detectXmlProfile } from '../uxml/UxmlProfileDetector.js';
import { normalizeXmlToUxml } from '../uxml/UxmlNormalizer.js';
import { validateUxmlDocument } from '../uxml/UxmlValidationGate.js';
import { buildUxmlFaceModel } from '../uxml/UxmlFaceModelBuilder.js';
import { buildUxmlUniversalTopoGraph } from '../uxml/UxmlUniversalTopoGraphBuilder.js';
import { buildUxmlRayTopoGraph } from '../uxml/UxmlRayTopoGraphBuilder.js';
import { compareUxmlTopoGraphs } from '../uxml/UxmlTopoGraphComparator.js';

const SOURCE_TYPES = [
  { value: 'AUTO', label: 'Auto detect' },
  { value: 'EXISTING_XML', label: 'Existing XML / Standard XML' },
  { value: 'INPUT_XML', label: 'InputXML' },
  { value: 'UXML', label: 'UXML' },
  { value: 'PCF', label: 'PCF' },
  { value: 'PDF_TO_INPUTXML', label: 'PDF → InputXML' },
  { value: 'REV_TO_XML', label: 'REV → XML' },
  { value: 'JSON_TO_XML', label: 'JSON / staged JSON → XML/InputXML' },
  { value: 'TXT_TO_XML', label: 'Attribute TXT → XML' },
];

const PIPELINE_STAGES = [
  {
    id: 'source',
    title: '1. Source Intake',
    description: 'Load PDF / REV / JSON / TXT / PCF / XML source.',
  },
  {
    id: 'existing-converter',
    title: '2. Existing Converter Output',
    description: 'Use existing converter routes to produce InputXML or Standard XML.',
  },
  {
    id: 'uxml',
    title: '3. UXML Normalization',
    description: 'Normalize InputXML / Standard XML / UXML into the Universal XML contract.',
  },
  {
    id: 'validation',
    title: '4. UXML Validation',
    description: 'Validate UXML structure, anchors, bore, branches, supports and loss contract.',
  },
  {
    id: 'face-model',
    title: '5. Pre-Topology Face Model',
    description: 'Emit component/fitting faces for RayTopoBuilder before final topology.',
  },
  {
    id: 'universal-topology',
    title: '6. UniversalTopoGraph',
    description: 'Build source-faithful topology graph from UXML faces.',
  },
  {
    id: 'ray-topology',
    title: '7. RayTopoGraph',
    description: 'Run legacy-inspired Ray topology as independent benchmark/oracle.',
  },
  {
    id: 'comparison',
    title: '8. Topology Comparison',
    description: 'Compare UniversalTopoGraph and RayTopoGraph evidence.',
  },
  {
    id: 'outputs',
    title: '9. Output Bridges',
    description: 'Prepare PCF / GLB / 2D / InputXML / CII outputs from accepted topology.',
    deferred: true,
  },
  {
    id: 'masters',
    title: '10. Final Master Links',
    description: 'Line list / piping class / weight master enrichment. Deferred until final phase.',
    deferred: true,
  },
];

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function bytesText(size) {
  const n = Number(size || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function statusClass(kind) {
  if (kind === 'error') return 'uxml-status-error';
  if (kind === 'warn') return 'uxml-status-warn';
  if (kind === 'ok') return 'uxml-status-ok';
  return 'uxml-status-info';
}

function reportPass(report) {
  if (!report) return false;
  if (typeof report.pass === 'boolean') return report.pass;
  if (typeof report.ok === 'boolean') return report.ok;
  if (typeof report.ready === 'boolean') return report.ready;
  return true;
}

function safeCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function summarizeReport(report) {
  if (!report) return { pass: false, label: 'Not run', rows: [] };

  const rows = [];
  const stats = report.stats || report.summary || {};

  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === 'object') continue;
    rows.push([key, value]);
  }

  if (report.profile) rows.unshift(['profile', report.profile]);
  if (report.confidence) rows.unshift(['confidence', report.confidence]);
  if (report.schema) rows.unshift(['schema', report.schema]);

  return {
    pass: reportPass(report),
    label: reportPass(report) ? 'Ready' : 'Review',
    rows,
  };
}

function createInitialState() {
  return {
    sourceFile: null,
    sourceText: '',
    selectedSourceType: 'AUTO',
    detectedSourceType: 'AUTO',
    activePanel: 'source',
    status: {
      kind: 'info',
      message: 'Universal XML Converter tab is ready.',
    },
    pipeline: {
      profileReport: null,
      normalizerResult: null,
      uxml: null,
      validationReport: null,
      faceModel: null,
      universalGraph: null,
      rayGraph: null,
      comparison: null,
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
      outputs: null,
      masters: null,
    },
  };
}

function sourceTypeFromProfile(profile) {
  if (profile === XML_PROFILES.UXML) return 'UXML';
  if (profile === XML_PROFILES.INPUT_XML) return 'INPUT_XML';
  if (profile === XML_PROFILES.STANDARD_XML) return 'EXISTING_XML';
  if (profile === XML_PROFILES.BENCHMARK_XML) return 'EXISTING_XML';
  return 'AUTO';
}

function extensionFallbackSourceType(fileName = '', text = '') {
  const name = String(fileName || '').toLowerCase();
  const trimmed = String(text || '').trimStart();

  if (name.endsWith('.pcf')) return 'PCF';
  if (name.endsWith('.pdf')) return 'PDF_TO_INPUTXML';
  if (name.endsWith('.rev') || name.endsWith('.rvm')) return 'REV_TO_XML';
  if (name.endsWith('.json')) return 'JSON_TO_XML';
  if (name.endsWith('.txt')) return 'TXT_TO_XML';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'JSON_TO_XML';

  return 'AUTO';
}

export function detectSourceType(fileName = '', text = '') {
  const profile = detectXmlProfile(text);

  if (profile.isKnownProfile) {
    return sourceTypeFromProfile(profile.profile);
  }

  return extensionFallbackSourceType(fileName, text);
}

function stageReport(stageId, report) {
  return {
    pass: reportPass(report),
    schema: report?.schema || '',
    summary: report?.summary || report?.stats || {},
    report,
    stageId,
  };
}

function ensureXmlSource(state) {
  const selected = state.selectedSourceType === 'AUTO'
    ? state.detectedSourceType
    : state.selectedSourceType;

  const allowed = ['AUTO', 'UXML', 'INPUT_XML', 'EXISTING_XML'];

  if (!state.sourceText.trim()) {
    throw new Error('Load XML/InputXML/UXML source text before running the UXML pipeline.');
  }

  if (!allowed.includes(selected)) {
    throw new Error(`${selected} must go through the existing converter bridge before UXML normalization.`);
  }
}

export function runUniversalXmlPipelineFromText(text, options = {}) {
  const sourceName = options.sourceName || 'inline.xml';
  const state = createInitialState();

  state.sourceFile = {
    name: sourceName,
    size: String(text ?? '').length,
    type: 'text/xml',
    lastModified: null,
  };

  state.sourceText = String(text ?? '');
  state.selectedSourceType = options.selectedSourceType || 'AUTO';
  state.detectedSourceType = detectSourceType(sourceName, state.sourceText);
  state.reports.source = {
    pass: true,
    fileName: sourceName,
    detectedSourceType: state.detectedSourceType,
  };

  runPipelineAction(state, 'detect-profile');
  runPipelineAction(state, 'convert-uxml');
  runPipelineAction(state, 'validate-uxml');
  runPipelineAction(state, 'build-face-model');
  runPipelineAction(state, 'build-universal-topology');
  runPipelineAction(state, 'build-ray-topology');
  runPipelineAction(state, 'compare-topology');

  return state;
}

export function runPipelineAction(state, action) {
  if (action === 'detect-profile') {
    const profileReport = detectXmlProfile(state.sourceText);

    state.pipeline.profileReport = profileReport;
    state.detectedSourceType = profileReport.isKnownProfile
      ? sourceTypeFromProfile(profileReport.profile)
      : extensionFallbackSourceType(state.sourceFile?.name, state.sourceText);

    state.reports.source = {
      pass: profileReport.isXml && profileReport.isKnownProfile,
      profile: profileReport.profile,
      confidence: profileReport.confidence,
      summary: profileReport.stats,
      report: profileReport,
    };

    state.status = profileReport.shouldBlockTopologyBuild
      ? {
          kind: 'warn',
          message: `Profile requires review: ${profileReport.blockers.join(', ') || profileReport.profile}`,
        }
      : {
          kind: 'ok',
          message: `Detected XML profile: ${profileReport.profile}.`,
        };

    return profileReport;
  }

  if (action === 'convert-uxml') {
    ensureXmlSource(state);

    const profileReport = state.pipeline.profileReport || runPipelineAction(state, 'detect-profile');

    const result = normalizeXmlToUxml(state.sourceText, {
      name: state.sourceFile?.name || '',
      profileReport,
    });

    state.pipeline.normalizerResult = result;
    state.pipeline.uxml = result.uxml;
    state.reports.uxml = stageReport('uxml', result);

    state.status = result.ok
      ? {
          kind: 'ok',
          message: `UXML normalization complete. Components=${safeCount(result.stats?.componentCount)}, Anchors=${safeCount(result.stats?.anchorCount)}.`,
        }
      : {
          kind: 'error',
          message: 'UXML normalization blocked. Review diagnostics/loss contract.',
        };

    return result;
  }

  if (action === 'validate-uxml') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');

    const report = validateUxmlDocument(state.pipeline.uxml);

    state.pipeline.validationReport = report;
    state.reports.validation = stageReport('validation', report);

    state.status = report.ready
      ? {
          kind: 'ok',
          message: 'UXML validation passed.',
        }
      : {
          kind: 'warn',
          message: `UXML validation needs review. Blockers=${safeCount(report.stats?.blockerCount)}.`,
        };

    return report;
  }

  if (action === 'build-face-model') {
    if (!state.pipeline.uxml) runPipelineAction(state, 'convert-uxml');

    const model = buildUxmlFaceModel(state.pipeline.uxml, {
      allowPartial: true,
    });

    state.pipeline.faceModel = model;
    state.reports['face-model'] = stageReport('face-model', model);

    state.status = model.ok
      ? {
          kind: 'ok',
          message: `Face model built. Faces=${safeCount(model.summary?.faceCount)}.`,
        }
      : {
          kind: 'warn',
          message: 'Face model built with warnings/blockers.',
        };

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
      ? {
          kind: 'ok',
          message: `UniversalTopoGraph built. Edges=${safeCount(graph.summary?.edgeCount)}.`,
        }
      : {
          kind: 'warn',
          message: `UniversalTopoGraph built with disconnected=${safeCount(graph.summary?.disconnectedCount)}.`,
        };

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
      ? {
          kind: 'ok',
          message: `RayTopoGraph built. Candidates=${safeCount(graph.summary?.rayCandidateCount)}.`,
        }
      : {
          kind: 'warn',
          message: 'RayTopoGraph built with review items.',
        };

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
      ? {
          kind: 'ok',
          message: `Topology comparison complete. Promotions=${safeCount(comparison.summary?.promotionCandidateCount)}, Manual=${safeCount(comparison.summary?.manualReviewCount)}.`,
        }
      : {
          kind: 'warn',
          message: 'Topology comparison needs review.',
        };

    return comparison;
  }

  if (action === 'run-full-pipeline') {
    runPipelineAction(state, 'detect-profile');
    runPipelineAction(state, 'convert-uxml');
    runPipelineAction(state, 'validate-uxml');
    runPipelineAction(state, 'build-face-model');
    runPipelineAction(state, 'build-universal-topology');
    runPipelineAction(state, 'build-ray-topology');
    return runPipelineAction(state, 'compare-topology');
  }

  throw new Error(`Unknown UXML action: ${action}`);
}

function renderStageCard(stage, state) {
  const isActive = state.activePanel === stage.id;
  const report = state.reports?.[stage.id] || null;
  const deferred = stage.deferred === true;
  const pass = reportPass(report);

  return `
    <button class="uxml-stage-card ${isActive ? 'is-active' : ''} ${deferred ? 'is-deferred' : ''}" data-uxml-panel="${esc(stage.id)}" type="button">
      <div class="uxml-stage-title">${esc(stage.title)}</div>
      <div class="uxml-stage-description">${esc(stage.description)}</div>
      <div class="uxml-stage-meta">
        ${
          deferred
            ? '<span class="uxml-pill muted">Deferred</span>'
            : report
              ? `<span class="uxml-pill ${pass ? 'ok' : 'warn'}">${pass ? 'Ready' : 'Review'}</span>`
              : '<span class="uxml-pill muted">Not run</span>'
        }
      </div>
    </button>
  `;
}

function sourceSummaryHtml(state) {
  const file = state.sourceFile;

  if (!file) return '<div class="uxml-empty">No source loaded.</div>';

  return `
    <div class="uxml-kv-grid">
      <div>File</div><div>${esc(file.name)}</div>
      <div>Size</div><div>${esc(bytesText(file.size))}</div>
      <div>Selected source type</div><div>${esc(state.selectedSourceType)}</div>
      <div>Detected source type</div><div>${esc(state.detectedSourceType)}</div>
      <div>Characters loaded</div><div>${esc(state.sourceText.length)}</div>
    </div>
  `;
}

function reportSummaryHtml(report, title = 'Report') {
  if (!report) return '<div class="uxml-empty">Not run yet.</div>';

  const summary = summarizeReport(report);

  return `
    <div class="uxml-report-card">
      <div class="uxml-report-title">
        ${esc(title)}
        <span class="uxml-pill ${summary.pass ? 'ok' : 'warn'}">${esc(summary.label)}</span>
      </div>
      <div class="uxml-kv-grid uxml-kv-compact">
        ${summary.rows.slice(0, 36).map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join('')}
      </div>
    </div>
  `;
}

function diagnosticsHtml(items = []) {
  if (!items.length) return '<div class="uxml-empty">No diagnostics.</div>';

  return `
    <div class="uxml-diag-list">
      ${items.slice(0, 120).map(d => `
        <div class="uxml-diag uxml-diag-${esc(String(d.severity || 'INFO').toLowerCase())}">
          <span>${esc(d.code || d.severity || 'INFO')}</span>
          <div>${esc(d.message || JSON.stringify(d))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function jsonPreviewHtml(title, value) {
  return `
    <div class="uxml-preview-block">
      <div class="uxml-preview-title">${esc(title)}</div>
      <pre>${esc(JSON.stringify(value || null, null, 2).slice(0, 24000))}</pre>
    </div>
  `;
}

function panelHtml(state) {
  const panel = state.activePanel;
  const p = state.pipeline;

  if (panel === 'source') {
    return `
      <section class="uxml-panel-section">
        <h3>Source Intake</h3>
        <p>Load XML/InputXML/UXML directly. PDF / REV / JSON / TXT / PCF must first go through the existing converter route.</p>
        ${sourceSummaryHtml(state)}
        ${reportSummaryHtml(p.profileReport, 'Profile Detection')}
        <div class="uxml-preview-block">
          <div class="uxml-preview-title">Source Preview</div>
          <pre>${esc((state.sourceText || '').slice(0, 12000))}</pre>
        </div>
      </section>
    `;
  }

  if (panel === 'existing-converter') {
    return `
      <section class="uxml-panel-section">
        <h3>Existing Converter Output</h3>
        <p>Bridge remains explicit: PDF / REV / JSON / TXT / PCF must become InputXML or Standard XML before UXML normalization. No raw PDF/REV/JSON parser is introduced here.</p>
        <div class="uxml-placeholder">Existing converter bridge hook remains deferred to the output/source adapter wave.</div>
      </section>
    `;
  }

  if (panel === 'uxml') {
    return `
      <section class="uxml-panel-section">
        <h3>UXML Normalization</h3>
        ${reportSummaryHtml(p.normalizerResult, 'Normalizer')}
        ${diagnosticsHtml(p.normalizerResult?.diagnostics)}
        ${jsonPreviewHtml('UXML Document', p.uxml)}
      </section>
    `;
  }

  if (panel === 'validation') {
    return `
      <section class="uxml-panel-section">
        <h3>UXML Validation</h3>
        ${reportSummaryHtml(p.validationReport, 'Validation Gate')}
        ${diagnosticsHtml(p.validationReport?.diagnostics)}
        ${jsonPreviewHtml('Validation Report', p.validationReport)}
      </section>
    `;
  }

  if (panel === 'face-model') {
    return `
      <section class="uxml-panel-section">
        <h3>Pre-Topology Face Model</h3>
        ${reportSummaryHtml(p.faceModel, 'Face Model')}
        ${diagnosticsHtml(p.faceModel?.diagnostics)}
        ${jsonPreviewHtml('Face Model', p.faceModel)}
      </section>
    `;
  }

  if (panel === 'universal-topology') {
    return `
      <section class="uxml-panel-section">
        <h3>UniversalTopoGraph</h3>
        ${reportSummaryHtml(p.universalGraph, 'UniversalTopoGraph')}
        ${diagnosticsHtml(p.universalGraph?.diagnostics)}
        ${jsonPreviewHtml('UniversalTopoGraph', p.universalGraph)}
      </section>
    `;
  }

  if (panel === 'ray-topology') {
    return `
      <section class="uxml-panel-section">
        <h3>RayTopoGraph</h3>
        ${reportSummaryHtml(p.rayGraph, 'RayTopoGraph')}
        ${diagnosticsHtml(p.rayGraph?.diagnostics)}
        ${jsonPreviewHtml('RayTopoGraph', p.rayGraph)}
      </section>
    `;
  }

  if (panel === 'comparison') {
    return `
      <section class="uxml-panel-section">
        <h3>Topology Comparison</h3>
        ${reportSummaryHtml(p.comparison, 'Comparator')}
        ${diagnosticsHtml(p.comparison?.diagnostics)}
        ${jsonPreviewHtml('Comparison', p.comparison)}
      </section>
    `;
  }

  if (panel === 'outputs') {
    return `
      <section class="uxml-panel-section">
        <h3>Output Bridges</h3>
        <p>Deferred. Output bridges will consume accepted topology only; no PCF/GLB/InputXML/CII emission is performed in Agent 09.</p>
        <div class="uxml-placeholder">Output bridge placeholders only.</div>
      </section>
    `;
  }

  if (panel === 'masters') {
    return `
      <section class="uxml-panel-section">
        <h3>Final Master Links</h3>
        <p>Deferred. Line list, piping class master and weight master are linked after UXML, UniversalTopoGraph, RayGraph and comparator are stable.</p>
        <div class="uxml-master-placeholder-grid">
          <div class="uxml-master-card"><h4>Line List</h4><div>Status: Deferred</div></div>
          <div class="uxml-master-card"><h4>Piping Class Master</h4><div>Status: Deferred</div></div>
          <div class="uxml-master-card"><h4>Weight Master</h4><div>Status: Deferred</div></div>
        </div>
      </section>
    `;
  }

  return `
    <section class="uxml-panel-section">
      <h3>Unknown panel</h3>
      <div class="uxml-placeholder">${esc(panel)}</div>
    </section>
  `;
}

function canRunXmlActions(state) {
  const selected = state.selectedSourceType === 'AUTO'
    ? state.detectedSourceType
    : state.selectedSourceType;

  return !!state.sourceText.trim() && ['AUTO', 'UXML', 'INPUT_XML', 'EXISTING_XML'].includes(selected);
}

function render(container, state) {
  const xmlReady = canRunXmlActions(state);

  container.innerHTML = `
    <div class="uxml-tab">
      <header class="uxml-header">
        <div>
          <h2>Universal XML Converter</h2>
          <p>XML-first topology workbench: source → UXML → validation → face model → UniversalTopoGraph + RayTopoGraph comparison → output placeholders.</p>
        </div>
        <div class="uxml-header-badges">
          <span class="uxml-badge">Agent 09</span>
          <span class="uxml-badge">Integrated Pipeline</span>
          <span class="uxml-badge muted">Masters deferred</span>
        </div>
      </header>

      <section class="uxml-toolbar">
        <label class="uxml-field">
          <span>Source type</span>
          <select data-uxml-source-type>
            ${SOURCE_TYPES.map(option => `<option value="${esc(option.value)}" ${state.selectedSourceType === option.value ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
          </select>
        </label>

        <label class="uxml-file-btn">
          Load Source
          <input data-uxml-file-input type="file" />
        </label>

        <button data-uxml-action="detect-profile" type="button">Detect Profile</button>
        <button data-uxml-action="convert-uxml" type="button" ${xmlReady ? '' : 'disabled'}>Convert to UXML</button>
        <button data-uxml-action="validate-uxml" type="button" ${state.pipeline.uxml ? '' : 'disabled'}>Validate UXML</button>
        <button data-uxml-action="build-face-model" type="button" ${state.pipeline.uxml ? '' : 'disabled'}>Build Face Model</button>
        <button data-uxml-action="build-universal-topology" type="button" ${state.pipeline.faceModel ? '' : 'disabled'}>Build UniversalTopoGraph</button>
        <button data-uxml-action="build-ray-topology" type="button" ${state.pipeline.faceModel ? '' : 'disabled'}>Build RayTopoGraph</button>
        <button data-uxml-action="compare-topology" type="button" ${state.pipeline.universalGraph && state.pipeline.rayGraph ? '' : 'disabled'}>Compare</button>
        <button data-uxml-action="run-full-pipeline" type="button" ${xmlReady ? '' : 'disabled'}>Run Full Pipeline</button>
        <button data-uxml-action="export-summary" type="button">Export Summary JSON</button>
      </section>

      <div class="uxml-status ${statusClass(state.status.kind)}">${esc(state.status.message)}</div>

      <main class="uxml-layout">
        <aside class="uxml-stages">
          ${PIPELINE_STAGES.map(stage => renderStageCard(stage, state)).join('')}
        </aside>
        <section class="uxml-panel">
          ${panelHtml(state)}
        </section>
      </main>
    </div>
  `;
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
        value
          ? {
              pass: reportPass(value),
              summary: value.summary || value.stats || null,
            }
          : null,
      ])
    ),
    comparator: state.pipeline.comparison?.summary || null,
    deferred: {
      existingConverterBridge: true,
      outputBridges: true,
      masters: true,
    },
  };
}

function downloadText(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

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
  container.addEventListener('change', async event => {
    const sourceSelect = event.target.closest('[data-uxml-source-type]');

    if (sourceSelect) {
      state.selectedSourceType = sourceSelect.value || 'AUTO';
      state.status = {
        kind: 'info',
        message: `Source type set to ${state.selectedSourceType}.`,
      };
      render(container, state);
      return;
    }

    const fileInput = event.target.closest('[data-uxml-file-input]');
    if (!fileInput) return;

    const file = fileInput.files?.[0] || null;

    if (!file) {
      state.status = {
        kind: 'warn',
        message: 'No file selected.',
      };
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
      state.status = {
        kind: 'error',
        message: `Failed to read source file: ${error.message}`,
      };
    }

    render(container, state);
  });

  container.addEventListener('click', event => {
    const panelButton = event.target.closest('[data-uxml-panel]');

    if (panelButton) {
      state.activePanel = panelButton.dataset.uxmlPanel || 'source';
      render(container, state);
      return;
    }

    const actionButton = event.target.closest('[data-uxml-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.uxmlAction;

    try {
      if (action === 'export-summary') {
        exportSummary(state);
        state.status = {
          kind: 'ok',
          message: 'Universal XML Converter Agent09 summary exported.',
        };
      } else {
        runPipelineAction(state, action);

        if (action === 'detect-profile') state.activePanel = 'source';
        if (action === 'convert-uxml') state.activePanel = 'uxml';
        if (action === 'validate-uxml') state.activePanel = 'validation';
        if (action === 'build-face-model') state.activePanel = 'face-model';
        if (action === 'build-universal-topology') state.activePanel = 'universal-topology';
        if (action === 'build-ray-topology') state.activePanel = 'ray-topology';
        if (action === 'compare-topology' || action === 'run-full-pipeline') state.activePanel = 'comparison';
      }
    } catch (error) {
      state.status = {
        kind: 'error',
        message: error.message,
      };
    }

    render(container, state);
  });
}

export function renderUniversalXmlConverterTab(container) {
  const state = createInitialState();

  render(container, state);
  bindEvents(container, state);

  return () => {
    container.innerHTML = '';
  };
}

export const _test = Object.freeze({
  createInitialState,
  summarizeReport,
  buildSummary,
  canRunXmlActions,
});