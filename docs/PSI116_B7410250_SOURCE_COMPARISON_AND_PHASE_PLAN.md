# PSI116 B7410250 Source-Level Comparison and Phased Implementation Plan

Date: 2026-05-06
Repository: `reallaksh19/PCF_GLB_Viewer_Conv`
Scope: make the upstream XML generator produce benchmark-shaped AVEVA PSI116 XML for B7410250 while keeping `viewer/converters/scripts/xml_to_cii.py` unchanged.

---

## 1. Current branch progress inspected

The current `main` branch already contains the first protection layer for the PSI116 pipeline:

1. `viewer/converters/scripts/psi116_regression_b7410250.py`
   - Adds B7410250 regression flow.
   - Step 1a: attribute TXT -> XML -> compare to XML benchmark.
   - Step 1b: staged JSON -> XML -> compare to XML benchmark.
   - Step 2: generated XML -> unchanged `xml_to_cii.py` -> compare to CII benchmark.
   - Current limitation: the comparator normalizes every numeric token to `<NUM>`, so it catches XML/CII structure and text drift but can hide numeric-coordinate drift.

2. `viewer/converters/scripts/psi116_contract_check.py`
   - Acts as a contract gate before XML -> CII conversion.
   - Now accepts both namespace spellings:
     - preferred benchmark namespace: `http://aveva.com/pipeStress116.xsd`
     - alternate existing XSD spelling: `http://aveva.com/pipestress116.xsd`

3. `viewer/converters/scripts/psi116_upstream_common.py`
   - Shared upstream builder used by:
     - `rvm_attribute_to_xml.py`
     - `stagedjson_to_xml.py`
   - Current builder creates route-materialized XML using guard `PIPE` nodes around fittings/supports.
   - This is contract-valid for the unchanged downstream converter, but it is not benchmark-shaped AVEVA output.

---

## 2. Source files compared

### Current upstream implementation

File: `viewer/converters/scripts/psi116_upstream_common.py`

Key current logic:

- Namespace constant:
  - `PSI116_NS = 'http://aveva.com/pipestress116.xsd'`
- Fitting/support classification:
  - `SPECIAL_TYPES = {'ELBO', 'TEE', 'OLET', 'REDU', 'ATTA'}`
  - `RIGID_TYPES = {'VALV', 'FLAN', 'GASK'}`
- Current materialization rule:
  - Special components emit `[PIPE-UP, fitting/support center, PIPE-DN]`.
  - Rigid components emit `[PIPE-UP, rigid component, PIPE-DN]`.
  - Simple pipe emits one or two `PIPE` nodes.
- Current XML header:
  - blank DateTime
  - Version `0.0.0.0`
  - UserName `browser-runtime`
  - no `<Units>` block
  - `RestrainOpenEnds>No</RestrainOpenEnds>`
  - `AmbientTemperature>0</AmbientTemperature>`
- Current generated branch metadata:
  - all temperatures default to `-100000`
  - all pressures default to `0`

### Benchmark XML

File: `B7410250-BM/SYS-30-B7410250 [XML BECHMARK].xml`

Observed benchmark characteristics:

- Root namespace:
  - `http://aveva.com/pipeStress116.xsd`
- Header resembles AVEVA PSI export:
  - DateTime populated
  - Source `AVEVA PSI`
  - Version `3.1.7.0`
  - UserName populated
  - Purpose `Preliminary stress run`
  - ProjectName `ZAU`
  - MDBName `/ZAU1`
  - TitleLine `PSI stress Output`
  - includes `<Units>` block
  - `RestrainOpenEnds>Yes</RestrainOpenEnds>`
  - empty `<AmbientTemperature></AmbientTemperature>`
- Pipe metadata:
  - `FullName>/SYS-30-B7410250</FullName>`
  - AVEVA reference numbers in `<Ref>` and `<ComponentRefNo>`.
- Branch metadata:
  - first branch has `Temperature1 = 50`, remaining temperatures `-100000`.
  - pressure values are `0`.
- Node/component pattern uses AVEVA-style component records:
  - `BRAN`
  - `FBLI`
  - `GASK`
  - `RIGID`
  - `FLAN`
  - `TEE`
  - `OLET`
  - `ANCI`
  - `ELBO`
  - `ATTA`

