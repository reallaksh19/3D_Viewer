import { state, updateRvmPcfExtractState } from '../core/state.js';
import {
  CONVERTED_BORE_COL,
  ensureConvertedBoreRows,
  guessBoreSourceColumn
} from '../pcf-legacy/services/bore-converter.js';

const MASTER_DEFS = {
  linelist: {
    title: 'Line List',
    description: 'Import line list and map Pipeline Ref / Line No / Class / Rating / Material fields.',
    stateKey: 'linelist',
    fieldMapKey: 'linelistFieldMap',
    defaultMap: {
      lineNo: ['LINE_NO', 'LINE NO', 'Line Number', 'Line No', 'Pipeline Ref', 'PIPELINE_REF'],
      pipingClass: ['PIPING_CLASS', 'Piping Class', 'Class', 'Spec', 'SPEC'],
      rating: ['RATING', 'Rating', 'Pressure Class'],
      material: ['MATERIAL', 'Material', 'Material_Name'],
      schedule: ['SCHEDULE', 'Schedule', 'SCH'],
      wallThickness: ['WALL_THICKNESS', 'Wall Thickness', 'WT'],
      corrosionAllowance: ['CORROSION_ALLOWANCE', 'Corrosion Allowance', 'CA'],
      convertedBore: [CONVERTED_BORE_COL, 'DN', 'NB', 'Bore', 'Size', 'NPS']
    },
    required: ['lineNo'],
    convertBoreType: 'linelist'
  },

  weights: {
    title: 'Weights / Valve CA8',
    description: 'Import valve weight master. Legacy CA8 lookup key is Bore + Rating + Length.',
    stateKey: 'weight',
    fieldMapKey: 'weightFieldMap',
    defaultMap: {
      bore: [CONVERTED_BORE_COL, 'Size (NPS)', 'Size', 'NPS', 'DN', 'NB', 'Bore'],
      rating: ['Rating', 'RATING', 'Class', 'CLASS', 'Pressure Class'],
      length: ['Length (RF-F/F)', 'RF-F/F', 'Length', 'LEN', 'Face To Face', 'faceToFace'],
      valveType: ['Type Description', 'Valve Type', 'Type', 'Description'],
      weight: ['RF/RTJ KG', 'Valve Weight', 'Weight', 'weight', 'valveWeight']
    },
    required: ['bore', 'rating', 'length', 'weight'],
    convertBoreType: 'weights'
  },

  pipingClass: {
    title: 'Piping Class',
    description: 'Import piping class master and map class / bore / component / rating / schedule fields.',
    stateKey: 'pipingClass',
    fieldMapKey: 'pipingClassFieldMap',
    defaultMap: {
      pipingClass: ['Piping Class', 'PIPING_CLASS', 'Class', 'SPEC', 'Spec'],
      convertedBore: [CONVERTED_BORE_COL, 'Size', 'DN', 'NB', 'Bore', 'NPS'],
      componentType: ['Component Type', 'COMPONENT_TYPE', 'Type', 'Item Type'],
      rating: ['Rating', 'RATING', 'Pressure Class'],
      material: ['Material_Name', 'Material', 'MATERIAL'],
      schedule: ['Schedule', 'SCHEDULE', 'SCH'],
      wallThickness: ['Wall Thickness', 'WALL_THICKNESS', 'WT'],
      corrosionAllowance: ['Corrosion Allowance', 'CORROSION_ALLOWANCE', 'CA'],
      endCondition: ['End Condition', 'END_CONDITION', 'End Type'],
      facing: ['Facing', 'FACING', 'Face']
    },
    required: ['pipingClass', 'convertedBore'],
    convertBoreType: 'pipingclass'
  },

  materialMap: {
    title: 'PCF Material Map',
    description: 'Import material mapping table used by downstream PCF / material name enrichment.',
    stateKey: 'materialMap',
    fieldMapKey: 'materialMapFieldMap',
    defaultMap: {
      code: ['Code', 'Material Code', 'MATERIAL_CODE'],
      material: ['Material', 'Material_Name', 'Description'],
      spec: ['Spec', 'Specification']
    },
    required: [],
    convertBoreType: null
  },

  supportMapping: {
    title: 'Support Mapping',
    description: 'Map friction/gap/support kind to SUPPORT_NAME and SUPPORT_GUID behavior.',
    stateKey: 'supportMapping',
    fieldMapKey: 'supportFieldMap',
    defaultMap: {
      supportKind: ['supportKind', 'Kind', 'Support Kind'],
      friction: ['friction', 'Friction'],
      gap: ['gap', 'Gap'],
      name: ['name', 'Support Name', 'SUPPORT_NAME'],
      desc: ['desc', 'description', 'Description']
    },
    required: ['name'],
    convertBoreType: null,
    rowsPath: 'blocks'
  },

  branchGeometry: {
    title: 'TEE/OLET BRLEN',
    description: 'Import branch geometry table for TEE/OLET BRLEN lookup.',
    stateKey: 'branchGeometry',
    fieldMapKey: 'branchGeometryFieldMap',
    defaultMap: {
      type: ['Type', 'Component Type'],
      headerBore: ['Header Bore', 'Header DN', 'headerBore'],
      branchBore: ['Branch Bore', 'Branch DN', 'branchBore'],
      brlen: ['BRLEN', 'brlen', 'M', 'A', 'Value']
    },
    required: ['headerBore', 'branchBore', 'brlen'],
    convertBoreType: null
  }
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function normalizeHeader(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function detectDelimiter(line) {
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = String(line || '').split(d).length;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

function parseDelimited(text) {
  const lines = String(text || '')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '');

  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);

  const parseLine = (line) => {
    const out = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const next = line[i + 1];
      if (ch === '"' && inQuotes && next === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === delimiter && !inQuotes) { out.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    out.push(current.trim());
    return out;
  };

  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = parseLine(line);
    const row = { _rowIndex: index + 1 };
    headers.forEach((h, i) => { row[h || `COL_${i + 1}`] = cells[i] ?? ''; });
    return row;
  });
}

