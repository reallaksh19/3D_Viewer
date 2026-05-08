import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state } from '../core/state.js';
import { on, off } from '../core/event-bus.js';
import { renderRvmPcfMasterTabs } from '../rvm-pcf-master-tabs/RvmPcfMasterTabs.js';

let _offExtractRequested = null;
let _offStateChanged = null;

function _updateHeader(container) {
  const sourceLabel = container.querySelector('.rvm-pcf-extract-source-label');
  const scopeLabel = container.querySelector('.rvm-pcf-extract-scope-label');
  const nodeCount = container.querySelector('.rvm-pcf-extract-node-count');

  const s = state.rvmPcfExtract;
  if (sourceLabel) sourceLabel.textContent = `Source: ${s.sourceLabel || '(none)'}`;

  const ids = s.selectedCanonicalIds || [];
  if (s.scope === 'selected') {
    if (scopeLabel) scopeLabel.textContent = `Scope: selected (${ids.length} nodes)`;
    if (nodeCount) nodeCount.textContent = `${ids.length} node(s) selected`;
  } else {
    if (scopeLabel) scopeLabel.textContent = 'Scope: full';
    if (nodeCount) nodeCount.textContent = '';
  }
}

function _showPanel(container, panelId) {
  const host = container.querySelector('#rvm-pcf-extract-panel-host');
  if (!host) return;

  container.querySelectorAll('[data-panel]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.panel === panelId);
  });

  if (panelId === 'masters') {
    renderRvmPcfMasterTabs(host);
    return;
  }

  if (panelId === 'scope') {
    const s = state.rvmPcfExtract;
    const ids = s.selectedCanonicalIds || [];
    host.innerHTML = `<div class="rvm-pcf-extract-status">Scope: ${s.scope === 'selected' ? `selected (${ids.length} nodes)` : 'full model'}</div>`;
    return;
  }

  if (panelId === 'table') {
    host.innerHTML = `<div class="rvm-pcf-extract-status">Final 2D CSV rows: ${(state.rvmPcfExtract?.rows || []).length}</div>`;
    return;
  }

  if (panelId === 'diagnostics') {
    host.innerHTML = `<pre class="rvm-pcf-extract-pre">${JSON.stringify(state.rvmPcfExtract?.diagnostics || [], null, 2)}</pre>`;
    return;
  }

  if (panelId === 'pcf') {
    host.innerHTML = `<pre class="rvm-pcf-extract-pre">${Object.values(state.rvmPcfExtract?.pcfTextByPipelineRef || {}).join('\n\n')}</pre>`;
    return;
  }
}

export function mount(container, ctx) {
  container.innerHTML = `
<div class="rvm-pcf-extract-tab">
  <div class="rvm-pcf-extract-header">
    <span class="rvm-pcf-extract-source-label">Source: (none)</span>
    <span class="rvm-pcf-extract-scope-label">Scope: full</span>
    <span class="rvm-pcf-extract-node-count"></span>
  </div>
  <div class="rvm-pcf-extract-toolbar">
    <button data-action="RELOAD_SCOPE">Reload Scope</button>
    <button data-action="REBUILD_CSV">Rebuild Final 2D CSV</button>
    <button data-action="VALIDATE">Validate</button>
    <button data-action="GENERATE_PCF">Generate PCF</button>
    <button data-action="DOWNLOAD_CSV">Download CSV</button>
    <button data-action="DOWNLOAD_PCF">Download PCF</button>
  </div>
  <div class="rvm-pcf-extract-body">
    <div class="rvm-pcf-extract-layout">
      <aside class="rvm-pcf-extract-rail">
        <button data-panel="scope" class="is-active">Scope</button>
        <button data-panel="masters">Masters</button>
        <button data-panel="table">Final 2D CSV</button>
        <button data-panel="diagnostics">Diagnostics</button>
        <button data-panel="pcf">PCF</button>
      </aside>
      <section class="rvm-pcf-extract-main">
        <div id="rvm-pcf-extract-panel-host">
          <div class="rvm-pcf-extract-status">Ready. Load an RVM bundle and click "Extract PCF (from Json)".</div>
        </div>
      </section>
    </div>
  </div>
</div>
`;

  container.querySelectorAll('[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => _showPanel(container, btn.dataset.panel));
  });

  _offExtractRequested = on(RuntimeEvents.RVM_EXTRACT_PCF_REQUESTED, () => {
    _updateHeader(container);
  });

  _offStateChanged = on(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, () => {
    _updateHeader(container);
  });
}

export function dispose() {
  if (_offExtractRequested) { _offExtractRequested(); _offExtractRequested = null; }
  if (_offStateChanged) { _offStateChanged(); _offStateChanged = null; }
}

export default mount;