---

## 3. Technical source-level gap matrix

| Area | Current source behavior | Benchmark behavior | Impact | Required change |
|---|---|---|---|---|
| Namespace | `pipestress116.xsd` hard-coded in `PSI116_NS` | `pipeStress116.xsd` | XML diff and profile mismatch | Add profile-level namespace, default benchmark profile to `pipeStress116.xsd` |
| Header metadata | Synthetic/browser defaults | AVEVA PSI header with populated DateTime, Version, UserName, Purpose, ProjectName, MDBName | XML benchmark mismatch | Add profile metadata config/defaults; do not hard-code runtime placeholders for benchmark profile |
| Units block | Not emitted | Full `<Units>` block emitted | XML benchmark mismatch | Emit units block in benchmark profile |
| Restrain open ends | `No` | `Yes` | Affects open-end restraint generation in `xml_to_cii.py` | Benchmark profile must emit `Yes`; test CII restraint count |
| Ambient temperature | `0` | empty element | XML benchmark mismatch | Allow empty ambient value in profile |
| Pipe identity | Uses input stem and blank ref | Uses `/SYS-30-B7410250` and AVEVA ref | XML benchmark mismatch | Add pipe metadata resolver from benchmark/config/raw attributes |
| Branch name | Uses input/staged root name | Full AVEVA branch path | XML benchmark mismatch | Resolve branch path from raw attributes if available; otherwise configurable override |
| Branch temperatures | all `-100000` | `Temperature1=50` in observed branch | CII temperature and XML mismatch | Add temperature resolver with fallback/defaults |
| Node numbering | Every emitted node gets next positive number | Only stress-relevant physical nodes get positive numbers; helper endpoint/attachment records are often `-1` or `-2` | Connectivity and XML benchmark mismatch | Implement benchmark node-number allocator: positive route nodes only; helper nodes negative |
| Guard nodes | Uses synthetic `PIPE` guards around fittings | Benchmark uses endpoint records with same component type: e.g. ELBO endpoint 1 / center / endpoint 2 | XML shape and CII element count mismatch | Replace generic guard model with AVEVA profile node-sequence emitters |
| Branch start | Current source maps `BRAN` text to `PIPE` | Benchmark starts with `BRAN`, endpoint 1, connection `CLOS` | First node mismatch | Add explicit `BRAN` record mapping |
| Flanged boundary | Current rigid types are `VALV/FLAN/GASK` with `PIPE` guards | Benchmark uses `FBLI`, `GASK`, `RIGID`, `FLAN` with endpoint and rigid flags | Rigid section mismatch | Add flanged-chain sequence mapper |
| TEE/OLET | Current sequence: `PIPE-UP`, `TEE/OLET endpoint 0`, `PIPE-DN` | Benchmark sequence: endpoint 1 helper, endpoint 3 helper, endpoint 0 positive node, endpoint 2 helper | SIF/tee and branch-point shape mismatch | Add dedicated TEE/OLET four-record sequence emitter |
| ELBO | Current sequence: `PIPE-UP`, center `ELBO`, `PIPE-DN`; BendType currently `1` | Benchmark sequence: endpoint 1 helper, endpoint 0 positive center, endpoint 2 helper; BendType `0` | Bend benchmark mismatch | Add ELBO three-record emitter; BendType default `0` for benchmark profile |
| Supports | Current emits positive `ATTA` with `<Restraint>` child | Benchmark shows `ANCI` positive component nodes and `ATTA` negative attachment helper nodes, with no explicit restraint child in observed fragments | Support and CII restraint behavior can diverge | Split support semantics: `ANCI` route component vs `ATTA` attachment helper; validate against CII counts before removing/adding explicit restraint records |
| Coordinates | Current fabricates before/after positions using bore-sized gap if endpoints are missing | Benchmark uses real AVEVA endpoint/center/branch/support coordinates | Major geometry drift | Implement anchor resolver: APOS/LPOS/CPOS/BPOS/supportCoord first; no arbitrary bore gap in benchmark profile |
| Ordering/topology | Current order follows parsed blocks/staged children | Benchmark order is route/topology order, including negative helper records around physical nodes | Element order mismatch | Add route ordering stage before node emission |
| XML comparison | Current regression replaces all numbers with `<NUM>` | Benchmark validation needs structural and numeric confidence | Numeric drift can pass incorrectly | Add typed numeric tolerance comparison and shape inventory report |