async function getXlsxModule() {
  if (window.XLSX) return window.XLSX;

  try {
    return await import('xlsx');
  } catch {
    // Bare import may fail in static mode if no import map exists.
  }

  try {
    return await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  } catch (err) {
    throw new Error(
      'XLSX parser is not available. Add an import map for "xlsx" or allow CDN import from jsDelivr.'
    );
  }
}

function workbookToSheetRows(XLSX, workbook) {
  const out = {};
  for (const sheetName of workbook.SheetNames || []) {
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    out[sheetName] = rows.map((row, index) => ({ _rowIndex: index + 1, ...row }));
  }
  return out;
}

async function readWorkbookFile(file) {
  const XLSX = await getXlsxModule();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  const sheets = workbookToSheetRows(XLSX, workbook);
  const sheetNames = Object.keys(sheets);

  if (!sheetNames.length) throw new Error('Workbook contains no readable sheets.');

  return {
    type: 'workbook',
    sheetNames,
    sheets,
    selectedSheet: sheetNames[0],
    rows: sheets[sheetNames[0]] || []
  };
}

function isWorkbookFile(file) {
  return /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(file.name || '');
}

async function readMasterFile(file) {
  if (isWorkbookFile(file)) {
    return readWorkbookFile(file);
  }

  const text = await file.text();

  if (/\.json$/i.test(file.name)) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.rows)) return parsed.rows;
    if (parsed.masters && typeof parsed.masters === 'object') return parsed.masters;
    throw new Error('JSON must be an array, { rows }, or { masters }.');
  }

  return parseDelimited(text);
}

function headersFromRows(rows) {
  return Array.from(new Set((rows || []).flatMap(row => Object.keys(row || {}))));
}

