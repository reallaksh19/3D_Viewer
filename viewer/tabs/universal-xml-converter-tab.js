/**
 * universal-xml-converter-tab.js
 *
 * Phase U1: independent tab shell for the future UXML pipeline.
 *
 * Scope in this phase:
 * - Create standalone tab.
 * - Load/preview source text files.
 * - Show intended pipeline stages.
 * - Provide placeholder action buttons.
 * - Do not mutate existing PCF/RVM extraction state.
 * - Do not implement topology, ray, masters, or output bridges yet.
 */

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
    description: 'Use existing converter route to produce InputXML or Standard XML.',
  },
  {
    id: 'uxml',
    title: '3. UXML Normalization',
    description: 'Normalize InputXML / Standard XML / PCF into Universal XML.',
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
    description: 'Build source-faithful topology graph from UXML.',
  },
  {
    id: 'ray-topology',
    title: '7. RayTopoGraph',
    description: 'Run Ray topology as independent benchmark/oracle.',
  },
  {
    id: 'comparison',
    title: '8. Topology Comparison',
    description: 'Compare UniversalTopoGraph against RayGraph.',
  },
  {
    id: 'outputs',
    title: '9. Output Bridges',
    description: 'Prepare PCF / GLB / 2D / InputXML / CII outputs from accepted topology.',
  },
  {
    id: 'masters',
    title: '10. Final Master Links',
    description: 'Line list / piping class / weight master enrichment. Deferred until last phase.',
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

function detectSourceType(fileName = '', text = '') {
  const name = String(fileName || '').toLowerCase();
  const trimmed = String(text || '').trimStart();

  if (name.endsWith('.pcf')) return 'PCF';
  if (name.endsWith('.pdf')) return 'PDF_TO_INPUTXML';
  if (name.endsWith('.rev') || name.endsWith('.rvm')) return 'REV_TO_XML';
  if (name.endsWith('.json')) return 'JSON_TO_XML';
  if (name.endsWith('.txt')) return 'TXT_TO_XML';
  if (name.endsWith('.xml')) {
    if (trimmed.includes('<UXML') || trimmed.includes('<UniversalXML')) return 'UXML';
    if (/input\s*xml/i.test(trimmed) || /<Input/i.test(trimmed)) return 'INPUT_XML';
    return 'EXISTING_XML';
  }

  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) return 'EXISTING_XML';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'JSON_TO_XML';

  return 'AUTO';
}

function createInitialState() {
  return {
    sourceFile: null,
    sourceText: '',
    selectedSourceType: 'AUTO',
    detectedSourceType: 'AUTO',
    converterOutputText: '',
    uxmlText: '',
    activePanel: 'source',
    status: {
      kind: 'info',
      message: 'Universal XML Converter tab is ready.',
    },
    reports: {
      source: null,
      converter: null,
      uxml: null,
      validation: null,
      faceModel: null,
      topology: null,
      ray: null,
      comparison: null,
      outputs: null,
      masters: null,
    },
  };
}

function statusClass(kind) {
  if (kind === 'error') return 'uxml-status-error';
  if (kind === 'warn') return 'uxml-status-warn';
  if (kind === 'ok') return 'uxml-status-ok';
  return 'uxml-status-info';
}

function renderStageCard(stage, state) {
  const isActive = state.activePanel === stage.id;
  const report = state.reports?.[stage.id] || null;
  const deferred = stage.deferred === true;

  return `
    <button
      class="uxml-stage-card ${isActive ? 'is-active' : ''} ${deferred ? 'is-deferred' : ''}"
      data-uxml-panel="${esc(stage.id)}"
      type="button"
    >
      <div class="uxml-stage-title">${esc(stage.title)}</div>
      <div class="uxml-stage-description">${esc(stage.description)}</div>
      <div class="uxml-stage-meta">
        ${
          deferred
            ? '<span class="uxml-pill muted">Deferred</span>'
            : report
              ? `<span class="uxml-pill ${report.pass ? 'ok' : 'warn'}">${report.pass ? 'Ready' : 'Pending'}</span>`
              : '<span class="uxml-pill muted">Not run</span>'
        }
      </div>
    </button>
  `;
}