---

## 4. Implementation doctrine

1. Do not modify `viewer/converters/scripts/xml_to_cii.py` during benchmark-shape work.
2. Preserve current generic route-materialized behavior as a fallback profile until benchmark profile is certified.
3. Add explicit PSI116 profile modes instead of adding benchmark-specific hacks inline.
4. Treat benchmark-shaped XML as a profile output, not the canonical internal model.
5. Keep attribute TXT and staged JSON paths convergent: both must call the same profile mapper.
6. Every phase must leave the repo runnable and must include a measurable pass/fail gate.

---

## 5. Phased implementation plan

### Phase P0 — Baseline inventory and non-mutating analyzer

Goal: quantify the exact XML shape before changing generation logic.

Tasks:

1. Add `viewer/converters/scripts/psi116_shape_inventory.py`.
2. Parse any PSI116 XML and produce JSON counts:
   - namespace
   - pipe count
   - branch count
   - positive node count
   - negative helper node count by `NodeNumber`
   - component counts
   - endpoint counts by component type
   - rigid flag counts
   - bend count candidates as seen by unchanged `xml_to_cii.py`
   - SIF/tee candidate count
   - reducer candidate count
   - explicit restraint count
   - open-end restraint setting
3. Run against benchmark XML and generated XML.
4. Store reports under `reports/psi116_b7410250_regression/`.

Pass criteria:

- Analyzer exits `0` for benchmark XML.
- Analyzer exits `0` for current generated XML.
- Report includes all required counts.
- No production converter behavior changes.

Boundary limit:

- Maximum patch size: 200 lines.

---

### Phase P1 — PSI116 profile configuration layer

Goal: separate current generic output from benchmark-shaped output.

Tasks:

1. Add a lightweight profile object/dataclass in `psi116_upstream_common.py`.
2. Supported profiles:
   - `generic_guard` — current behavior.
   - `aveva_benchmark` — benchmark-shaped behavior.
3. Add CLI option to both upstream entry points:
   - `--profile generic_guard|aveva_benchmark`
4. Move header constants into the profile:
   - namespace
   - Source
   - Version
   - UserName
   - Purpose
   - ProjectName
   - MDBName
   - TitleLine
   - Units block enable/disable
   - RestrainOpenEnds
   - AmbientTemperature representation
5. Keep default as `generic_guard` until certification, then optionally switch UI default later.

Pass criteria:

- Existing generic output remains byte-stable except intended namespace/profile metadata if explicitly selected.
- `--profile aveva_benchmark` emits benchmark namespace and units block.
- Contract checker passes for both accepted namespace spellings.

Boundary limit:

- Maximum patch size: 250 lines.

---

### Phase P2 — PSI116 node model refactor

Goal: make node emission deterministic and profile-aware.

Tasks:

1. Add a `PsiNode` structure internally with fields matching XML order:
   - NodeNumber
   - NodeName
   - Endpoint
   - Rigid
   - ComponentType
   - Weight
   - ComponentRefNo
   - ConnectionType
   - OutsideDiameter
   - WallThickness
   - CorrosionAllowance
   - AlphaAngle
   - InsulationThickness
   - Position
   - BendRadius
   - BendType
   - SIF
   - optional Restraint
2. Add `NodeNumberAllocator`:
   - Positive nodes: `10, 20, 30, ...`
   - Helper endpoint nodes: `-1`
   - Attachment helper nodes: `-2`
3. Keep XML element ordering identical to XSD/benchmark order.
4. Make rigid flag handling explicit:
   - no rigid element unless required.
   - benchmark profile may emit `Rigid=1` and `Rigid=2` according to component sequence.

Pass criteria:

- Generated XML is still valid for unchanged `xml_to_cii.py`.
- No duplicate positive node numbers.
- Negative helper nodes do not enter `xml_to_cii.py` edge list.
- Analyzer reports positive node count separately from helper count.

