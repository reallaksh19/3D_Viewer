import { RuntimeEvents } from '../contracts/runtime-events.js';
import { state, updateRvmPcfExtractState } from '../core/state.js';
import { on, off, emit } from '../core/event-bus.js';
import { mountRvmPcfLegacyMasterPanel } from '../rvm-pcf-master-tabs/RvmPcfLegacyMasterPanel.js';

let _offExtractRequested = null;
let _offStateChanged = null;

function _esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Header ────────────────────────────────────────────────────────────────────

function _updateHeader(container) {
  const sourceLabel = container.querySelector('.rvm-pcf-extract-source-label');
  const scopeLabel  = container.querySelector('.rvm-pcf-extract-scope-label');
  const nodeCount   = container.querySelector('.rvm-pcf-extract-node-count');

  const s   = state.rvmPcfExtract;
  const ids = s.selectedCanonicalIds || [];

  if (sourceLabel) {
    const label = state.rvm?.index?.nodes?.length
      ? `${state.rvm.index.nodes.length} node(s) in model`
      : '(no model loaded)';
    sourceLabel.textContent = `Source: ${label}`;
  }

  if (s.scope === 'selected') {
    if (scopeLabel) scopeLabel.textContent = `Scope: selected (${ids.length} nodes)`;
    if (nodeCount)  nodeCount.textContent  = `${ids.length} node(s) selected`;
  } else {
    if (scopeLabel) scopeLabel.textContent = 'Scope: full model';
    if (nodeCount)  nodeCount.textContent  = '';
  }
}

function _auditSummaryHtml(report) {
  if (!report) return '<div class="rvm-pcf-extract-status">Run PCF Audit to build the audit summary.</div>';
  const s = report.summary || {};
  const sev = report.bySeverity || {};
  const kv = [
    ['Audit pass', report.pass ? 'YES' : 'NO'],
    ['Errors', sev.ERROR || 0],
    ['Warnings', sev.WARNING || 0],
    ['Rows', s.rowCount || 0],
    ['Included rows', s.includedRows || 0],
    ['Excluded rows', s.excludedRows || 0],
    ['Missing coordinate rows', s.missingCoordinateRows || 0],
    ['PIPE rows with SKEY', s.rowsWithPipeSkey || 0],
    ['Source CA21 rows', s.rowsWithCa21 || 0],
    ['Rows with converted bore', s.rowsWithConvertedBore || 0],
    ['Line-key bore candidates', s.rowsWithLineKeyBoreCandidate || 0],
    ['PCF pipelines', s.pcfPipelineCount || 0],
    ['Expected download mode', s.expectedDownloadMode || 'single-file'],
    ['Generated PIPE SKEY blocks', s.generatedPipeBlocksWithSkey || 0],
    ['Generated origin coordinate lines', s.generatedOriginCoordinateLines || 0],
    ['Generated ATTRIBUTE21 lines', s.generatedAttribute21Lines || 0],
  ];
  return `
    <div class="rvm-pcf-extract-status-card">
      ${kv.map(([k, v]) => `<div class="rvm-pcf-status-row"><span class="rvm-pcf-label">${_esc(k)}</span><span>${_esc(v)}</span></div>`).join('')}
    </div>
  `;
}

// ── Panel renderer ────────────────────────────────────────────────────────────

