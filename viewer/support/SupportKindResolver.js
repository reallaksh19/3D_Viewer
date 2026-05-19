/**
 * Pure, stateless support-kind resolver.
 * No browser APIs. No localStorage. No framework imports.
 * See docs/support-kind-resolution.md for the full consumer inventory.
 */

export const SUPPORT_KINDS = ['REST', 'GUIDE', 'LINESTOP', 'LIMIT', 'ANCHOR', 'SPRING'];
export const MATCH_TYPES   = ['startsWith', 'equals', 'contains', 'regex'];

// Default SKEY → kind lookup. Injected as kindMap by callers that need it.
// CA250 is a stiffer rest variant — same render kind as CA150.
export const DEFAULT_KIND_MAP = {
  CA150: 'REST',
  CA250: 'REST',
  CA100: 'GUIDE',
};

// Ordered by precedence. CA codes checked first (SKEY field), then
// CMPSUPTYPE/MDSSUPPTYPE prefix rules. GT5 REST rules must precede generic GT GUIDE.
export const DEFAULT_RULES = [
  { id: 'builtin-ca150',     field: 'SKEY',                            pattern: 'CA150',     match: 'equals',     kind: 'REST',     label: 'SKEY CA150 -> REST' },
  { id: 'builtin-ca250',     field: 'SKEY',                            pattern: 'CA250',     match: 'equals',     kind: 'REST',     label: 'SKEY CA250 -> REST' },
  { id: 'builtin-ca100',     field: 'SKEY',                            pattern: 'CA100',     match: 'equals',     kind: 'GUIDE',    label: 'SKEY CA100 -> GUIDE' },
  { id: 'builtin-gt5-cmp',   field: 'CMPSUPTYPE',                      pattern: 'GT5',       match: 'startsWith', kind: 'REST',     label: 'CMPSUPTYPE GT5* -> REST' },
  { id: 'builtin-gt5-mds',   field: 'MDSSUPPTYPE',                     pattern: 'GT5',       match: 'startsWith', kind: 'REST',     label: 'MDSSUPPTYPE GT5* -> REST' },
  { id: 'builtin-gt5-text',  field: 'SPRE,SKEY,NAME,DESCRIPTION,DESC', pattern: 'GT5',       match: 'contains',   kind: 'REST',     label: 'Text contains GT5 -> REST' },
  { id: 'builtin-pg',        field: 'CMPSUPTYPE',                      pattern: 'PG-',       match: 'startsWith', kind: 'GUIDE',    label: 'PG-* -> GUIDE' },
  { id: 'builtin-ls',        field: 'CMPSUPTYPE',                      pattern: 'LS-',       match: 'startsWith', kind: 'LINESTOP', label: 'LS-* -> LINESTOP' },
  { id: 'builtin-wp',        field: 'CMPSUPTYPE',                      pattern: 'WP-',       match: 'startsWith', kind: 'LINESTOP', label: 'WP-* -> LINESTOP' },
  { id: 'builtin-bp',        field: 'CMPSUPTYPE',                      pattern: 'BP-',       match: 'startsWith', kind: 'REST',     label: 'BP-* -> REST' },
  { id: 'builtin-g',         field: 'CMPSUPTYPE',                      pattern: 'G-',        match: 'startsWith', kind: 'GUIDE',    label: 'G-* -> GUIDE' },
  { id: 'builtin-rest',      field: 'CMPSUPTYPE',                      pattern: 'REST',      match: 'equals',     kind: 'REST',     label: 'REST -> REST' },
  { id: 'builtin-gt',        field: 'MDSSUPPTYPE',                     pattern: 'GT',        match: 'startsWith', kind: 'GUIDE',    label: 'GT* -> GUIDE' },
  { id: 'builtin-bt',        field: 'MDSSUPPTYPE',                     pattern: 'BT',        match: 'startsWith', kind: 'REST',     label: 'BT* -> REST' },
  { id: 'builtin-an',        field: 'MDSSUPPTYPE',                     pattern: 'AN',        match: 'startsWith', kind: 'ANCHOR',   label: 'AN* -> ANCHOR' },
  { id: 'builtin-pipe-rest', field: 'MDSSUPPTYPE',                     pattern: 'PIPE-REST', match: 'equals',     kind: 'REST',     label: 'PIPE-REST -> REST' },
];

// ── Text heuristic ────────────────────────────────────────────────────────────
// Merges keyword patterns from supportKindFromRestraint (xml-support-builder.js)
// and normalizeSupportKind (RvmSupportSymbols.js). Order matters: specific
// patterns before generic (ANCHOR before REST, LINESTOP/STOPPER before STOP).
export function resolveKindFromText(rawText) {
  const t = String(rawText || '').toUpperCase();
  if (/\bANC(HOR)?\b|\bFIX(ED)?\b|\bRIGID\b/.test(t))          return 'ANCHOR';
  if (/\bGUIDE\b|\bGDE\b|\bGUI\b|\bSLIDE\b|\bSLID\b/.test(t))  return 'GUIDE';
  if (/\bSPRING\b|\bHANGER\b/.test(t))                           return 'SPRING';
  if (/\bLINE\s*STOP\b|\bLINESTOP\b|\bSTOPPER\b/.test(t))       return 'LINESTOP';
  if (/\bLIMIT\s*STOP\b|\bLIMIT\b/.test(t))                      return 'LIMIT';
  if (/\bREST(ING)?\b|\bRST\b|\bSHOE\b|\bBASE\s*PLATE\b|\bBP\b|\+Y\b/.test(t)) return 'REST';
  if (/\bSTOP\b/.test(t))                                         return 'LINESTOP';
  return '';
}

