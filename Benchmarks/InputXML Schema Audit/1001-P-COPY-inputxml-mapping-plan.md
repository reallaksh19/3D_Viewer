# Schema Audit: 1001-P COPY_INPUT.XML

## Top Tag Frequency
- CAESARII: 1
- PIPINGMODEL: 1
- PIPINGELEMENT: 22
- RIGID: 6
- DISPLACEMENTS: 6
- VECTOR: 51
- ALLOWABLESTRESS: 1
- CASE: 9
- BEND: 6
- HANGER: 3
- RESTRAINT: 12
- SIF: 2
- UNITS: 1
- LENGTH: 1
- FORCE: 1
- MASS-DYNAMICS: 1
- MOMENT-INPUT: 1
- MOMENT-OUTPUT: 1
- STRESS: 1
- TEMP: 1
- PRESSURE: 1
- EMOD: 1
- PDENS: 1
- IDENS: 1
- FDENS: 1
- TRANS_STIFF: 1
- ROTL_STIFF: 1
- UNIF_LOAD: 1
- G_LOAD: 1
- WIND_LOAD: 1
- ELEVATION: 1
- COMPOUND_LENGTH: 1
- DIAMETER: 1
- THICKNESS: 1

## Candidate Tags

- Pipeline/Line: PIPINGMODEL (has NAME)
- Components: PIPINGELEMENT (acts as pipe and fitting container)
- Supports: SUPPORT (child of PIPINGELEMENT)
- Coordinates: FROM_NODE, TO_NODE, DELTA_X, DELTA_Y, DELTA_Z on PIPINGELEMENT
- Bores/Sizes: DIAMETER, WALL_THICK

## Observations
Unlike standard AVEVA InputXML which uses `<Element type="PIPE">` with `<Node>` lists, this file uses a CAESAR II specific format:
- Root is `<CAESARII>` -> `<PIPINGMODEL>`
- Elements are `<PIPINGELEMENT>`
- No explicit `<Node>` coordinate dictionary. Instead, it uses `FROM_NODE`, `TO_NODE`, and `DELTA_X/Y/Z`.
- Components like Valves and Flanges are declared via `<RIGID TYPE="Valve">` children inside a `<PIPINGELEMENT>`.

This requires a completely custom mapper (Agent 20), as the Agent 18 adaptive mapper will not find any coordinates.
