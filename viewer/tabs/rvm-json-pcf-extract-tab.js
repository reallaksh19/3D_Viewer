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
  const isSelected = s.scope === 'selected' || ids.length > 0;

  if (sourceLabel) {
    const label = state.rvm?.index?.nodes?.length
      ? `${state.rvm.index.nodes.length} node(s) in model`
      : '(no model loaded)';
    sourceLabel.textContent = `Source: ${label}`;
  }

  if (isSelected) {
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
  const continuity = state.rvmPcfExtract?.continuityReport || null;
  const kv = [
    ['Audit pass', report.pass ? 'YES' : 'NO'],
    ['Errors', sev.ERROR || 0],
    ['Warnings', sev.WARNING || 0],
    ['Rows', s.rowCount || 0],
    ['Included rows', s.includedRows || 0],
    ['Excluded rows', s.excludedRows || 0],
    ['Missing coordinate rows', s.missingCoordinateRows || 0],
    ['Source CA21 rows', s.rowsWithCa21 || 0],
    ['Rows with converted bore', s.rowsWithConvertedBore || 0],
    ['Line-key bore candidates', s.rowsWithLineKeyBoreCandidate || 0],
    ['PCF pipelines', s.pcfPipelineCount || 0],
    ['Expected download mode', s.expectedDownloadMode || 'single-file'],
    ['Generated origin coordinate lines', s.generatedOriginCoordinateLines || 0],
    ['Generated component attribute lines', s.generatedComponentAttributeLines || 0],
  ];
  if (continuity) {
    kv.push(
      ['Continuity ok', continuity.ok ? 'YES' : 'NO'],
      ['Continuity tolerance (mm)', continuity.toleranceMm || 0],
      ['Continuity max deviation (mm)', continuity.maxDeviationMm || 0],
      ['Continuity fixable', continuity.fixableCount || 0],
      ['Continuity fatal', continuity.fatalCount || 0],
      ['Continuity adjustments', (continuity.adjustments || []).length || 0],
    );
  }
  return `
    <div class="rvm-pcf-extract-status-card">
      ${kv.map(([k, v]) => `<div class="rvm-pcf-status-row"><span class="rvm-pcf-label">${_esc(k)}</span><span>${_esc(v)}</span></div>`).join('')}
    </div>
  `;
}

function _continuitySettingsHtml(continuity) {
  return `
    <div class="rvm-pcf-extract-status-card" style="margin-top:12px;">
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Continuity tolerance (mm)</span>
        <input type="number" step="0.001" min="0" data-continuity-key="continuityMismatchToleranceMm" value="${_esc(continuity?.continuityMismatchToleranceMm ?? 6)}" style="max-width:140px;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:6px;padding:6px 8px;">
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Auto adjust small gaps</span>
        <input type="checkbox" data-continuity-key="continuityAutoAdjustEnabled" ${continuity?.continuityAutoAdjustEnabled === false ? '' : 'checked'}>
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Move priority</span>
        <input type="text" data-continuity-key="continuityMovePriority" value="${_esc(continuity?.continuityMovePriority || 'PIPE, FLANGE, VALVE, BEND, TEE')}" style="width:100%;background:#182334;color:#e6edf5;border:1px solid #31455f;border-radius:6px;padding:6px 8px;">
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Prefer upstream component</span>
        <input type="checkbox" data-continuity-key="preferUpstreamComponent" ${continuity?.preferUpstreamComponent === false ? '' : 'checked'}>
      </div>
    </div>
  `;
}

function _bindContinuitySettings(container) {
  const controls = Array.from(container.querySelectorAll('[data-continuity-key]'));
  if (!controls.length) return;
  controls.forEach((control) => {
    const update = () => {
      const continuity = { ...(state.rvmPcfExtract.continuity || {}) };
      for (const input of controls) {
        const key = input.getAttribute('data-continuity-key');
        if (!key) continue;
        if (input.type === 'checkbox') {
          continuity[key] = !!input.checked;
        } else if (input.type === 'number') {
          continuity[key] = Number.isFinite(Number(input.value)) ? Number(input.value) : 0;
        } else {
          continuity[key] = String(input.value ?? '');
        }
      }
      updateRvmPcfExtractState({ continuity }, 'continuity-settings');
    };
    control.addEventListener(control.type === 'checkbox' ? 'change' : 'input', update);
  });
}

