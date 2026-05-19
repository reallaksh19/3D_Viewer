// Support mapper: maps ATT/RVM attribute fields to standard support kinds.
// Inputs are plain attribute bags; output is REST/GUIDE/LINESTOP/LIMIT/ANCHOR or an empty string.
// Rules are saved in localStorage and are applied during conversion and support symbol rendering.

const STORAGE_KEY = 'pcf-rvm-support-mapper-rules';
const BUILTIN_OVERRIDES_STORAGE_KEY = 'pcf-rvm-support-mapper-builtin-overrides';

const SUPPORT_KINDS = ['REST', 'GUIDE', 'LINESTOP', 'LIMIT', 'ANCHOR'];
const MATCH_TYPES = ['startsWith', 'equals', 'contains', 'regex'];
const FIELD_SUGGESTIONS = [
  'CMPSUPTYPE',
  'MDSSUPPTYPE',
  'SPRE',
  'SKEY',
  'SUPPORT_TYPE',
  'SUPPORT_KIND',
  'TYPE',
  'DTXR',
  'NAME',
  'DESCRIPTION',
  '*',
];

// Ordered by precedence. GT5 REST rules must run before the generic GT GUIDE rule.
const BUILTIN_RULES = [
  { id: 'builtin-gt5-cmp', field: 'CMPSUPTYPE', pattern: 'GT5', match: 'startsWith', kind: 'REST', label: 'CMPSUPTYPE GT5* -> REST' },
  { id: 'builtin-gt5-mds', field: 'MDSSUPPTYPE', pattern: 'GT5', match: 'startsWith', kind: 'REST', label: 'MDSSUPPTYPE GT5* -> REST' },
  { id: 'builtin-gt5-text', field: 'SPRE,SKEY,NAME,DESCRIPTION,DESC', pattern: 'GT5', match: 'contains', kind: 'REST', label: 'Text contains GT5 -> REST' },
  { id: 'builtin-pg', field: 'CMPSUPTYPE', pattern: 'PG-', match: 'startsWith', kind: 'GUIDE', label: 'PG-* -> GUIDE' },
  { id: 'builtin-ls', field: 'CMPSUPTYPE', pattern: 'LS-', match: 'startsWith', kind: 'LINESTOP', label: 'LS-* -> LINESTOP' },
  { id: 'builtin-wp', field: 'CMPSUPTYPE', pattern: 'WP-', match: 'startsWith', kind: 'LINESTOP', label: 'WP-* -> LINESTOP' },
  { id: 'builtin-bp', field: 'CMPSUPTYPE', pattern: 'BP-', match: 'startsWith', kind: 'REST', label: 'BP-* -> REST' },
  { id: 'builtin-g', field: 'CMPSUPTYPE', pattern: 'G-', match: 'startsWith', kind: 'GUIDE', label: 'G-* -> GUIDE' },
  { id: 'builtin-rest', field: 'CMPSUPTYPE', pattern: 'REST', match: 'equals', kind: 'REST', label: 'REST -> REST' },
  { id: 'builtin-gt', field: 'MDSSUPPTYPE', pattern: 'GT', match: 'startsWith', kind: 'GUIDE', label: 'GT* -> GUIDE' },
  { id: 'builtin-bt', field: 'MDSSUPPTYPE', pattern: 'BT', match: 'startsWith', kind: 'REST', label: 'BT* -> REST' },
  { id: 'builtin-an', field: 'MDSSUPPTYPE', pattern: 'AN', match: 'startsWith', kind: 'ANCHOR', label: 'AN* -> ANCHOR' },
  { id: 'builtin-pipe-rest', field: 'MDSSUPPTYPE', pattern: 'PIPE-REST', match: 'equals', kind: 'REST', label: 'PIPE-REST -> REST' },
];

const NESTED_ATTRIBUTE_KEYS = new Set([
  'ATTRIBUTES',
  'RAWATTRIBUTES',
  'SOURCEATTRIBUTES',
  'USERDATA',
  'PROPERTIES',
  'PROPS',
]);

let _userRules = null;
let _builtinRuleOverrides = null;

function notifySupportRulesChanged() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('rvm-support-mapper-rules-changed'));
}

function loadUserRules() {
  if (_userRules) return _userRules;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _userRules = raw ? JSON.parse(raw).filter(rule => rule && typeof rule === 'object') : [];
  } catch {
    _userRules = [];
  }
  return _userRules;
}

