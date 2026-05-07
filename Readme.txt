In folder .../BM2/...


XML TO CII: Sample 1.1 to 1.3

Refer to common error. jpg 
use mmtemplate_2019.cii as template for header (i.e, first line of CII)

Earlier there was a version mismatch between xsd (PSI116.xsd) and benchmark.cii (provided earlier).

Redo the benchmark staring with Sample 1.1 (see if this matching to PSI116.xsd), identify configurable defaults, achieve zero diff, then bench mark with sample 1.2 and 1.3
If any change in xml schema, redo benchmark of sample 1.1

















XML TO CII

Has Rvm file with its attribute.
Refer  folder : Mapping logic to Create XML from E3D [For reference only] - this is used by E3D to create XML, refer it.
RMSS[LastStageBenchmark-Approximate].cii: is the final outcome expected (approx.) after RVM->REV->XML->CII {Do not alter the code with mock values to achieve this, if not achievable, show probable cause or inputs required}