function _exportSettingsHtml(singlePcfForMultiLineSelection) {
  return `
    <div class="rvm-pcf-extract-status-card" style="margin-top:12px;">
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Single PCF for multi-line selection</span>
        <input type="checkbox" data-export-key="singlePcfForMultiLineSelection" ${singlePcfForMultiLineSelection === false ? '' : 'checked'}>
      </div>
      <div class="rvm-pcf-extract-status" style="margin-top:6px;">
        When selected scope spans multiple lines, collapse rows into one PCF so Tee/Olet continuity stays in one file.
      </div>
    </div>
  `;
}

function _bindExportSettings(container) {
  const control = container.querySelector('[data-export-key="singlePcfForMultiLineSelection"]');
  if (!control) return;
  control.addEventListener('change', () => {
    updateRvmPcfExtractState({
      singlePcfForMultiLineSelection: !!control.checked,
    }, 'export-settings');
  });
}

function _uniquePipelineRefs(rows) {
  const refs = [];
  const seen = new Set();
  for (const row of rows || []) {
    const ref = String(row?.pipelineRef ?? '').trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function _collapseRowsToSinglePcf(rows) {
  const refs = _uniquePipelineRefs(rows);
  if (refs.length <= 1) {
    return {
      rows,
      collapsed: false,
      pipelineRef: refs[0] || 'RVM-EXTRACT',
      sourcePipelineRefs: refs,
    };
  }

  const pipelineRef = refs[0] || 'RVM-EXTRACT';
  return {
    rows: (rows || []).map(row => ({ ...row, pipelineRef })),
    collapsed: true,
    pipelineRef,
    sourcePipelineRefs: refs,
  };
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
    const isSelected = s.scope === 'selected' || ids.length > 0;
    const continuity = s.continuity || {};
    const singlePcfForMultiLineSelection = s.singlePcfForMultiLineSelection;
    host.innerHTML = `
      <div class="rvm-pcf-extract-status-card">
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Model nodes</span><span>${indexNodes}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Scope</span><span>${isSelected ? `selected (${ids.length} nodes)` : 'full model'}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">Last extracted</span><span>${s.lastBuiltAt ? new Date(s.lastBuiltAt).toLocaleString() : 'Never'}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">2D CSV rows</span><span>${(s.rows || []).length}</span></div>
        <div class="rvm-pcf-status-row"><span class="rvm-pcf-label">PCF pipelines</span><span>${Object.keys(s.pcfTextByPipelineRef || {}).length}</span></div>
      </div>
      ${_continuitySettingsHtml(continuity)}
      ${_exportSettingsHtml(singlePcfForMultiLineSelection)}
    `;
    _bindContinuitySettings(host);
    _bindExportSettings(host);
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

function _continuitySummaryHtml() {
  const report = state.rvmPcfExtract?.continuityReport || null;

  if (!report) {
    return `
      <div class="rvm-pcf-extract-status-card">
        <div class="rvm-pcf-status-row">
          <span class="rvm-pcf-label">Continuity</span>
          <span>Not checked</span>
        </div>
      </div>
    `;
  }

  const kv = [
    ['Continuity pass', report.ok ? 'YES' : 'NO'],
    ['Tolerance mm', report.toleranceMm ?? 6],
    ['Auto-fix limit mm', report.pipeGapClashFixToleranceMm ?? 25],
    ['Fatal count', report.fatalCount || 0],
    ['Warning count', report.warningCount || 0],
    ['TEE issues', report.teeIssueCount || 0],
    ['OLET issues', report.oletIssueCount || 0],
    ['Connections', report.connectionCount || 0],
    ['Open pipe terminals', report.terminalCount || 0],
    ['Pipe gap fills', (report.pipeGapFills || []).length],
    ['Pipe clash trims', (report.pipeClashTrims || []).length],
  ];

  return `
    <div class="rvm-pcf-extract-status-card">
      ${kv.map(([k, v]) => `
        <div class="rvm-pcf-status-row">
          <span class="rvm-pcf-label">${_esc(k)}</span>
          <span>${_esc(v)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function _masterResolutionSummaryHtml() {
  const requests = state.rvmPcfExtract?.pendingMasterResolutionRequests || [];

  if (!requests.length) {
    return `
      <div class="rvm-pcf-extract-status-card">
        <div class="rvm-pcf-status-row">
          <span class="rvm-pcf-label">Master resolution</span>
          <span>Complete</span>
        </div>
      </div>
    `;
  }

  const byKind = requests.reduce((acc, req) => {
    acc[req.kind] = (acc[req.kind] || 0) + 1;
    return acc;
  }, {});

  return `
    <div class="rvm-pcf-extract-status-card">
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Master resolution pending</span>
        <span>${requests.length}</span>
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Piping class</span>
        <span>${byKind.PIPING_CLASS || 0}</span>
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Line list</span>
        <span>${byKind.LINELIST || 0}</span>
      </div>
      <div class="rvm-pcf-status-row">
        <span class="rvm-pcf-label">Weight</span>
        <span>${byKind.WEIGHT || 0}</span>
      </div>
    </div>
  `;
}

function _pcfReadinessSummaryHtml() {
  const result = state.rvmPcfExtract?.readinessGate || null;

  if (!result) {
    return `
      <div class="rvm-pcf-extract-status-card">
        <div class="rvm-pcf-status-row">
          <span class="rvm-pcf-label">PCF readiness</span>
          <span>Not checked</span>
        </div>
      </div>
    `;
  }

  const s = result.summary || {};

  const rows = [
    ['PCF Ready', s.pcfReady ? 'YES' : 'NO'],
    ['Ready rows', s.readyRows || 0],
    ['Blocked rows', s.blockedRows || 0],
    ['Warning rows', s.warningRows || 0],
    ['Topology components', s.topoComponentCount || 0],
    ['Ports', s.topoPortCount || 0],
    ['Pipe segments', s.pipeSegmentCount || 0],
    ['Exact connections', s.exactEndpointConnectionCount || 0],
    ['OLET segment taps', s.oletSegmentTapCount || 0],
    ['Gap candidates', s.gapCandidateCount || 0],
    ['Overlap candidates', s.overlapCandidateCount || 0],
    ['Safe fix plans', s.safeFixPlanCount || 0],
    ['Blocked fix plans', s.blockedFixPlanCount || 0],
    ['TEE issues', s.teeIssueCount || 0],
    ['OLET issues', s.oletIssueCount || 0],
    ['Unresolved required ports', s.unresolvedRequiredPortCount || 0],
    ['Fix tolerance mm', s.fixToleranceMm ?? 25],
  ];

  return `
    <div class="rvm-pcf-extract-status-card">
      ${rows.map(([k, v]) => `
        <div class="rvm-pcf-status-row">
          <span class="rvm-pcf-label">${_esc(k)}</span>
          <span>${_esc(v)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

  if (panelId === 'diagnostics') {
    const diags = state.rvmPcfExtract?.diagnostics || [];
    const audit = state.rvmPcfExtract?.pcfAuditReport || null;
    const sevClass = s => s === 'ERROR' ? 'diag-error' : s === 'WARNING' ? 'diag-warn' : 'diag-info';
    host.innerHTML = `
      ${_auditSummaryHtml(audit)}
      ${_continuitySummaryHtml()}
      ${_pcfReadinessSummaryHtml()}
      ${_masterResolutionSummaryHtml()}
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
    const [
      { RvmFinal2dCsvBuilder },
      { RvmExtractHardening },
      {
        RvmMasterResolutionWorkflow,
        showRvmMasterResolutionDialog
      }
    ] = await Promise.all([
      import('../rvm-pcf-extract/RvmFinal2dCsvBuilder.js'),
      import('../rvm-pcf-extract/RvmExtractHardening.js'),
      import('../rvm-pcf-extract/RvmMasterResolutionWorkflow.js')
    ]);

    const selectedCanonicalIds = state.rvmPcfExtract.selectedCanonicalIds || [];
    const masters = state.rvmPcfExtract.masters || {};

    const builder = new RvmFinal2dCsvBuilder(indexJson, {
      selectedCanonicalIds,
      masters
    });

    const { rows, diagnostics: buildDiags } = builder.build();

    const hardening = new RvmExtractHardening();
    hardening.sortRows(rows);

    const resolver = new RvmMasterResolutionWorkflow({
      masters,
      options: {
        pipingClassRegex: localStorage.getItem('rvm_pcf_piping_class_regex') || undefined,
        pipingClassRegexGroup: Number(localStorage.getItem('rvm_pcf_piping_class_regex_group') || 1)
      }
    });

    const resolution = resolver.processRows(rows);

    const allDiagnostics = [
      ...(state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'master-resolution'),
      ...(buildDiags || []),
      ...(resolution.diagnostics || []).map(d => ({
        ...d,
        _source: 'master-resolution'
      })),
      ...(resolution.requests || []).map(req => ({
        severity: req.reason === 'NO_MATCH' || req.reason === 'NO_MASTER' ? 'WARNING' : 'WARNING',
        code: `MASTER-${req.kind}-${req.reason}`,
        message: `${req.kind} requires user resolution: ${req.reason}`,
        rowNo: req.rowNo,
        type: req.componentType,
        pipelineRef: req.pipelineRef,
        requestId: req.id,
        _source: 'master-resolution'
      }))
    ];

    updateRvmPcfExtractState({
      rows,
      diagnostics: allDiagnostics,
      pendingMasterResolutionRequests: resolution.requests || [],
      lastBuiltAt: new Date().toISOString()
    }, 'rebuild-csv');

    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
      action: 'REBUILD_CSV'
    });

    if (resolution.requests?.length) {
      _setStatus(
        container,
        `Built ${rows.length} row(s). ${resolution.requests.length} master resolution request(s) need review.`,
        true
      );

      showRvmMasterResolutionDialog({
        requests: resolution.requests,
        rows,
        resolver,
        onApplied: result => {
          const current = state.rvmPcfExtract || {};
          const existingDiagnostics = current.diagnostics || [];

          updateRvmPcfExtractState({
            rows,
            diagnostics: [
              ...existingDiagnostics,
              ...(result.diagnostics || []).map(d => ({
                ...d,
                _source: 'master-resolution'
              }))
            ],
            pendingMasterResolutionRequests: []
          }, 'master-resolution-applied');

          emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
            action: 'MASTER_RESOLUTION_APPLIED'
          });

          _setStatus(container, `Master resolution applied to ${result.applied || 0} row(s).`);
          _showPanel(container, 'table');
        }
      });
    } else {
      _setStatus(container, `Built ${rows.length} row(s). Master resolution complete.`);
    }

    return true;
  } catch (err) {
    _setStatus(container, `Build failed: ${err.message}`, true);
    return false;
  }
}

function _getPipeFixToleranceMm(container) {
  const input = container.querySelector('[data-pipe-fix-tolerance-mm]');
  const raw = Number(input?.value ?? 25);

  if (!Number.isFinite(raw)) return 25;

  return Math.max(0, Math.min(100, raw));
}

function _getTopoFixToleranceMm(container) {
  const input = container.querySelector('[data-topo-fix-tolerance-mm]');
  const raw = Number(input?.value ?? 25);

  if (!Number.isFinite(raw)) return 25;

  return Math.max(0, Math.min(100, raw));
}

async function _runPcfReadinessGate(container) {
  const rows = state.rvmPcfExtract?.rows || [];

  if (!rows.length) {
    _setStatus(container, 'No rows to check — rebuild CSV first.', true);
    _showPanel(container, 'diagnostics');
    return false;
  }

  try {
    const { runPcfReadinessGate } = await import('../rvm-pcf-extract/RvmPcfReadinessGate.js');

    const result = runPcfReadinessGate(rows, {
      connectToleranceMm: 6,
      fixToleranceMm: _getTopoFixToleranceMm(container),
    });

    const existing = (state.rvmPcfExtract.diagnostics || []).filter(
      d => d._source !== 'pcf-readiness-gate'
    );

    updateRvmPcfExtractState({
      readinessGate: result,
      diagnostics: [
        ...existing,
        ...(result.diagnostics || []).map(d => ({
          ...d,
          _source: 'pcf-readiness-gate',
        })),
      ],
    }, 'pcf-readiness-gate');

    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
      action: 'PCF_READINESS_GATE',
    });

    _setStatus(
      container,
      result.pass
        ? 'PCF readiness passed.'
        : `PCF readiness failed: ${result.summary.blockedRows} blocked row(s), ${result.summary.safeFixPlanCount} safe fix plan(s).`,
      !result.pass
    );

    _showPanel(container, 'diagnostics');
    return result.pass;
  } catch (err) {
    _setStatus(container, `PCF readiness check failed: ${err.message}`, true);
    return false;
  }
}

async function _dryRunGapOverlapFix(container) {
  const rows = state.rvmPcfExtract?.rows || [];

  if (!rows.length) {
    _setStatus(container, 'No rows to check — rebuild CSV first.', true);
    return false;
  }

  const { runPcfReadinessGate } = await import('../rvm-pcf-extract/RvmPcfReadinessGate.js');

  const result = runPcfReadinessGate(rows, {
    connectToleranceMm: 6,
    fixToleranceMm: _getTopoFixToleranceMm(container),
  });

  updateRvmPcfExtractState({
    readinessGate: result,
  }, 'dry-run-gap-overlap');

  _setStatus(
    container,
    `Dry run complete: ${result.summary.safeFixPlanCount} safe fix plan(s), ${result.summary.blockedFixPlanCount} blocked plan(s).`,
    result.summary.blockedFixPlanCount > 0
  );

  _showPanel(container, 'diagnostics');
  return true;
}

async function _applySafeGapOverlapFix(container) {
  const rows = state.rvmPcfExtract?.rows || [];
  const readiness = state.rvmPcfExtract?.readinessGate;

  if (!rows.length || !readiness?.graph || !readiness?.fixPlan) {
    _setStatus(container, 'Run readiness/dry-run before applying fixes.', true);
    return false;
  }

  const { applySafeGapOverlapFixTransaction } = await import('../rvm-pcf-topology/RvmPcfGapOverlapResolver.js');

  const result = applySafeGapOverlapFixTransaction(
    rows,
    readiness.graph,
    readiness.fixPlan,
    {
      connectToleranceMm: 6,
      fixToleranceMm: _getTopoFixToleranceMm(container),
    }
  );

  const diagnostics = [
    ...(state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'pcf-topology-transaction'),
    {
      severity: result.transactionReport.committed ? 'INFO' : 'ERROR',
      code: result.transactionReport.committed ? 'TOPO-FIX-TRANSACTION-COMMITTED' : 'TOPO-FIX-TRANSACTION-REJECTED',
      message: result.transactionReport.committed
        ? `Applied ${result.transactionReport.appliedFixCount} pipe-only topology fix(es).`
        : `Topology fix rejected: ${result.transactionReport.rejectReasons.join(', ')}`,
      _source: 'pcf-topology-transaction',
      report: result.transactionReport,
    },
  ];

  updateRvmPcfExtractState({
    rows: result.rows,
    diagnostics,
    topologyTransactionReport: result.transactionReport,
    pcfTextByPipelineRef: {},
  }, 'apply-safe-gap-overlap-fix');

  emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
    action: 'APPLY_SAFE_GAP_OVERLAP_FIX',
  });

  _setStatus(
    container,
    result.transactionReport.committed
      ? `Applied ${result.transactionReport.appliedFixCount} safe pipe-only fix(es).`
      : `Safe fix rejected: ${result.transactionReport.rejectReasons.join(', ')}`,
    !result.transactionReport.committed
  );

  _showPanel(container, 'diagnostics');
  return result.transactionReport.committed;
}

async function _runContinuityAudit(container) {
  const rows = state.rvmPcfExtract?.rows || [];

  if (!rows.length) {
    _setStatus(container, 'No rows to check — rebuild CSV first.', true);
    _showPanel(container, 'diagnostics');
    return false;
  }

  try {
    const { RvmPcfContinuityChecker } = await import('../rvm-pcf-extract/RvmPcfContinuityChecker.js');

    const checker = new RvmPcfContinuityChecker();

    const report = checker.analyzeComponents(rows, {
      continuityMismatchToleranceMm: 6,
      pipeGapClashFixToleranceMm: _getPipeFixToleranceMm(container),
    });

    const existing = (state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'continuity');

    const diagnostics = [
      ...existing,
      ...(report.issues || []).map(issue => ({
        severity: issue.severity || 'WARNING',
        code: issue.code || 'CONTINUITY-ISSUE',
        message: issue.message || `${issue.type || 'Component'} continuity issue`,
        rowNo: issue.rowNo ?? null,
        type: issue.type ?? null,
        pipelineRef: issue.pipelineRef ?? null,
        sourceCanonicalId: issue.componentId ?? null,
        _source: 'continuity',
        issue,
      })),
      {
        severity: report.ok ? 'INFO' : 'ERROR',
        code: report.ok ? 'CONTINUITY-PASS' : 'CONTINUITY-FAIL',
        message:
          `Continuity: ${report.fatalCount || 0} fatal, ${report.warningCount || 0} warning, ` +
          `${report.teeIssueCount || 0} tee issue, ${report.oletIssueCount || 0} olet issue.`,
        _source: 'continuity',
      },
    ];

    updateRvmPcfExtractState({
      diagnostics,
      continuityReport: report,
    }, 'continuity-audit');

    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
      action: 'CONTINUITY_AUDIT',
    });

    _setStatus(
      container,
      report.ok
        ? 'Continuity check passed.'
        : `Continuity check failed: ${report.fatalCount || 0} fatal issue(s).`,
      !report.ok
    );

    _showPanel(container, 'diagnostics');

    return report.ok;
  } catch (err) {
    _setStatus(container, `Continuity check failed: ${err.message}`, true);
    return false;
  }
}

async function _runAutoFix25(container) {
  const rows = state.rvmPcfExtract?.rows || [];

  if (!rows.length) {
    _setStatus(container, 'No rows to fix — rebuild CSV first.', true);
    _showPanel(container, 'diagnostics');
    return false;
  }

  const toleranceMm = _getPipeFixToleranceMm(container);

  try {
    const { RvmPcfContinuityChecker } = await import('../rvm-pcf-extract/RvmPcfContinuityChecker.js');

    const checker = new RvmPcfContinuityChecker();

    const result = checker.applyPipeOnlyGapClashFixComponents(rows, {
      continuityMismatchToleranceMm: 6,
      pipeGapClashFixToleranceMm: toleranceMm,
      fillGapsEnabled: true,
      trimClashesEnabled: true,
    });

    const report = result.report || {};
    const fixedRows = result.components || rows;

    const existing = (state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'continuity-autofix');

    const autoFixDiagnostics = [
      ...existing,
      ...(report.pipeGapFills || []).map(fix => ({
        severity: 'INFO',
        code: 'PIPE-GAP-FILLED',
        message:
          `Pipe endpoint ${fix.componentId}.${fix.pointKey} moved ${fix.movementMm}mm to fill gap.`,
        pipelineRef: fix.pipelineRef,
        sourceCanonicalId: fix.componentId,
        _source: 'continuity-autofix',
        fix,
      })),
      ...(report.pipeClashTrims || []).map(fix => ({
        severity: 'INFO',
        code: 'PIPE-CLASH-TRIMMED',
        message:
          `Pipe endpoint ${fix.componentId}.${fix.pointKey} trimmed ${fix.movementMm}mm to ${fix.fittingType}.`,
        pipelineRef: fix.pipelineRef,
        sourceCanonicalId: fix.componentId,
        _source: 'continuity-autofix',
        fix,
      })),
      ...(report.issues || []).map(issue => ({
        severity: issue.severity || 'WARNING',
        code: issue.code || 'CONTINUITY-ISSUE-AFTER-FIX',
        message: issue.message || `${issue.type || 'Component'} continuity issue after auto fix.`,
        pipelineRef: issue.pipelineRef,
        sourceCanonicalId: issue.componentId,
        _source: 'continuity-autofix',
        issue,
      })),
      {
        severity: report.ok ? 'INFO' : 'WARNING',
        code: report.ok ? 'AUTO-FIX-25-PASS' : 'AUTO-FIX-25-PARTIAL',
        message:
          `Auto Fix ${toleranceMm}mm complete: ` +
          `${(report.pipeGapFills || []).length} gap fill(s), ` +
          `${(report.pipeClashTrims || []).length} pipe trim(s), ` +
          `${report.fatalCount || 0} fatal remaining.`,
        _source: 'continuity-autofix',
      },
    ];

    updateRvmPcfExtractState({
      rows: fixedRows,
      diagnostics: autoFixDiagnostics,
      continuityReport: report,
      pcfTextByPipelineRef: {},
    }, 'auto-fix-25mm');

    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, {
      action: 'AUTO_FIX_25MM',
    });

    _setStatus(
      container,
      `Auto Fix ${toleranceMm}mm: ${(report.pipeGapFills || []).length} gap(s) filled, ${(report.pipeClashTrims || []).length} clash(es) trimmed.`,
      !report.ok
    );

    _showPanel(container, 'diagnostics');

    return report.ok;
  } catch (err) {
    _setStatus(container, `Auto Fix ${toleranceMm}mm failed: ${err.message}`, true);
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
    const [{ RvmExtractHardening }, { RvmPcfContinuityChecker }] = await Promise.all([
      import('../rvm-pcf-extract/RvmExtractHardening.js'),
      import('../rvm-pcf-extract/RvmPcfContinuityChecker.js'),
    ]);
    const hardening = new RvmExtractHardening();
    const report = hardening.buildPcfAuditReport(rows, byRef, state.rvm?.sourceName || 'RVM JSON PCF Extract');
    const continuityChecker = new RvmPcfContinuityChecker();
    const continuitySettings = state.rvmPcfExtract.continuity || {};
    const singlePcfForMultiLineSelection = state.rvmPcfExtract.singlePcfForMultiLineSelection !== false;
    const continuityRows = singlePcfForMultiLineSelection
      ? _collapseRowsToSinglePcf(rows).rows
      : rows;
    const continuityReport = continuityChecker.analyzeComponents(continuityRows, continuitySettings);
    const existing = (state.rvmPcfExtract.diagnostics || []).filter(d => d._source !== 'pcf-audit');
    updateRvmPcfExtractState({
      pcfAuditReport: report,
      continuityReport,
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
    const { RvmPcfContinuityChecker } = await import('../rvm-pcf-extract/RvmPcfContinuityChecker.js');
    const { RvmPcfEmitter } = await import('../rvm-pcf-extract/RvmPcfEmitter.js');
    const continuityChecker = new RvmPcfContinuityChecker();
    const continuitySettings = state.rvmPcfExtract.continuity || {};
    const singlePcfForMultiLineSelection = state.rvmPcfExtract.singlePcfForMultiLineSelection !== false;
    const collapseResult = singlePcfForMultiLineSelection
      ? _collapseRowsToSinglePcf(rows)
      : { rows, collapsed: false, pipelineRef: null, sourcePipelineRefs: _uniquePipelineRefs(rows) };
    rows = collapseResult.rows;
    const continuityAutoAdjustEnabled =
      continuitySettings.continuityAutoAdjustEnabled ??
      continuitySettings.autoAdjustEnabled;
    const continuityResult = continuityAutoAdjustEnabled !== false
      ? continuityChecker.applyAutoBalanceComponents(rows, continuitySettings)
      : {
          components: rows,
          report: continuityChecker.analyzeComponents(rows, continuitySettings),
        };
    rows = continuityResult.components || rows;
    const continuityReport = continuityResult.report || null;
    const emitter = new RvmPcfEmitter({ allowPartialPcf: true });
    const { pcfTextByPipelineRef, errors, warnings } = emitter.emit(rows);
    const continuityDiag = continuityReport
      ? [{
          severity: continuityReport.ok ? 'INFO' : 'WARNING',
          _source: 'pcf-continuity',
          code: 'PCF-CONTINUITY',
          message: `Continuity ${continuityReport.ok ? 'OK' : 'issues found'}: ${continuityReport.fixableCount || 0} fixable, ${continuityReport.fatalCount || 0} fatal, max deviation ${continuityReport.maxDeviationMm || 0} mm.`,
          report: continuityReport,
        }]
      : [];
    const collapseDiag = collapseResult.collapsed
      ? [{
          severity: 'INFO',
          _source: 'pcf-collapse',
          code: 'PCF-SINGLE-PCF-MULTI-LINE',
          message: `Collapsed ${collapseResult.sourcePipelineRefs.length} selected pipeline refs into one PCF to preserve cross-line continuity.`,
          sourcePipelineRefs: collapseResult.sourcePipelineRefs,
          pipelineRef: collapseResult.pipelineRef,
        }]
      : [];
    updateRvmPcfExtractState({
      rows,
      continuityReport,
      pcfTextByPipelineRef,
      diagnostics: [
        ...(state.rvmPcfExtract.diagnostics || []),
        ...continuityDiag,
        ...collapseDiag,
        ...errors.map(e => ({ severity: 'ERROR', _source: 'pcf-emit', ...e })),
        ...warnings.map(w => ({ severity: 'WARNING', _source: 'pcf-emit', ...w })),
      ],
    }, 'generate-pcf');
    emit(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, { action: 'GENERATE_PCF' });
    const pipelineCount = Object.keys(pcfTextByPipelineRef).length;
    _setStatus(container, `Generated PCF for ${pipelineCount} pipeline(s).${continuityReport ? ` Continuity: ${continuityReport.fixableCount || 0} fixable, ${continuityReport.fatalCount || 0} fatal.` : ''}`);
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
    <button data-action="CHECK_CONTINUITY">Check Continuity</button>
    <button data-action="RUN_PCF_READINESS">Run Readiness Check</button>

    <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#9aa9bd;">
      Auto Fix mm
      <input
        data-pipe-fix-tolerance-mm
        type="number"
        min="0"
        max="100"
        step="1"
        value="25"
        style="width:58px;background:#0f172a;color:#dbeafe;border:1px solid #334155;border-radius:4px;padding:3px 5px;"
      >
    </label>
    <button data-action="AUTO_FIX_25MM">Auto Fix 25mm</button>

    <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#9aa9bd;">
      Gap/Overlap Fix mm
      <input
        data-topo-fix-tolerance-mm
        type="number"
        min="0"
        max="100"
        step="1"
        value="25"
        style="width:58px;background:#0f172a;color:#dbeafe;border:1px solid #334155;border-radius:4px;padding:3px 5px;"
      >
    </label>
    <button data-action="DRY_RUN_GAP_OVERLAP">Dry Run Gap/Overlap</button>
    <button data-action="APPLY_SAFE_GAP_OVERLAP">Apply Safe Gap/Overlap Fix</button>

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
          case 'CHECK_CONTINUITY': await _runContinuityAudit(container); break;
          case 'AUTO_FIX_25MM': await _runAutoFix25(container); break;
          case 'RUN_PCF_READINESS': await _runPcfReadinessGate(container); break;
          case 'DRY_RUN_GAP_OVERLAP': await _dryRunReadinessGapOverlap(container); break;
          case 'APPLY_SAFE_GAP_OVERLAP': await _applySafeReadinessGapOverlapFix(container); break;
          case 'GENERATE_PCF': await _runGeneratePcf(container); break;
          case 'DOWNLOAD_CSV': await _runDownloadCsv(container); break;
          case 'DOWNLOAD_PCF': await _runDownloadPcf(container); break;
        }
      } finally { btn.disabled = false; }
    });
  });
  _updateHeader(container); _showPanel(container, 'scope');
  _offExtractRequested = on(RuntimeEvents.RVM_EXTRACT_PCF_REQUESTED, async (payload = {}) => {
    const selectedCanonicalIds = Array.isArray(payload.selectedCanonicalIds)
      ? [...payload.selectedCanonicalIds]
      : (state.rvmPcfExtract.selectedCanonicalIds || []);
    const scope = payload.scope === 'selected' || selectedCanonicalIds.length > 0 ? 'selected' : 'full';

    updateRvmPcfExtractState({
      scope,
      selectedCanonicalIds,
    }, 'extract-requested');

    _updateHeader(container);
    await _runRebuildCsv(container);
    _showPanel(container, 'table');
  });
  _offStateChanged = on(RuntimeEvents.RVM_PCF_EXTRACT_STATE_CHANGED, () => { _updateHeader(container); });
}

export function dispose() {
  if (_offExtractRequested) { _offExtractRequested(); _offExtractRequested = null; }
  if (_offStateChanged)     { _offStateChanged();     _offStateChanged     = null; }
}

export default mount;
