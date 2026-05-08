import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state } from '../core/state.js';
import { on, off } from '../core/event-bus.js';
import './rvm-json-pcf-extract-tab.css';

let _offExtractRequested = null;
let _offStateChanged = null;

function _updateHeader(container) {
  const sourceLabel = container.querySelector('.rvm-pcf-extract-source-label');
  const scopeLabel = container.querySelector('.rvm-pcf-extract-scope-label');
  const nodeCount = container.querySelector('.rvm-pcf-extract-node-count');
  const statusEl = container.querySelector('.rvm-pcf-extract-status');

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

  if (statusEl) {
    if (s.scope === 'selected') {
      statusEl.textContent = `Scope set to selected (${ids.length} nodes). Click "Reload Scope" to build extract.`;
    } else {
      statusEl.textContent = 'Scope set to full model. Click "Reload Scope" to build extract.';
    }
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
    <div class="rvm-pcf-extract-status">Ready. Load an RVM bundle and click "Extract PCF (from Json)".</div>
  </div>
</div>
`;

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
