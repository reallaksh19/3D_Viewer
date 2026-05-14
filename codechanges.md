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