function autoMapFields(headers, def) {
  const map = {};
  const normalized = new Map(headers.map(h => [normalizeHeader(h), h]));

  for (const [field, aliases] of Object.entries(def.defaultMap || {})) {
    let hit = '';
    for (const alias of aliases) {
      const exact = normalized.get(normalizeHeader(alias));
      if (exact) { hit = exact; break; }
      const loose = headers.find(h => normalizeHeader(h).includes(normalizeHeader(alias)));
      if (loose) { hit = loose; break; }
    }
    map[field] = hit;
  }
  return map;
}

function getMasterContainer(masterKey) {
  const m = state.rvmPcfExtract?.masters || {};
  const def = MASTER_DEFS[masterKey];
  return m[def.stateKey] || {};
}

function getMasterRows(masterKey) {
  const def = MASTER_DEFS[masterKey];
  const container = getMasterContainer(masterKey);
  if (def.rowsPath === 'blocks') return container.blocks || [];
  return container.rows || [];
}

function setMasterRows(masterKey, rows, fieldMap) {
  const def = MASTER_DEFS[masterKey];
  const masters = state.rvmPcfExtract?.masters || {};
  const current = masters[def.stateKey] || {};

  const nextBlock = {
    ...current,
    [def.fieldMapKey]: fieldMap || current[def.fieldMapKey] || {}
  };

  if (def.rowsPath === 'blocks') {
    nextBlock.blocks = rows;
  } else {
    nextBlock.rows = rows;
  }

  updateRvmPcfExtractState({
    masters: { ...masters, [def.stateKey]: nextBlock }
  }, `master-${masterKey}-set`);
}

function mapRowsWithFieldMap(rawRows, fieldMap) {
  return (rawRows || []).map((row, index) => {
    const mapped = { _sourceRowIndex: row._rowIndex || index + 1, _raw: row };
    for (const [field, sourceHeader] of Object.entries(fieldMap || {})) {
      mapped[field] = sourceHeader ? row[sourceHeader] : '';
    }
    return mapped;
  });
}

function applyConvertedBore(masterKey, rows, def) {
  if (!def.convertBoreType) return rows;
  const headers = headersFromRows(rows);
  const sourceColumn = guessBoreSourceColumn(headers, def.convertBoreType);
  const result = ensureConvertedBoreRows(rows, { type: def.convertBoreType, sourceColumn });
  return result.rows;
}

function rowsToCsv(rows) {
  const headers = headersFromRows(rows);
  return [
    headers.join(','),
    ...(rows || []).map(row => headers.map(h => csvEscape(row[h])).join(','))
  ].join('\r\n');
}

function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function renderRowsTable(rows, maxRows = 200) {
  if (!rows.length) return '<div class="rvm-master-empty">No rows loaded.</div>';

  const headers = headersFromRows(rows).filter(h => h !== '_raw').slice(0, 50);
  return `
    <div class="rvm-master-table-wrap">
      <table class="rvm-master-table">
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>
          ${rows.slice(0, maxRows).map(row =>
            `<tr>${headers.map(h => `<td>${esc(row[h])}</td>`).join('')}</tr>`
          ).join('')}
        </tbody>
      </table>
      ${rows.length > maxRows ? `<div class="rvm-master-note">Showing ${maxRows} of ${rows.length} rows.</div>` : ''}
    </div>
  `;
}

