# Support Kind Resolution — Consumer Inventory

Tracks every place in the codebase that resolves a support kind (REST / GUIDE / LINESTOP / LIMIT / ANCHOR / SPRING) from raw attributes or text.

## Current Status (post Phase 2)

| Consumer | File | Resolver used | CA150/CA100 handled? | Configurable? | localStorage? |
|---|---|---|---|---|---|
| 3D RVM Viewer symbols | `rvm-viewer/RvmSupportSymbols.js` | `resolveKindFromAttrs` → `RvmSupportMapper` → `resolveKindPure` | **Yes** (builtin-ca150/ca100 rules) | Yes — Mapper UI | Wrapper only |
| Model Converter pass | `tabs/model-converters-tab.js` | `resolveKindFromAttrs` → `RvmSupportMapper` → `resolveKindPure` | **Yes** | Yes — Mapper UI | Wrapper only |
| RVM Tab enrichment | `tabs/viewer3d-rvm-tab.js` | `resolveKindFromAttrs` → `RvmSupportMapper` → `resolveKindPure` | **Yes** | Yes — Mapper UI | Wrapper only |
| 3D PCF Viewer | `js/pcf2glb/glb/buildComponentObject.js` | `getSupportKindMap()` (tier 1.5) + inline heuristic | Partial — Config Tab only | Yes — Config Tab | Yes (browser-only) |
| UXML XML import | `interchange/builders/xml/xml-support-builder.js` | `supportKindFromRestraint()` — **hardcoded** | Yes but hardcoded | **No** | None — pure |
| UXML PCF import | `interchange/builders/pcf/pcf-canonical-builder.js` | Raw SKEY passthrough | Passes "CA150" not "REST" | **No** | None |
| ACCDB converter | `utils/accdb-to-pcf.js` | Inline hardcoded `if` blocks | Yes but hardcoded | **No** | None |
| Legacy PCF mapper | `pcf-legacy/pcf-engine/support-mapper.js` | Friction + gap block matching → CA name | CA150/CA100 are output names | Yes — via `rvmPcfExtract.masters` | None |

## Architecture (post Phase 2)

```
viewer/support/SupportKindResolver.js   ← pure, stateless, zero browser deps
│  resolveKindPure(attrs, { userRules, defaultRules, kindMap, defaultKind })
│  resolveKindFromText(rawText)
│  DEFAULT_RULES, DEFAULT_KIND_MAP
│  splitRuleTerms, normalizeMapperFieldName, collectMapperFieldValues
│
└─► rvm-viewer/RvmSupportMapper.js      ← localStorage wrapper + UI
       resolveKindFromAttrs(attrs)
       Used by: RvmSupportSymbols, model-converters-tab, viewer3d-rvm-tab
```

## Precedence within `resolveKindPure`

1. Explicit `SUPPORT_KIND` / `SUPPORT-KIND` attribute on the element
2. `userRules` — caller-injected overrides (RvmSupportMapper user-defined rules)
3. `kindMap` — SKEY shorthand map (Config Tab entries or DEFAULT_KIND_MAP)
4. `defaultRules` — shipped DEFAULT_RULES (CA150/CA250/CA100 + CMPSUPTYPE/MDSSUPPTYPE patterns)
5. Text heuristic — keyword scan over all attribute values
6. `defaultKind`

## Phases Remaining (gated on Phase 2 browser validation)

| Phase | Target | Work |
|---|---|---|
| 3 | `buildComponentObject.js` | Replace `getSupportKindMap()` tier 1.5 with `resolveKindPure` |
| 4 | `xml-support-builder.js` | Replace `supportKindFromRestraint` with `resolveKindPure` |
| 5 | `pcf-canonical-builder.js` | Post-resolve after raw support code picked; audit downstream exporters first |
| 6 | `accdb-to-pcf.js` | Replace inline CA100/CA150 blocks with `resolveKindPure` |
| 7 | Composite semantics | Define `primaryKind` / `kinds[]` / DOFs for CA100 (R+G); LINESTOP renderer |