function sourceSummaryHtml(state) {
  const file = state.sourceFile;

  if (!file) {
    return `
      <div class="uxml-empty">
        No source loaded.
      </div>
    `;
  }

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

function panelHtml(state) {
  const panel = state.activePanel;

  if (panel === 'source') {
    return `
      <section class="uxml-panel-section">
        <h3>Source Intake</h3>
        <p>
          Load source data. Raw PDF / REV / JSON / TXT will not be parsed directly by topology.
          They must go through existing converters into InputXML or Standard XML.
        </p>

        ${sourceSummaryHtml(state)}

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
        <p>
          Phase U2 will bridge existing converter routes:
          PDF → InputXML, REV → XML, JSON → XML/InputXML, TXT → XML.
        </p>
        <div class="uxml-placeholder">
          Converter bridge not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'uxml') {
    return `
      <section class="uxml-panel-section">
        <h3>UXML Normalization</h3>
        <p>
          Phase U4 will normalize InputXML / Standard XML / PCF into the project-owned UXML contract.
        </p>
        <div class="uxml-placeholder">
          UXML normalizer not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'validation') {
    return `
      <section class="uxml-panel-section">
        <h3>UXML Validation</h3>
        <p>
          Phase U5 will validate structure, anchors, bore, branch, support, units, loss contract and topology sufficiency.
        </p>
        <div class="uxml-placeholder">
          Validation engine not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'face-model') {
    return `
      <section class="uxml-panel-section">
        <h3>Pre-Topology Component/Fitting Face Model</h3>
        <p>
          Phase U6 will emit faces for RayTopoBuilder before UniversalTopoGraph is solved.
        </p>
        <div class="uxml-placeholder">
          Face model builder not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'universal-topology') {
    return `
      <section class="uxml-panel-section">
        <h3>UniversalTopoGraph</h3>
        <p>
          Phase U7 will build source-faithful graph from UXML anchors, ports, segments and supports.
        </p>
        <div class="uxml-placeholder">
          Universal topology builder not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'ray-topology') {
    return `
      <section class="uxml-panel-section">
        <h3>RayTopoGraph</h3>
        <p>
          Phase U8 will run Ray topology as an independent benchmark/oracle from the pre-topology face model.
        </p>
        <div class="uxml-placeholder">
          Ray benchmark path not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'comparison') {
    return `
      <section class="uxml-panel-section">
        <h3>Topology Comparison</h3>
        <p>
          Phase U9 will compare UniversalTopoGraph and RayGraph: agree, universal-only, ray-only, reject, promote, manual review.
        </p>
        <div class="uxml-placeholder">
          Comparator not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'outputs') {
    return `
      <section class="uxml-panel-section">
        <h3>Output Bridges</h3>
        <p>
          Phase U11 will export accepted topology to PCF / GLB / 2D / InputXML / CII.
        </p>
        <div class="uxml-placeholder">
          Output bridges not implemented in U1.
        </div>
      </section>
    `;
  }

  if (panel === 'masters') {
    return `
      <section class="uxml-panel-section">
        <h3>Final Master Links</h3>
        <p>
          Deferred. Line list, piping class master and weight master are linked only after UXML, UniversalTopoGraph,
          RayGraph and comparator are stable.
        </p>

        <div class="uxml-master-placeholder-grid">
          <div class="uxml-master-card">
            <h4>Line List</h4>
            <div>Status: Deferred</div>
          </div>
          <div class="uxml-master-card">
            <h4>Piping Class Master</h4>
            <div>Status: Deferred</div>
          </div>
          <div class="uxml-master-card">
            <h4>Weight Master</h4>
            <div>Status: Deferred</div>
          </div>
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

function render(container, state) {
  container.innerHTML = `
    <div class="uxml-tab">
      <header class="uxml-header">
        <div>
          <h2>Universal XML Converter</h2>
          <p>
            XML-first topology workbench:
            source → InputXML/XML → UXML → UniversalTopoGraph + RayGraph comparison → outputs.
          </p>
        </div>
        <div class="uxml-header-badges">
          <span class="uxml-badge">Phase U1</span>
          <span class="uxml-badge">Tab Shell</span>
          <span class="uxml-badge muted">Masters deferred</span>
        </div>
      </header>

      <section class="uxml-toolbar">
        <label class="uxml-field">
          <span>Source type</span>
          <select data-uxml-source-type>
            ${SOURCE_TYPES.map(option => `
              <option value="${esc(option.value)}" ${state.selectedSourceType === option.value ? 'selected' : ''}>
                ${esc(option.label)}
              </option>
            `).join('')}
          </select>
        </label>

        <label class="uxml-file-btn">
          Load Source
          <input data-uxml-file-input type="file" />
        </label>

        <button data-uxml-action="detect-profile" type="button">Detect Profile</button>
        <button data-uxml-action="run-existing-converter" type="button" disabled>Run Existing Converter</button>
        <button data-uxml-action="convert-uxml" type="button" disabled>Convert to UXML</button>
        <button data-uxml-action="validate-uxml" type="button" disabled>Validate UXML</button>
        <button data-uxml-action="export-summary" type="button">Export Summary JSON</button>
      </section>

      <div class="uxml-status ${statusClass(state.status.kind)}">
        ${esc(state.status.message)}
      </div>

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
  const summary = {
    schema: 'pcf-glb-viewer/universal-xml-converter-tab-summary/v1',
    phase: 'U1',
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
    implemented: {
      tabShell: true,
      sourceLoad: true,
      profileDetectionPlaceholder: true,
      existingConverterBridge: false,
      uxmlNormalization: false,
      topologyBuilder: false,
      rayBuilder: false,
      comparator: false,
      outputBridges: false,
      masters: false,
    },
    pipeline: PIPELINE_STAGES.map(stage => ({
      id: stage.id,
      title: stage.title,
      deferred: stage.deferred === true,
    })),
  };

  downloadText(
    'universal_xml_converter_u1_summary.json',
    JSON.stringify(summary, null, 2),
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
    if (fileInput) {
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
    }
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

    if (action === 'detect-profile') {
      if (!state.sourceFile) {
        state.status = {
          kind: 'warn',
          message: 'Load a source file before detecting profile.',
        };
      } else {
        state.detectedSourceType = detectSourceType(state.sourceFile.name, state.sourceText);
        state.status = {
          kind: 'ok',
          message: `Profile placeholder detected: ${state.detectedSourceType}. Full XML detector arrives in Phase U3.`,
        };
      }

      render(container, state);
      return;
    }

    if (action === 'export-summary') {
      exportSummary(state);
      state.status = {
        kind: 'ok',
        message: 'Universal XML Converter U1 summary exported.',
      };
      render(container, state);
    }
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