function renderFieldMapping(masterKey, rawRows, fieldMap) {
  const def = MASTER_DEFS[masterKey];
  const headers = headersFromRows(rawRows);
  return `
    <div class="rvm-master-field-map">
      <div class="rvm-master-section-title">Field Selection / Header Mapping</div>
      <div class="rvm-master-field-grid">
        ${Object.keys(def.defaultMap || {}).map(field => `
          <label class="rvm-master-field">
            <span>${esc(field)}${def.required.includes(field) ? '<em>*</em>' : ''}</span>
            <select data-field-map="${esc(field)}">
              <option value="">-- Not mapped --</option>
              ${headers.map(h => `<option value="${esc(h)}" ${fieldMap[field] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
            </select>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

function renderDiagnostics(rows, def, fieldMap) {
  const missing = (def.required || []).filter(f => !fieldMap[f]);
  const issues = [];

  if (!rows.length) issues.push({ severity: 'warning', text: 'No rows loaded.' });
  for (const f of missing) issues.push({ severity: 'error', text: `Required field not mapped: ${f}` });
  if (def.convertBoreType && rows.length && !headersFromRows(rows).includes(CONVERTED_BORE_COL)) {
    issues.push({ severity: 'warning', text: 'Converted Bore column not present yet. Click "Convert Bore".' });
  }
  if (!issues.length) issues.push({ severity: 'info', text: 'Master mapping looks ready.' });

  return `
    <div class="rvm-master-diagnostics">
      ${issues.map(i => `<div class="rvm-master-diag severity-${esc(i.severity)}">${esc(i.text)}</div>`).join('')}
    </div>
  `;
}

function renderMasterTab(masterKey, local) {
  const def = MASTER_DEFS[masterKey];
  const rows = getMasterRows(masterKey);
  const rawRows = local.rawRows || [];
  const fieldMap = local.fieldMap || getMasterContainer(masterKey)[def.fieldMapKey] || {};

  return `
    <div class="rvm-master-card">
      <div class="rvm-master-title-row">
        <div>
          <div class="rvm-master-title">${esc(def.title)}</div>
          <div class="rvm-master-desc">${esc(def.description)}</div>
        </div>
        <div class="rvm-master-count">${rows.length} saved row(s)</div>
      </div>

      <div class="rvm-master-toolbar">
        <label class="rvm-master-btn">
          Import CSV/XLSX/JSON
          <input hidden type="file" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.xlsb,.xls,.ods,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" data-import-master="${esc(masterKey)}">
        </label>
        <button type="button" class="rvm-master-btn" data-auto-map="${esc(masterKey)}" ${rawRows.length ? '' : 'disabled'}>Auto Map Fields</button>
        <button type="button" class="rvm-master-btn" data-save-master="${esc(masterKey)}" ${rawRows.length ? '' : 'disabled'}>Save Mapped Rows</button>
        <button type="button" class="rvm-master-btn" data-convert-bore="${esc(masterKey)}" ${rows.length && def.convertBoreType ? '' : 'disabled'}>Convert Bore</button>
        <button type="button" class="rvm-master-btn" data-export-master="${esc(masterKey)}" ${rows.length ? '' : 'disabled'}>Export JSON</button>
        <button type="button" class="rvm-master-btn" data-export-master-csv="${esc(masterKey)}" ${rows.length ? '' : 'disabled'}>Export CSV</button>
        <button type="button" class="rvm-master-btn danger" data-clear-master="${esc(masterKey)}" ${rows.length ? '' : 'disabled'}>Clear</button>
      </div>

      ${renderDiagnostics(rows, def, fieldMap)}

      ${local.sheetNames?.length > 1 ? `
        <div class="rvm-master-sheet-select">
          <label>
            <span>Workbook Sheet</span>
            <select data-sheet-select="${esc(masterKey)}">
              ${local.sheetNames.map(sheet => `
                <option value="${esc(sheet)}" ${local.selectedSheet === sheet ? 'selected' : ''}>${esc(sheet)}</option>
              `).join('')}
            </select>
          </label>
        </div>
      ` : ''}

      ${rawRows.length ? renderFieldMapping(masterKey, rawRows, fieldMap) : `
        <div class="rvm-master-upload-help">
          Import a CSV/TSV/XLSX/JSON file. After import, use field selection to map project-specific headers into the canonical master fields.
        </div>
      `}

      <div class="rvm-master-split">
        <section>
          <div class="rvm-master-section-title">Imported Preview</div>
          ${renderRowsTable(rawRows, 100)}
        </section>
        <section>
          <div class="rvm-master-section-title">Saved Master Rows</div>
          ${renderRowsTable(rows, 200)}
        </section>
      </div>
    </div>
  `;
}

function renderDiagnosticsTab() {
  const masters = state.rvmPcfExtract?.masters || {};
  const extractRows = state.rvmPcfExtract?.rows || [];

  const lines = [
    { name: 'Line List', rows: masters.linelist?.rows?.length || 0 },
    { name: 'Weights / Valve CA8', rows: masters.weight?.rows?.length || 0 },
    { name: 'Piping Class', rows: masters.pipingClass?.rows?.length || 0 },
    { name: 'Material Map', rows: masters.materialMap?.rows?.length || 0 },
    { name: 'Support Mapping Blocks', rows: masters.supportMapping?.blocks?.length || 0 },
    { name: 'Branch Geometry', rows: masters.branchGeometry?.rows?.length || 0 },
    { name: 'Final 2D CSV', rows: extractRows.length }
  ];

  return `
    <div class="rvm-master-card">
      <div class="rvm-master-title">Master Match Diagnostics</div>
      <div class="rvm-master-desc">Static-safe diagnostics summary for imported masters and Final 2D CSV readiness.</div>
      <div class="rvm-master-toolbar">
        <button type="button" class="rvm-master-btn" data-export-diagnostics>Export Diagnostics JSON</button>
      </div>
      <div class="rvm-master-table-wrap">
        <table class="rvm-master-table">
          <thead><tr><th>Area</th><th>Rows</th><th>Status</th></tr></thead>
          <tbody>
            ${lines.map(line => `
              <tr>
                <td>${esc(line.name)}</td>
                <td>${esc(line.rows)}</td>
                <td>${line.rows ? 'Loaded' : 'Empty'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <pre class="rvm-master-json">${esc(JSON.stringify({
        mastersSummary: lines,
        diagnostics: state.rvmPcfExtract?.diagnostics || []
      }, null, 2))}</pre>
    </div>
  `;
}

export function mountRvmPcfLegacyMasterPanel(container) {
  let active = 'linelist';
  const localByTab = new Map();

  const getLocal = (key) => {
    if (!localByTab.has(key)) localByTab.set(key, { rawRows: [], fieldMap: {} });
    return localByTab.get(key);
  };

  const draw = () => {
    const tabItems = [
      ['linelist', 'Line List'],
      ['weights', 'Weights / Valve CA8'],
      ['pipingClass', 'Piping Class'],
      ['materialMap', 'Material Map'],
      ['supportMapping', 'Support Mapping'],
      ['branchGeometry', 'TEE/OLET BRLEN'],
      ['diagnostics', 'Diagnostics']
    ];

    container.innerHTML = `
      <div class="rvm-legacy-master-root">
        <div class="rvm-legacy-master-tabs">
          ${tabItems.map(([id, label]) => `
            <button type="button" class="rvm-legacy-master-tab ${active === id ? 'is-active' : ''}" data-master-tab="${id}">
              ${esc(label)}
            </button>
          `).join('')}
        </div>
        <div class="rvm-legacy-master-content">
          ${active === 'diagnostics' ? renderDiagnosticsTab() : renderMasterTab(active, getLocal(active))}
        </div>
      </div>
    `;

    bind();
  };

  const bind = () => {
    container.querySelectorAll('[data-master-tab]').forEach(btn => {
      btn.addEventListener('click', () => { active = btn.dataset.masterTab; draw(); });
    });

    container.querySelectorAll('[data-import-master]').forEach(input => {
      input.addEventListener('change', async () => {
        const key = input.dataset.importMaster;
        const file = input.files?.[0];
        if (!file) return;
        try {
          const result = await readMasterFile(file);
          const local = getLocal(key);

          if (result && result.type === 'workbook') {
            local.workbookSheets = result.sheets;
            local.sheetNames = result.sheetNames;
            local.selectedSheet = result.selectedSheet;
            local.rawRows = result.rows;
          } else {
            local.workbookSheets = null;
            local.sheetNames = [];
            local.selectedSheet = '';
            local.rawRows = Array.isArray(result) ? result : [];
          }

          local.fieldMap = autoMapFields(headersFromRows(local.rawRows), MASTER_DEFS[key]);
          draw();
        } catch (err) {
          updateRvmPcfExtractState({
            diagnostics: [
              ...(state.rvmPcfExtract?.diagnostics || []),
              { severity: 'error', code: 'MASTER-IMPORT-FAILED', message: `${file.name}: ${err.message}` }
            ]
          }, 'master-import-failed');
          draw();
        }
      });
    });

    container.querySelectorAll('[data-sheet-select]').forEach(select => {
      select.addEventListener('change', () => {
        const key = select.dataset.sheetSelect;
        const local = getLocal(key);
        local.selectedSheet = select.value;
        local.rawRows = local.workbookSheets?.[select.value] || [];
        local.fieldMap = autoMapFields(headersFromRows(local.rawRows), MASTER_DEFS[key]);
        draw();
      });
    });

    container.querySelectorAll('[data-field-map]').forEach(select => {
      select.addEventListener('change', () => {
        getLocal(active).fieldMap[select.dataset.fieldMap] = select.value;
      });
    });

    container.querySelectorAll('[data-auto-map]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.autoMap;
        const local = getLocal(key);
        local.fieldMap = autoMapFields(headersFromRows(local.rawRows), MASTER_DEFS[key]);
        draw();
      });
    });

    container.querySelectorAll('[data-save-master]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.saveMaster;
        const def = MASTER_DEFS[key];
        const local = getLocal(key);
        const missing = (def.required || []).filter(f => !local.fieldMap[f]);

        if (missing.length) {
          updateRvmPcfExtractState({
            diagnostics: [
              ...(state.rvmPcfExtract?.diagnostics || []),
              { severity: 'error', code: 'MASTER-FIELD-MAPPING-INCOMPLETE', message: `${def.title}: missing required fields ${missing.join(', ')}` }
            ]
          }, 'master-field-mapping-incomplete');
          draw();
          return;
        }

        let mapped = mapRowsWithFieldMap(local.rawRows, local.fieldMap);
        mapped = applyConvertedBore(key, mapped, def);
        setMasterRows(key, mapped, local.fieldMap);
        draw();
      });
    });

    container.querySelectorAll('[data-convert-bore]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.convertBore;
        const def = MASTER_DEFS[key];
        const rows = getMasterRows(key);
        const converted = applyConvertedBore(key, rows, def);
        setMasterRows(key, converted, getMasterContainer(key)[def.fieldMapKey] || {});
        draw();
      });
    });

    container.querySelectorAll('[data-export-master]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.exportMaster;
        downloadFile(`rvm-pcf-${key}-master.json`, JSON.stringify(getMasterRows(key), null, 2), 'application/json;charset=utf-8');
      });
    });

    container.querySelectorAll('[data-export-master-csv]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.exportMasterCsv;
        downloadFile(`rvm-pcf-${key}-master.csv`, rowsToCsv(getMasterRows(key)), 'text/csv;charset=utf-8');
      });
    });

    container.querySelectorAll('[data-clear-master]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.clearMaster;
        setMasterRows(key, [], getMasterContainer(key)[MASTER_DEFS[key].fieldMapKey] || {});
        draw();
      });
    });

    container.querySelector('[data-export-diagnostics]')?.addEventListener('click', () => {
      downloadFile(
        'rvm-pcf-master-diagnostics.json',
        JSON.stringify({ masters: state.rvmPcfExtract?.masters || {}, diagnostics: state.rvmPcfExtract?.diagnostics || [] }, null, 2),
        'application/json;charset=utf-8'
      );
    });
  };

  draw();

  return () => { container.innerHTML = ''; };
}
