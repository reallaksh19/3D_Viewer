# Code Changes

## UXML CL1
- Added CL1 route-package, package snapshot, replay validator, and workbench summary layers.
- Wired the Universal XML Converter tab to the CL1 pipeline stages and updated certification coverage.

## RVM JSON -> PCF
- Changed Generate PCF readiness handling to require an explicit readiness check before export.
- Added UXML roundtrip contract and generate-button smoke coverage.

## XML Compare
- Added the normal 3D Viewer XML Compare tab, styling, and tab registration.
- Fixed the compare dataset normalizer alias bug (`buildXmlDataset` -> `buildDataset`).
- Added X12/X13 compare behavior and UI-marker certification tests plus a runner.

## Viewer Fixes
- Grouped repeated validation diagnostics in the RVM extract diagnostics panel.
- Replaced readiness skip selection with a single "Skip all Errors" toggle and added skip-all readiness behavior.
- Suppressed invalid piping-class override noise when the previous class is not a known master value.
- Changed support symbol scaling so the multiplier affects rendered size and forced a viewer refresh after scale changes.
- Forced 3D length labels to refresh immediately when the length toggle changes.

## PCFX Branch Recovery
- Recovered TEE/OLET branch geometry when PCF blocks carry three END-POINT rows without an explicit BRANCH1-POINT.
- Preserved branch geometry through canonical PCFX conversion and viewer mapping with a `branchPoint` alias.
- Added a focused PCF -> JSON roundtrip test for TEE/OLET third-port recovery.

## RVM Validate
- Removed the live Validate dependency on `_groupDiagnosticsForDisplay` by using local grouping logic in the diagnostics panel and validation flow.

## Viewer3D Length Labels
- Added a public `refreshLengthLabels()` hook on `PcfViewer3D` so length overlay rows rebuild after toggles and gap changes.
- Wired length, gap, and verification UI changes to refresh the overlay layer without requiring a full rerender when possible.
- Added the settings-panel refresh after overlay-only length updates so the live UI stays in sync.
- Added a regression test for the length-label refresh wiring.

## UXML InputXML Geometry Preview
- Added CAESAR `PIPINGELEMENT` normalization with inherited diameter handling and bidirectional node-coordinate reconstruction.
- Added UXML geometry preview stage and SVG preview panel in the Universal XML Converter tab.
- Preserved staged JSON absolute APOS/LPOS geometry in generated InputXML through `UXML_GEOM` XML comments and consumed those comments for exact preview placement.
- Blocked downstream face/topology/CL1 stages when UXML validation has blockers instead of allowing partial topology to pass.
- Changed UXML geometry preview from a single 2D projection to isometric plus XY/XZ/YZ views so Z-heavy branch drops do not collapse visually.
- Flagged delta-only InputXML preview as fallback-only when no `UXML_GEOM` absolute coordinates are available.
- Added preview-only rotate/flip controls for UXML geometry snapshots without mutating source coordinates.
- Preserved staged JSON TEE/OLET source type hints in generated InputXML metadata and surfaced component-type counts/markers in UXML preview.

## UXML Upstream InputXML Audit
- Relaxed PDF Input Echo detection to accept CAESAR reports that expose `INPUT LISTING` plus `PIPE DATA`.
- Extended PDF metric-unit parsing for diameter, pressure, modulus, hot modulus, and density fields.
- Added PDF reconstructed `UXML_GEOM` comments so PDF-generated InputXML carries UXML preview coordinates.
- Preserved CAESAR SIF branch fitting identity by mapping suffix-bearing `Welding Tee` labels and UXML SIF type codes.
- Updated REV staged hierarchy loading so two-point REV `BRAN/OLET` components populate `CPOS` and `BPOS` instead of losing the branch point.

## UXML Source Intake and Viewer3D Toggle
- Added a dedicated browser converter executor module for UXML intake bridge calls (`pdf_to_inputxml`, `stagedjson_to_inputxml`) without touching topology builders.
- Extended 3D Viewer imports with a `Use UXML topobuilder` toggle (default `false`) and routed PCF/raw imports through UXML intake only when enabled.
- Added AVEVA XML guard on the UXML intake route in 3D Viewer so Standard XML AVEVA files stay on the existing direct import path.
- Extended raw import picker to accept staged JSON (`.json`) for toggle-enabled UXML intake routing.
- Added regression coverage for the new toggle wiring and intake route contract in `viewer/tests/unit/viewer3d-uxml-topobuilder-toggle.test.js`.

## UXML Import Audit Coverage
- Added a focused import-audit test suite for source intake completeness and ownership boundaries across PCF, PDF, staged JSON, InputXML, and Standard XML routes.
- Verified existing-converter bridge selection for PDF (`pdf_to_inputxml`) and staged JSON (`stagedjson_to_inputxml`) with converter-injected runs.
- Verified direct normalization routes remain import-only and do not emit PCF/master side effects.
- Verified `AUTO` source mode correctly detects staged JSON and triggers `Run existing converter` through `stagedjson_to_inputxml`.

## InputXML to CII 2019 RESTRANT Support Mapper
- Added the requested `inputxml_to_cii2019_beforesupportmapper.py` backup beside the active converter.
- Changed `RESTRAINT` conversion so each piping element emits one 24-line `RESTRANT` auxiliary block with six numeric restraint slots followed by six support tag/GUID string pairs.
- Preserved XML `RESTRAINT/NUM` slot positions and support `TAG`/`GUID` values in the neutral file output.
- Removed the legacy `TYPE=2 -> TYPE=4` remap and validates emitted restraint type codes as CAESAR integer values from 1 to 62.