function _showPanel(container, panelId) {
  const host = container.querySelector('#rvm-pcf-extract-panel-host');
  if (!host) return;

  container.querySelectorAll('[data-panel]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.panel === panelId);
  });

  if (panelId === 'masters') {
    mountRvmPcfLegacyMasterPanel(host);
    return;
  }

  if (panelId === 'scope') {
    const s   = state.rvmPcfExtract;
    const ids = s.selectedCanonicalIds || [];
    const indexNodes = state.rvm?.index?.nodes?.length ?? 0;
    host.innerHTML = `
      <div class="rvm-pcf-extract-status-card">
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Model nodes</span><span>${indexNodes}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Scope</span><span>${s.scope === 'selected' ? `selected (${ids.length} nodes)` : 'full model'}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Last extracted</span><span>${s.lastBuiltAt ? new Date(s.lastBuiltAt).toLocaleString() : 'Never'}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">2D CSV rows</span><span>${(s.rows || []).length}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">PCF pipelines</span><span>${Object.keys(s.pcfTextByPipelineRef || {}).length}</span></div>
      </div>
    `;
    return;
  }

  if (panelId === 'table') {
    const rows = state.rvmPcfExtract?.rows || [];
    if (!rows.length) {
      host.innerHTML = '<div class="rvm-pcf-extract-status">No rows yet — click "Rebuild 2D CSV" to build.</div>';
      return;
    }
    const COLS = ['rowNo','type','pipelineRef','name','convertedBore','include','_epFallback','convertedBoreStatus','pipelineRefSource'];
    const visibleCols = COLS.filter(c => rows.some(r => r[c] != null));
    host.innerHTML = `
      <div style="padding:8px;font-size:11px;color:#9aa9bd;">${rows.length} row(s)</div>
      <div class="rvm-pcf-table-wrap">
        <table class="rvm-pcf-table">
          <thead><tr>${visibleCols.map(c => `<th>${_esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 500).map(r =>
            `<tr class="${r.include === false ? 'row-excluded' : ''}">${visibleCols.map(c => `<td>${_esc(r[c])}</td>`).join('')}</tr>`
          ).join('')}</tbody>
        </table>
        ${rows.length > 500 ? `<div class="rvm-pcf-extract-status">Showing 500 of ${rows.length} rows.</div>` : ''}
      </div>
    `;
    return;
  }

  if (panelId === 'diagnostics') {
    const diags = state.rvmPcfExtract?.diagnostics || [];
    const audit = state.rvmPcfExtract?.pcfAuditReport || null;
    const sevClass = s => s === 'ERROR' ? 'diag-error' : s === 'WARNING' ? 'diag-warn' : 'diag-info';
    host.innerHTML = `
      ${_auditSummaryHtml(audit)}
      <div style="padding:8px;font-size:11px;color:#9aa9bd;">${diags.length} diagnostic(s)</div>
      <div class="rvm-pcf-diag-list">
        ${diags.length ? diags.map(d => `
          <div class="rvm-pcf-diag ${sevClass(d.severity || d.level || 'INFO')}">
            <span class="rvm-pcf-diag-code">${_esc(d.code || d.severity || 'INFO')}</span>
            <span>${_esc(d.message || JSON.stringify(d))}</span>
          </div>
        `).join('') : '<div class="rvm-pcf-extract-status">No diagnostics yet.</div>'}
      </div>
    `;
    return;
  }

  if (panelId === 'pcf') {
    const byRef = state.rvmPcfExtract?.pcfTextByPipelineRef || {};
    const refs  = Object.keys(byRef);
    if (!refs.length) {
      host.innerHTML = '<div class="rvm-pcf-extract-status">No PCF yet — click "Generate PCF" to build.</div>';
      return;
    }
    host.innerHTML = refs.map(ref => `
      <div class="rvm-pcf-ref-block">
        <div class="rvm-pcf-ref-title">${_esc(ref)}</div>
        <pre class="rvm-pcf-extract-pre">${_esc(byRef[ref])}</pre>
      </div>
    `).join('');
    return;
  }
}

function _setStatus(container, msg, isError = false) {
  const el = container.querySelector('.rvm-pcf-extract-run-status');
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? '#ff7171' : '#7ddc9a';
  }
}

async function _runRebuildCsv(container) {
  const indexJson = state.rvm?.index;
  if (!indexJson?.nodes?.length) {
    _setStatus(container, 'No model loaded. Load an RVM bundle in the 3D viewer first.', true);
    return false;
  }
  _setStatus(container, 'Building 2D CSV…');
  try {
    const [{ RvmFinal2dCsvBuilder }, { RvmExtractHardening }] = await Promise.all([
      import('../rvm-pcf-extract/RvmFinal2dCsvBuilder.js'),
      import('../rvm-pcf-extract/RvmExtractHardening.js'),
    ]);
    const selectedCanonicalIds = state.rvmPcfExtract.selectedCanonicalIds || [];
    const masters              = state.rvmPcfExtract.masters || {};
    const builder = new RvmFinal2dCsvBuilder(indexJson, { selectedCanonicalIds, masters });
    const { rows, diagnostics: buildDiags } = builder.build();
    const hardening = new RvmExtractHardening();
    hardening.sortRows(rows);
    updateRvmPcfExtractState({ rows, diagnostics: [...(state.rvmPcfExtract.diagnostics || []), ...buildDiags], lastBuiltAt: new Date().toISOString() }, 'rebuild-csv');
    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, { action: 'REBUILD_CSV' });
    _setStatus(container, `Built ${rows.length} row(s).`);
    return true;
  } catch (err) {
    _setStatus(container, `Build failed: ${err.message}`, true);
    return false;
  }
}

async function _runAudit(container) {
  const rows = state.rvmPcfExtract?.rows || [];
  const byRef = state.rvmPcfExtract?.pcfTextByPipelineRef || {};
  if (!rows.length) {
    _setStatus(container, 'No rows to audit — rebuild CSV first.', true);
    _showPanel(container, 'diagnostics');
    return false;
  }
  try {
    const { RvmExtractHardening } = await import('../rvm-pcf-extract/RvmExtractHardening.js');
    const hardening = new RvmExtractHardening();
    const report = hardening.buildPcfAuditReport(rows, byRef, state.rvm?.sourceName || 'RVM JSON PCF Extract');
    const existing = (state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'pcf-audit');
    updateRvmPcfExtractState({
      pcfAuditReport: report,
      diagnostics: [...existing, ...report.diagnostics.map(d => ({ ...d, _source: 'pcf-audit' }))],
    }, 'pcf-audit');
    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, { action: 'PCF_AUDIT' });
    _setStatus(container, `Audit complete: ${(report.bySeverity.ERROR || 0)} error(s), ${(report.bySeverity.WARNING || 0)} warning(s).`, !report.pass);
    _showPanel(container, 'diagnostics');
    return report.pass;
  } catch (err) {
    _setStatus(container, `Audit failed: ${err.message}`, true);
    return false;
  }
}

async function _runValidate(container) {
  const rows = state.rvmPcfExtract?.rows || [];
  if (!rows.length) {
    _setStatus(container, 'No rows to validate — rebuild CSV first.', true);
    _showPanel(container, 'diagnostics');
    return;
  }
  _setStatus(container, 'Validating…');
  try {
    const { RvmExtractHardening } = await import('../rvm-pcf-extract/RvmExtractHardening.js');
    const hardening = new RvmExtractHardening();
    const register  = hardening.buildValidationRegister(rows);
    const existing = (state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'validate');
    updateRvmPcfExtractState({ diagnostics: [...existing, ...register.map(d => ({ ...d, _source: 'validate' }))] }, 'validate');
    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, { action: 'VALIDATE' });
    _setStatus(container, `${register.length} diagnostic(s).`);
    _showPanel(container, 'diagnostics');
  } catch (err) {
    _setStatus(container, `Validate failed: ${err.message}`, true);
  }
}

async function _runGeneratePcf(container) {
  let rows = state.rvmPcfExtract?.rows || [];
  if (!rows.length) {
    const ok = await _runRebuildCsv(container);
    if (!ok) return;
    rows = state.rvmPcfExtract?.rows || [];
  }
  _setStatus(container, 'Generating PCF…');
  try {
    const { RvmPcfEmitter } = await import('../rvm-pcf-extract/RvmPcfEmitter.js');
    const emitter = new RvmPcfEmitter({ allowPartialPcf: true });
    const { pcfTextByPipelineRef, errors, warnings } = emitter.emit(rows);
    updateRvmPcfExtractState({ pcfTextByPipelineRef, diagnostics: [...(state.rvmPcfExtract.diagnostics || []), ...errors.map(e => ({ severity: 'ERROR', _source: 'pcf-emit', ...e })), ...warnings.map(w => ({ severity: 'WARNING', _source: 'pcf-emit', ...w }))] }, 'generate-pcf');
    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, { action: 'GENERATE_PCF' });
    const pipelineCount = Object.keys(pcfTextByPipelineRef).length;
    _setStatus(container, `Generated PCF for ${pipelineCount} pipeline(s).`);
    await _runAudit(container);
    _showPanel(container, 'pcf');
  } catch (err) {
    _setStatus(container, `PCF generation failed: ${err.message}`, true);
  }
}

async function _runDownloadCsv(container) {
  const rows = state.rvmPcfExtract?.rows || [];
  if (!rows.length) { _setStatus(container, 'No rows — rebuild CSV first.', true); return; }
  const { downloadCsv } = await import('../rvm-pcf-extract/RvmPcfDownload.js');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  downloadCsv(`rvm-pcf-extract-${ts}.csv`, rows);
  _setStatus(container, 'CSV downloaded.');
}

async function _runDownloadPcf(container) {
  const byRef = state.rvmPcfExtract?.pcfTextByPipelineRef || {};
  if (!Object.keys(byRef).length) {
    const ok = await _runGeneratePcf(container);
    if (!ok) return;
  }
  const { RvmExtractHardening } = await import('../rvm-pcf-extract/RvmExtractHardening.js');
  const hardening = new RvmExtractHardening();
  const files = hardening.downloadAllPcf(state.rvmPcfExtract.pcfTextByPipelineRef || {});
  _setStatus(container, `Downloaded ${files.length} PCF file(s).`);
}

export function mount(container) {
  container.innerHTML = `