Boundary limit:

- Maximum patch size: 250 lines.

---

### Phase P3 — AVEVA benchmark component sequence emitters

Goal: replace generic `PIPE` guard nodes with benchmark-shaped component records when `--profile aveva_benchmark` is selected.

Component-specific tasks:

1. Branch start emitter:
   - emit `BRAN`, endpoint `1`, first positive node.
   - set connection type `CLOS` if branch start indicates closure.
2. Flanged/rigid boundary emitter:
   - support `FBLI`, `GASK`, `RIGID`, `FLAN` sequence.
   - preserve AVEVA component references when present.
3. TEE emitter:
   - endpoint `1` helper record.
   - endpoint `3` branch helper record.
   - endpoint `0` positive center node.
   - endpoint `2` helper record.
4. OLET emitter:
   - same endpoint model as TEE.
   - branch helper coordinate must use branch point/branch projection, not arbitrary offset.
5. ELBO emitter:
   - endpoint `1` helper record.
   - endpoint `0` positive bend node.
   - endpoint `2` helper record.
   - default `BendType=0` under benchmark profile.
6. Support emitter:
   - `ANCI` positive support/control node where benchmark uses `ANCI`.
   - `ATTA` negative attachment helper where benchmark uses `ATTA`.
   - do not blindly add `<Restraint>` until CII benchmark count proves it is needed.
7. Reducer emitter:
   - keep existing `AlphaAngle` detection.
   - add benchmark-shaped node sequence after reducer samples are confirmed.

Pass criteria:

- Shape inventory component counts match benchmark for all implemented component families.
- Endpoint sequence inventory matches benchmark for:
  - TEE
  - OLET
  - ELBO
  - FBLI/GASK/RIGID/FLAN
- B7410250 XML diff line count is reduced by at least 60% from current baseline after numeric normalization.

Boundary limit:

- Split into P3A/P3B/P3C if additions exceed 250 lines:
  - P3A: BRAN + flanged/rigid chain.
  - P3B: TEE/OLET.
  - P3C: ELBO + support/ANCI/ATTA.

---

### Phase P4 — Geometry anchor resolver and route ordering

Goal: use real AVEVA anchors and topology instead of synthetic before/after offsets.

Tasks:

1. Build anchor resolver priority:
   - `APOS` / endpoint 1
   - `LPOS` / endpoint 2
   - `CPOS` / bend center
   - `BPOS` / branch point
   - support coordinate
   - generic `POS` only as last fallback.
2. For ELBO:
   - endpoint 1 = incoming tangent point.
   - endpoint 0 = bend center or arc control point used by benchmark.
   - endpoint 2 = outgoing tangent point.
3. For TEE/OLET:
   - endpoint 0 = header/branch intersection.
   - endpoint 3 = branch helper coordinate.
   - endpoint 1/2 = header endpoints.
4. For branch ordering:
   - order by route chain, not raw attribute parse order when topology fields are available.
   - preserve raw order only when topology is incomplete.
5. Add diagnostics for missing anchors:
   - component ref
   - required anchor missing
   - fallback used
   - quality flag.

Pass criteria:

- Generated XML positive-node coordinate count equals benchmark positive-node count.
- For coordinates present in both generated and benchmark XML, max absolute delta <= `0.01 mm` after matching by component ref + endpoint + component type.
- No synthetic bore-gap positions are used in `aveva_benchmark` profile unless logged as fallback.

Boundary limit:

- Maximum patch size per subphase: 250 lines.

---

### Phase P5 — Regression comparator hardening

Goal: make benchmark regression useful for real engineering validation, not only text shape comparison.

Tasks:

1. Replace all-number-to-`<NUM>` comparator with typed comparator modes:
   - XML structural compare.
   - XML text compare.
   - XML numeric compare with tolerance.
   - CII section inventory compare.
   - CII numeric compare with tolerance.
2. Emit summary JSON:
   - structural mismatch count
   - component sequence mismatch count
   - numeric mismatch count
   - max coordinate delta
   - max CII numeric delta
   - first 50 actionable mismatches.
3. Keep old normalized diff as an auxiliary artifact only.

Pass criteria:

