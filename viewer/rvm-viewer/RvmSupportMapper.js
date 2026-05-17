// Support mapper: maps ATT file fields (CMPSUPTYPE, MDSSUPPTYPE, etc.) to standard support kinds.
// Rules are stored in localStorage and applied during rendering.

const STORAGE_KEY = 'pcf-rvm-support-mapper-rules';

// Built-in rules derived from known CMPSUPTYPE/MDSSUPPTYPE code conventions.
const BUILTIN_RULES = [
  // CMPSUPTYPE patterns
  { id: 'builtin-pg', field: 'CMPSUPTYPE', pattern: 'PG-', match: 'startsWith', kind: 'GUIDE', label: 'PG-* → GUIDE' },
  { id: 'builtin-ls', field: 'CMPSUPTYPE', pattern: 'LS-', match: 'startsWith', kind: 'LINESTOP', label: 'LS-* → LINESTOP' },
  { id: 'builtin-wp', field: 'CMPSUPTYPE', pattern: 'WP-', match: 'startsWith', kind: 'LINESTOP', label: 'WP-* → LINESTOP' },
  { id: 'builtin-bp', field: 'CMPSUPTYPE', pattern: 'BP-', match: 'startsWith', kind: 'REST', label: 'BP-* → REST' },
  { id: 'builtin-g', field: 'CMPSUPTYPE', pattern: 'G-', match: 'startsWith', kind: 'GUIDE', label: 'G-* → GUIDE' },
  { id: 'builtin-rest', field: 'CMPSUPTYPE', pattern: 'REST', match: 'equals', kind: 'REST', label: 'REST → REST' },
  // MDSSUPPTYPE patterns
  { id: 'builtin-gt', field: 'MDSSUPPTYPE', pattern: 'GT', match: 'startsWith', kind: 'GUIDE', label: 'GT* → GUIDE' },
  { id: 'builtin-bt', field: 'MDSSUPPTYPE', pattern: 'BT', match: 'startsWith', kind: 'REST', label: 'BT* → REST' },
  { id: 'builtin-an', field: 'MDSSUPPTYPE', pattern: 'AN', match: 'startsWith', kind: 'ANCHOR', label: 'AN* → ANCHOR' },
  { id: 'builtin-pipe-rest', field: 'MDSSUPPTYPE', pattern: 'PIPE-REST', match: 'equals', kind: 'REST', label: 'PIPE-REST → REST' },
];

const SUPPORT_KINDS = ['REST', 'GUIDE', 'LINESTOP', 'LIMIT', 'ANCHOR'];
const MATCH_TYPES = ['startsWith', 'equals', 'contains', 'regex'];

let _userRules = null;

function loadUserRules() {
  if (_userRules) return _userRules;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _userRules = raw ? JSON.parse(raw) : [];
  } catch {
    _userRules = [];
  }
  return _userRules;
}

function saveUserRules(rules) {
  _userRules = rules;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch {}
}

export function getAllRules() {
  return [...BUILTIN_RULES, ...loadUserRules()];
}

export function getUserRules() {
  return [...loadUserRules()];
}

export function addUserRule(rule) {
  const rules = loadUserRules();
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  rules.push({ ...rule, id });
  saveUserRules(rules);
  return id;
}

export function removeUserRule(id) {
  const rules = loadUserRules().filter(r => r.id !== id);
  saveUserRules(rules);
}

export function updateUserRule(id, patch) {
  const rules = loadUserRules().map(r => r.id === id ? { ...r, ...patch } : r);
  saveUserRules(rules);
}

function matchRule(rule, value) {
  const v = String(value).toUpperCase();
  const p = String(rule.pattern).toUpperCase();
  switch (rule.match) {
    case 'startsWith': return v.startsWith(p);
    case 'equals': return v === p;
    case 'contains': return v.includes(p);
    case 'regex': try { return new RegExp(rule.pattern, 'i').test(value); } catch { return false; }
    default: return false;
  }
}

/**
 * Resolve the support kind for an attribute bag (plain object with CMPSUPTYPE, MDSSUPPTYPE, etc.)
 * Returns one of REST/GUIDE/LINESTOP/LIMIT/ANCHOR or '' if no rule matches.
 * User rules take priority over built-in rules.
 */
export function resolveKindFromAttrs(attrs) {
  const userRules = loadUserRules();
  // Check user rules first
  for (const rule of userRules) {
    const val = attrs[rule.field] || attrs[rule.field?.toUpperCase()] || '';
    if (val && matchRule(rule, val)) return rule.kind;
  }
  // Check built-in rules
  for (const rule of BUILTIN_RULES) {
    const val = attrs[rule.field] || attrs[rule.field?.toUpperCase()] || '';
    if (val && matchRule(rule, val)) return rule.kind;
  }
  return '';
}