<div class="rvm-pcf-extract-tab">
  <div class="rvm-pcf-extract-header">
    <span class="rvm-pcf-extract-source-label">Source: (none)</span>
    <span class="rvm-pcf-extract-scope-label">Scope: full</span>
    <span class="rvm-pcf-extract-node-count"></span>
    <span class="rvm-pcf-extract-run-status" style="margin-left:auto;font-size:11px;color:#7ddc9a;"></span>
  </div>
  <div class="rvm-pcf-extract-toolbar">
    <button data-action="RELOAD_SCOPE">Reload Scope</button>
    <button data-action="REBUILD_CSV">Rebuild 2D CSV</button>
    <button data-action="VALIDATE">Validate</button>
    <button data-action="RUN_AUDIT">Run PCF Audit</button>
    <button data-action="GENERATE_PCF">Generate PCF</button>
    <button data-action="DOWNLOAD_CSV">Download CSV</button>
    <button data-action="DOWNLOAD_PCF">Download PCF</button>
  </div>
  <div class="rvm-pcf-extract-body"><div class="rvm-pcf-extract-layout"><aside class="rvm-pcf-extract-rail">
    <button data-panel="scope" class="is-active">Scope</button><button data-panel="masters">Masters</button><button data-panel="table">2D CSV</button><button data-panel="diagnostics">Diagnostics</button><button data-panel="pcf">PCF</button>
  </aside><section class="rvm-pcf-extract-main"><div id="rvm-pcf-extract-panel-host"><div class="rvm-pcf-extract-status">Ready. Load an RVM bundle in the 3D viewer, then click "Rebuild 2D CSV".</div></div></section></div></div>