- Regression report always produced even on failure.
- Failure message tells which phase class failed: header, branch, node sequence, coordinate, CII section, CII numeric.
- Numeric tolerance default:
   - XML coordinates: `0.01 mm`
   - XML non-coordinate numerics: `1e-6` unless configured.
   - CII numeric values: `1e-4` for normal floats; exact for counts/pointers.

Boundary limit:

- Maximum patch size: 250 lines.

---

### Phase P6 — B7410250 XML and CII certification gate

Goal: certify the end-to-end benchmark with unchanged downstream converter.

Tasks:

1. Run:
   - attribute TXT -> XML benchmark profile.
   - staged JSON -> XML benchmark profile.
   - both XML files -> unchanged `xml_to_cii.py`.
2. Compare against:
   - `SYS-30-B7410250 [XML BENCHMARK].xml`
   - `SYS-30-B7410250 [CII BENCHMARK].cii`
3. Produce final certification report:
   - XML structural pass/fail.
   - XML numeric pass/fail.
   - CII structural pass/fail.
   - CII numeric pass/fail.
   - counts for elements, restraints, bends, SIF/tees, reducers.

Pass criteria:

- Step 1a XML: zero structural differences.
- Step 1b XML: zero structural differences.
- Step 2 CII from 1a: zero section/count differences.
- Step 2 CII from 1b: zero section/count differences.
- Numeric tolerances:
   - XML coordinate max abs delta <= `0.01 mm`.
   - CII element delta max abs <= `1e-4` except integer pointers/counts exact.
- `xml_to_cii.py` remains unchanged.

Boundary limit:

- Maximum patch size: 200 lines for certification glue only.

---

### Phase P7 — CI and UI integration

Goal: make benchmark profile available and protected in normal workflows.

Tasks:

1. Add/update GitHub Actions workflow:
   - run shape inventory.
   - run B7410250 regression in benchmark profile.
   - archive regression report/diffs.
2. Update converter UI/workers only after CLI gate passes:
   - expose PSI116 profile selector.
   - default to current generic profile until user chooses benchmark profile or project default changes.
3. Add UI warning:
   - benchmark profile expects AVEVA-like attributes and geometry anchors.
   - fallback quality flags must be reviewed.

Pass criteria:

- CI fails if benchmark profile regresses.
- UI still supports current conversion path.
- No browser worker failure due to missing CLI option.

Boundary limit:

- Maximum patch size per file: 200 lines.

---

### Phase P8 — Cleanup, defaults, and documentation

Goal: leave the converter maintainable.

Tasks:

1. Document profiles in `Readme.txt` or a dedicated converter README.
2. Add benchmark profile defaults table:
   - namespace
   - units
   - restrain open ends
   - bend type default
   - branch temperature fallback
   - metadata fallback.
3. Add known limitations:
   - missing AVEVA refs.
   - missing branch topology.
   - missing support semantics.
   - reducer sample coverage.
4. Remove temporary diagnostics only after CI artifacts are stable.

Pass criteria:

- README explains when to use `generic_guard` vs `aveva_benchmark`.
- No stale `.tmp` or local report artifacts committed unless intentionally documented.
- Regression command is copy-paste runnable.

Boundary limit:

- Maximum patch size: 150 lines.

---

## 6. Recommended implementation order

1. P0 first because it gives exact counts and avoids guessing.
2. P1 next because profile separation prevents breaking current users.
3. P2 before component changes because node numbering and XML order must be stable.
4. P3 component families in small subphases.
5. P4 geometry after component sequence exists.
6. P5 comparator hardening before claiming benchmark parity.
7. P6 certification only after XML shape is close.
8. P7/P8 only after CLI regression is stable.

---

## 7. Immediate next coding task

Implement Phase P0 only:

```bash
python viewer/converters/scripts/psi116_shape_inventory.py \
  --xml "B7410250-BM/SYS-30-B7410250 [XML BECHMARK].xml" \
  --report reports/psi116_b7410250_regression/benchmark_shape_inventory.json
```

Then run the same tool against the current generated XML from `psi116_regression_b7410250.py` and compare inventory deltas.

No generator rewrite should start until P0 report identifies the exact component/endpoint/node-count target.