// ── Rule-matching primitives ──────────────────────────────────────────────────
// Exported so RvmSupportMapper.js can re-export them for backwards compatibility
// with existing tests and UI code that imports them from the mapper.

export function splitRuleTerms(value) {
  return String(value || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean);
}

export function normalizeMapperFieldName(fieldName) {
  const trimmed = String(fieldName || '').trim();
  if (trimmed === '*') return '*';
  return trimmed.replace(/^<+|>+$/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const _NESTED_KEYS = new Set([
  'ATTRIBUTES', 'RAWATTRIBUTES', 'SOURCEATTRIBUTES', 'USERDATA', 'PROPERTIES', 'PROPS',
]);

function _collectEntries(input, seen = new Set(), depth = 0) {
  if (!input || typeof input !== 'object' || seen.has(input) || depth > 4) return [];
  seen.add(input);
  const out = [];
  for (const [key, value] of Object.entries(input)) {
    if (value == null) continue;
    const nk = normalizeMapperFieldName(key);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (_NESTED_KEYS.has(nk)) out.push(..._collectEntries(value, seen, depth + 1));
      continue;
    }
    out.push({ key, normalizedKey: nk, value });
  }
  return out;
}

export function collectMapperFieldValues(attrs, rule) {
  const entries = _collectEntries(attrs);
  const fields  = splitRuleTerms(rule?.field);
  const all     = !fields.length || fields.some(f => {
    const n = normalizeMapperFieldName(f);
    return n === '*' || n === 'ANY';
  });
  if (all) return entries.map(e => e.value).filter(v => String(v).trim());
  const wanted = new Set(fields.map(normalizeMapperFieldName));
  return entries.filter(e => wanted.has(e.normalizedKey)).map(e => e.value).filter(v => String(v).trim());
}

function _matchValue(rule, value) {
  const match    = MATCH_TYPES.includes(rule?.match) ? rule.match : 'contains';
  const raw      = String(value ?? '');
  const upper    = raw.toUpperCase();
  const patterns = match === 'regex'
    ? [String(rule?.pattern || '').trim()]
    : splitRuleTerms(rule?.pattern);
  return patterns.some(p => {
    if (!p) return false;
    const up = p.toUpperCase();
    switch (match) {
      case 'startsWith': return upper.startsWith(up);
      case 'equals':     return upper === up;
      case 'contains':   return upper.includes(up);
      case 'regex':      try { return new RegExp(p, 'i').test(raw); } catch { return false; }
      default:           return false;
    }
  });
}

function _normalizeKind(kind) {
  const k = String(kind || '').trim().toUpperCase().replace(/\s+/g, '');
  return SUPPORT_KINDS.includes(k) ? k : '';
}

function _runRules(attrs, rules) {
  for (const rule of (rules || [])) {
    const kind = _normalizeKind(rule.kind);
    if (!kind) continue;
    if (collectMapperFieldValues(attrs, rule).some(v => _matchValue(rule, v))) return kind;
  }
  return '';
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Resolve a support kind from an attribute bag.
 * All config is injected — no side effects, no globals.
 *
 * Precedence (highest → lowest):
 *   1. Explicit SUPPORT_KIND / SUPPORT-KIND attribute
 *   2. userRules   — caller-injected overrides (e.g. RvmSupportMapper user rules)
 *   3. kindMap     — SKEY shorthand map (e.g. Config Tab entries)
 *   4. defaultRules — shipped DEFAULT_RULES
 *   5. Text heuristic over all attribute values
 *   6. defaultKind
 *
 * @param {object} attrs
 * @param {object} [options]
 * @param {Array}  [options.userRules=[]]              - User-defined rules, run first
 * @param {Array}  [options.defaultRules=DEFAULT_RULES] - Shipped built-in rules
 * @param {object} [options.kindMap=DEFAULT_KIND_MAP]   - SKEY → kind fallback map
 * @param {string} [options.defaultKind='']             - Returned when nothing matches
 * @returns {string}
 */
export function resolveKindPure(attrs, {
  userRules    = [],
  defaultRules = DEFAULT_RULES,
  kindMap      = DEFAULT_KIND_MAP,
  defaultKind  = '',
} = {}) {
  if (!attrs || typeof attrs !== 'object') return defaultKind;

  // 1. Explicit attribute
  const explicit = _normalizeKind(
    attrs['SUPPORT-KIND'] || attrs['SUPPORT_KIND'] || attrs['SUPPORT_MAPPER_KIND'] || ''
  );
  if (explicit) return explicit;

  // 2. User rules
  const fromUser = _runRules(attrs, userRules);
  if (fromUser) return fromUser;

  // 3. kindMap SKEY lookup
  const skey = String(attrs['SKEY'] || attrs['SUPPORT-SKEY'] || '').toUpperCase().trim();
  if (skey && kindMap[skey]) {
    const mapped = _normalizeKind(kindMap[skey]);
    if (mapped) return mapped;
  }

  // 4. Default rules
  const fromDefault = _runRules(attrs, defaultRules);
  if (fromDefault) return fromDefault;

  // 5. Text heuristic — scans all attribute values as a single string
  const text     = _collectEntries(attrs).map(e => String(e.value)).join(' ');
  const fromText = resolveKindFromText(text);
  if (fromText) return fromText;

  return defaultKind;
}