</div>`;
  container.querySelectorAll('[data-panel]').forEach(btn => btn.addEventListener('click', () => _showPanel(container, btn.dataset.panel)));
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        switch (btn.dataset.action) {
          case 'RELOAD_SCOPE': _updateHeader(container); _showPanel(container, 'scope'); break;
          case 'REBUILD_CSV': await _runRebuildCsv(container); _showPanel(container, 'table'); break;
          case 'VALIDATE': await _runValidate(container); break;
          case 'RUN_AUDIT': await _runAudit(container); break;
          case 'GENERATE_PCF': await _runGeneratePcf(container); break;
          case 'DOWNLOAD_CSV': await _runDownloadCsv(container); break;
          case 'DOWNLOAD_PCF': await _runDownloadPcf(container); break;
        }
      } finally { btn.disabled = false; }
    });
  });
  _updateHeader(container); _showPanel(container, 'scope');
  _offExtractRequested = on(RuntimeEvents.RVM_EXTRACT_PCF_REQUESTED, async () => { _updateHeader(container); await _runRebuildCsv(container); _showPanel(container, 'table'); });
  _offStateChanged = on(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, () => { _updateHeader(container); });
}

export function dispose() {
  if (_offExtractRequested) { _offExtractRequested(); _offExtractRequested = null; }
  if (_offStateChanged)     { _offStateChanged();     _offStateChanged     = null; }
}

export default mount;
