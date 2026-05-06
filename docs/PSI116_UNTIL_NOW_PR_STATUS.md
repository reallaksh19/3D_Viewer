# PSI116 Until-Now PR Status

This branch is a review marker for the PSI116/B7410250 work completed up to the source-level comparison plan.

Most implementation commits were already applied on `main` before the requested phase-branch split. This PR adds a status document so the current work can still be reviewed and discussed through a pull request.

## Completed before phase split

- Added PSI116 XML contract checker.
- Gated upstream XML generation in the browser worker.
- Added shared PSI116 upstream XML builder.
- Routed staged JSON and attribute TXT converters through the shared upstream builder.
- Added BM1 regression workflow and runner.
- Added B7410250 regression runner skeleton.
- Updated contract checker to accept the benchmark PSI116 namespace spelling.
- Added technical source-level comparison and phased implementation plan.

## Explicit constraint retained

`viewer/converters/scripts/xml_to_cii.py` must not be changed without explicit approval.

## Next branches requested

- `psi116-branch1-p0-p1`
- `psi116-branch2-p2-p3`
- `psi116-branch3-p4-p5`
- `psi116-branch4-p6-p7-p8`