function loadBuiltinRuleOverrides() {
  if (_builtinRuleOverrides) return _builtinRuleOverrides;
  try {
    const raw = localStorage.getItem(BUILTIN_OVERRIDES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    _builtinRuleOverrides = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    _builtinRuleOverrides = {};
  }
  return _builtinRuleOverrides;
}

function saveBuiltinRuleOverrides(overrides) {
  _builtinRuleOverrides = overrides;
  try {
    localStorage.setItem(BUILTIN_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage can be unavailable in embedded or private browser contexts.
  }
  notifySupportRulesChanged();
}

function saveUserRules(rules) {
  _userRules = rules;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // localStorage can be unavailable in embedded or private browser contexts.
  }
  notifySupportRulesChanged();
}

export function getBuiltinRules() {
  const overrides = loadBuiltinRuleOverrides();
  return BUILTIN_RULES.map(rule => _normalizeRuleForUse({ ...rule, ...(overrides[rule.id] || {}) }));
}

export function getAllRules() {
  return [...getBuiltinRules(), ...loadUserRules()];
}

export function getUserRules() {
  return [...loadUserRules()];
}

export function addUserRule(rule) {
  const normalizedRule = _normalizeRuleForStorage(rule);
  const rules = loadUserRules();
  const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  rules.push({ ...normalizedRule, id });
  saveUserRules(rules);
  return id;
}

export function removeUserRule(id) {
  const rules = loadUserRules().filter(rule => rule.id !== id);
  saveUserRules(rules);
}

export function updateUserRule(id, patch) {
  const rules = loadUserRules().map(rule => {
    if (rule.id !== id) return rule;
    return _normalizeRuleForStorage({ ...rule, ...patch, id: rule.id });
  });
  saveUserRules(rules);
}

export function updateBuiltinRule(id, patch) {
  const baseRule = BUILTIN_RULES.find(rule => rule.id === id);
  if (!baseRule) throw new Error(`Unknown built-in support mapper rule: ${id}`);

  const nextRule = _normalizeRuleForStorage({ ...baseRule, ...patch, id });
  const overrides = { ...loadBuiltinRuleOverrides() };
  overrides[id] = {
    field: nextRule.field,
    match: nextRule.match,
    pattern: nextRule.pattern,
    kind: nextRule.kind,
    label: nextRule.label,
  };
  saveBuiltinRuleOverrides(overrides);
}

export function resetBuiltinRule(id) {
  const overrides = { ...loadBuiltinRuleOverrides() };
  delete overrides[id];
  saveBuiltinRuleOverrides(overrides);
}

export function resetBuiltinRules() {
  saveBuiltinRuleOverrides({});
}

export function splitRuleTerms(value) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map(term => term.trim())
    .filter(Boolean);
}