export { SUPPORT_KINDS, MATCH_TYPES };

// ── Support Mapper UI ──────────────────────────────────────────────────────

export function renderSupportMapperPanel(container) {
  container.innerHTML = '';
  container.appendChild(_buildPanel());
}

function _buildPanel() {
  const wrap = document.createElement('div');
  wrap.className = 'support-mapper-panel';
  wrap.style.cssText = 'font-size:12px; color:#ccc; padding:8px;';

  wrap.innerHTML = `
    <div style="font-weight:600; font-size:13px; margin-bottom:8px; color:#7ab3ff;">Support Type Mapper</div>
    <div style="color:#888; margin-bottom:10px; font-size:11px;">
      Map ATT file fields (CMPSUPTYPE, MDSSUPPTYPE) to support kinds used for 3D symbol rendering.
    </div>
    <div style="font-weight:500; color:#aaa; margin-bottom:4px;">Built-in Rules</div>
    <div id="sm-builtin-list" style="margin-bottom:12px;"></div>
    <div style="font-weight:500; color:#aaa; margin-bottom:4px;">User Rules</div>
    <div id="sm-user-list" style="margin-bottom:8px;"></div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
      <select id="sm-field" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px;">
        <option>CMPSUPTYPE</option>
        <option>MDSSUPPTYPE</option>
        <option>TYPE</option>
        <option>SUPPORT_TYPE</option>
        <option>DTXR</option>
      </select>
      <select id="sm-match" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px;">
        <option value="startsWith">starts with</option>
        <option value="equals">equals</option>
        <option value="contains">contains</option>
        <option value="regex">regex</option>
      </select>
      <input id="sm-pattern" placeholder="Pattern (e.g. GT5)" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px; width:120px;" />
      <select id="sm-kind" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px;">
        ${SUPPORT_KINDS.map(k => `<option>${k}</option>`).join('')}
      </select>
      <button id="sm-add-btn" style="background:#1a5fb4; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;">Add Rule</button>
    </div>
    <div style="color:#666; font-size:10px;">Rules are saved in browser localStorage and applied during support symbol rendering.</div>
  `;

  _renderBuiltinList(wrap.querySelector('#sm-builtin-list'));
  _renderUserList(wrap.querySelector('#sm-user-list'));

  wrap.querySelector('#sm-add-btn').addEventListener('click', () => {
    const field = wrap.querySelector('#sm-field').value.trim();
    const match = wrap.querySelector('#sm-match').value;
    const pattern = wrap.querySelector('#sm-pattern').value.trim();
    const kind = wrap.querySelector('#sm-kind').value;
    if (!pattern) return;
    addUserRule({ field, match, pattern, kind, label: `${field} ${match} "${pattern}" → ${kind}` });
    _renderUserList(wrap.querySelector('#sm-user-list'));
    wrap.querySelector('#sm-pattern').value = '';
  });

  return wrap;
}

function _kindBadge(kind) {
  const color = kind === 'GUIDE' ? '#30c48d' : kind === 'LIMIT' ? '#ffb020' : kind === 'LINESTOP' ? '#ff6b35' : kind === 'ANCHOR' ? '#d94cff' : '#2f80ed';
  return `<span style="display:inline-block; background:${color}22; color:${color}; border:1px solid ${color}55; border-radius:3px; padding:1px 5px; font-size:10px; font-weight:600;">${kind}</span>`;
}

function _renderBuiltinList(el) {
  el.innerHTML = BUILTIN_RULES.map(r =>
    `<div style="display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid #2a2d35;">
      <span style="color:#666; font-size:10px; min-width:90px;">${r.field}</span>
      <span style="color:#aaa; font-size:10px; min-width:70px;">${r.match}</span>
      <span style="color:#ddd; font-size:11px; flex:1;">${r.pattern}</span>
      ${_kindBadge(r.kind)}
    </div>`
  ).join('');
}

function _renderUserList(el) {
  const rules = getUserRules();
  if (!rules.length) {
    el.innerHTML = '<div style="color:#555; font-size:11px; padding:4px 0;">No user rules yet.</div>';
    return;
  }
  el.innerHTML = rules.map(r =>
    `<div style="display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid #2a2d35;" data-rule-id="${r.id}">
      <span style="color:#8ab; font-size:10px; min-width:90px;">${r.field}</span>
      <span style="color:#aaa; font-size:10px; min-width:70px;">${r.match}</span>
      <span style="color:#ddd; font-size:11px; flex:1;">${r.pattern}</span>
      ${_kindBadge(r.kind)}
      <button data-del="${r.id}" style="background:none; border:none; color:#e55; cursor:pointer; font-size:13px; padding:0 4px;" title="Remove">✕</button>
    </div>`
  ).join('');
  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeUserRule(btn.dataset.del);
      _renderUserList(el);
    });
  });
}