export function normalizeMapperFieldName(fieldName) {
  const trimmed = String(fieldName || '').trim();
  if (trimmed === '*') return '*';
  return trimmed
    .replace(/^<+|>+$/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function collectMapperFieldValues(attrs, rule) {
  const entries = _collectAttributeEntries(attrs);
  const fields = splitRuleTerms(rule?.field);
  const scansAllFields = !fields.length || fields.some(field => {
    const normalizedField = normalizeMapperFieldName(field);
    return normalizedField === '*' || normalizedField === 'ANY';
  });

  if (scansAllFields) {
    return entries.map(entry => entry.value).filter(value => String(value).trim());
  }

  const requestedFields = new Set(fields.map(normalizeMapperFieldName));
  return entries
    .filter(entry => requestedFields.has(entry.normalizedKey))
    .map(entry => entry.value)
    .filter(value => String(value).trim());
}

/**
 * Resolve a mapped support kind from an ATT/RVM attribute bag.
 * User rules run first and can target comma-separated fields and keywords.
 * Built-in rules then cover common CMPSUPTYPE/MDSSUPPTYPE/SPRE conventions.
 */
export function resolveKindFromAttrs(attrs) {
  const rules = [...loadUserRules(), ...getBuiltinRules()];
  for (const rule of rules) {
    const kind = _normalizeSupportKind(rule.kind);
    if (!kind) continue;

    const values = collectMapperFieldValues(attrs, rule);
    if (values.some(value => _matchRuleAgainstValue(rule, value))) return kind;
  }
  return '';
}

export { SUPPORT_KINDS, MATCH_TYPES };

// -- Support Mapper UI -------------------------------------------------------

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
      Map ATT/RVM fields to support kinds during ATT/RVM conversion and 3D support symbol rendering.
      Fields and keywords accept comma-separated values; use * to scan all attributes.
    </div>
    <div style="font-weight:500; color:#aaa; margin-bottom:4px;">Built-in Rules</div>
    <div id="sm-builtin-list" style="margin-bottom:12px;"></div>
    <div style="font-weight:500; color:#aaa; margin-bottom:4px;">User Rules</div>
    <div id="sm-user-list" style="margin-bottom:8px;"></div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
      <input id="sm-field" list="sm-field-options" value="CMPSUPTYPE, MDSSUPPTYPE, SPRE" placeholder="Fields (e.g. CMPSUPTYPE, SPRE, *)" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px; width:230px;" />
      <datalist id="sm-field-options">
        ${FIELD_SUGGESTIONS.map(field => `<option value="${_escapeHtml(field)}"></option>`).join('')}
      </datalist>
      <select id="sm-match" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px;">
        <option value="startsWith">starts with</option>
        <option value="equals">equals</option>
        <option value="contains">contains</option>
        <option value="regex">regex</option>
      </select>
      <input id="sm-pattern" placeholder="Keywords (e.g. GT5, REST)" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px; width:170px;" />
      <select id="sm-kind" style="background:#2a2d35; color:#ccc; border:1px solid #444; padding:4px 6px; border-radius:4px;">
        ${SUPPORT_KINDS.map(kind => `<option>${kind}</option>`).join('')}
      </select>
      <button id="sm-add-btn" style="background:#1a5fb4; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;">Add Rule</button>
    </div>
    <div style="color:#666; font-size:10px;">Rules are saved in browser localStorage and applied during ATT/RVM conversion plus support symbol rendering.</div>
  `;

  _renderBuiltinList(wrap.querySelector('#sm-builtin-list'));
  _renderUserList(wrap.querySelector('#sm-user-list'));

  wrap.querySelector('#sm-add-btn').addEventListener('click', () => {
    const field = wrap.querySelector('#sm-field').value.trim();
    const match = wrap.querySelector('#sm-match').value;
    const pattern = wrap.querySelector('#sm-pattern').value.trim();
    const kind = wrap.querySelector('#sm-kind').value;
    if (!pattern) return;

    addUserRule({ field, match, pattern, kind });
    _renderUserList(wrap.querySelector('#sm-user-list'));
    wrap.querySelector('#sm-pattern').value = '';
  });

  return wrap;
}

function _normalizeRuleForStorage(rule) {
  const field = String(rule?.field || '*').trim();
  const match = MATCH_TYPES.includes(rule?.match) ? rule.match : 'contains';
  const pattern = String(rule?.pattern || '').trim();
  const kind = _normalizeSupportKind(rule?.kind);
  if (!pattern) throw new Error('Support mapper rule requires a keyword or pattern.');
  if (!kind) throw new Error(`Support mapper rule kind must be one of: ${SUPPORT_KINDS.join(', ')}.`);

  return {
    ...rule,
    field,
    match,
    pattern,
    kind,
    label: `${field} ${match} "${pattern}" -> ${kind}`,
  };
}

function _normalizeRuleForUse(rule) {
  try {
    return _normalizeRuleForStorage(rule);
  } catch {
    return { ...rule, field: String(rule?.field || '*'), match: 'contains', pattern: String(rule?.pattern || ''), kind: 'REST' };
  }
}

function _normalizeSupportKind(kind) {
  const normalizedKind = String(kind || '').trim().toUpperCase().replace(/\s+/g, '');
  return SUPPORT_KINDS.includes(normalizedKind) ? normalizedKind : '';
}

function _collectAttributeEntries(input, seen = new Set(), depth = 0) {
  if (!input || typeof input !== 'object' || seen.has(input) || depth > 4) return [];
  seen.add(input);

  const entries = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;

    const normalizedKey = normalizeMapperFieldName(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (NESTED_ATTRIBUTE_KEYS.has(normalizedKey)) {
        entries.push(..._collectAttributeEntries(value, seen, depth + 1));
      }
      continue;
    }

    entries.push({ key, normalizedKey, value });
  }
  return entries;
}

function _matchRuleAgainstValue(rule, value) {
  const match = MATCH_TYPES.includes(rule?.match) ? rule.match : 'contains';
  const rawValue = String(value ?? '');
  const normalizedValue = rawValue.toUpperCase();
  const patterns = match === 'regex' ? [String(rule?.pattern || '').trim()] : splitRuleTerms(rule?.pattern);

  return patterns.some(pattern => {
    if (!pattern) return false;
    const normalizedPattern = pattern.toUpperCase();
    switch (match) {
      case 'startsWith': return normalizedValue.startsWith(normalizedPattern);
      case 'equals': return normalizedValue === normalizedPattern;
      case 'contains': return normalizedValue.includes(normalizedPattern);
      case 'regex':
        try {
          return new RegExp(pattern, 'i').test(rawValue);
        } catch {
          return false;
        }
      default:
        return false;
    }
  });
}

function _kindBadge(kind) {
  const color = kind === 'GUIDE' ? '#30c48d' : kind === 'LIMIT' ? '#ffb020' : kind === 'LINESTOP' ? '#ff6b35' : kind === 'ANCHOR' ? '#d94cff' : '#2f80ed';
  return `<span style="display:inline-block; background:${color}22; color:${color}; border:1px solid ${color}55; border-radius:3px; padding:1px 5px; font-size:10px; font-weight:600;">${_escapeHtml(kind)}</span>`;
}

function _renderBuiltinList(el) {
  el.innerHTML = getBuiltinRules().map(rule => _ruleRowHtml(rule, 'builtin')).join('');
  _bindEditableRuleRows(el);
}

function _renderUserList(el) {
  const rules = getUserRules();
  if (!rules.length) {
    el.innerHTML = '<div style="color:#555; font-size:11px; padding:4px 0;">No user rules yet.</div>';
    return;
  }

  el.innerHTML = rules.map(rule => _ruleRowHtml(rule, 'user')).join('');
  _bindEditableRuleRows(el);
}

function _bindEditableRuleRows(el) {
  el.querySelectorAll('[data-rule-id]').forEach(row => {
    const id = row.dataset.ruleId;
    const source = row.dataset.ruleSource;
    const persistRow = () => {
      const patch = {
        field: row.querySelector('[data-rule-field]')?.value || '*',
        match: row.querySelector('[data-rule-match]')?.value || 'contains',
        pattern: row.querySelector('[data-rule-pattern]')?.value || '',
        kind: row.querySelector('[data-rule-kind]')?.value || 'REST',
      };
      if (source === 'builtin') updateBuiltinRule(id, patch);
      if (source === 'user') updateUserRule(id, patch);
    };

    row.querySelectorAll('[data-rule-field], [data-rule-pattern]').forEach(input => {
      input.addEventListener('change', persistRow);
    });
    row.querySelectorAll('[data-rule-match], [data-rule-kind]').forEach(input => {
      input.addEventListener('change', persistRow);
    });
  });

  el.querySelectorAll('[data-reset-builtin]').forEach(btn => {
    btn.addEventListener('click', () => {
      resetBuiltinRule(btn.dataset.resetBuiltin);
      _renderBuiltinList(el);
    });
  });

  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeUserRule(btn.dataset.del);
      _renderUserList(el);
    });
  });
}

function _ruleRowHtml(rule, source) {
  const isBuiltin = source === 'builtin';
  const actionButton = isBuiltin
    ? `<button data-reset-builtin="${_escapeHtml(rule.id)}" style="background:none; border:1px solid #3a4a5f; color:#9fb7d8; cursor:pointer; font-size:10px; padding:2px 5px; border-radius:3px;" title="Reset this default rule">Reset</button>`
    : `<button data-del="${_escapeHtml(rule.id)}" style="background:none; border:none; color:#e55; cursor:pointer; font-size:13px; padding:0 4px;" title="Remove">x</button>`;

  return `
    <div style="display:grid; grid-template-columns:minmax(112px,1.25fr) 88px minmax(74px,1fr) 86px 44px; align-items:center; gap:5px; padding:3px 0; border-bottom:1px solid #2a2d35;" data-rule-id="${_escapeHtml(rule.id)}" data-rule-source="${_escapeHtml(source)}">
      <input data-rule-field list="sm-field-options" value="${_escapeHtml(rule.field)}" title="Field(s), comma-separated" style="${_ruleInputStyle('field')}" />
      <select data-rule-match title="Match type" style="${_ruleInputStyle('select')}">
        ${MATCH_TYPES.map(match => `<option value="${match}" ${match === rule.match ? 'selected' : ''}>${_escapeHtml(match)}</option>`).join('')}
      </select>
      <input data-rule-pattern value="${_escapeHtml(rule.pattern)}" title="Keyword(s), comma-separated" style="${_ruleInputStyle('pattern')}" />
      <select data-rule-kind title="Support type" style="${_ruleInputStyle('kind')}">
        ${SUPPORT_KINDS.map(kind => `<option value="${kind}" ${kind === rule.kind ? 'selected' : ''}>${_escapeHtml(kind)}</option>`).join('')}
      </select>
      ${actionButton}
    </div>`;
}

function _ruleInputStyle(kind) {
  const base = 'box-sizing:border-box; width:100%; min-width:0; background:#101927; color:#cfe2ff; border:1px solid #26384f; border-radius:3px; padding:2px 4px; font-size:10px;';
  if (kind === 'kind') return `${base} font-weight:700;`;
  return base;
}

function _escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
