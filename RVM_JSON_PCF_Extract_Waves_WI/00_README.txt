PCF_GLB_Viewer_Conv — RVM JSON to PCF Extraction Workbench
Generated: 2026-05-08

This package contains one text file per wave for the 3D RVM Viewer enhancement:
- hierarchy checkbox multi-select
- canvas highlighting
- Extract PCF (from Json)
- JSON → PCF Extract tab
- Final 2D CSV from staged RVM/AVEVA JSON topology
- automatic Pipeline Ref from parent hierarchy
- master mapping chain
- PCF preview/download
- hardening and validation

Critical correction:
Valve CA8 weight lookup must follow the PcfStudio_Basic_Legacy model:
    VALVE + Bore + Rating + Length
not:
    Type + Bore + Rating + Piping Class + Material

Files:
01_Wave_1_Multi_Select_Hierarchy.txt
02_Wave_2_Tab_Shell_And_Extract_Button.txt
03_Wave_3_Final_2D_CSV_Builder.txt
04_Wave_4_PipelineRef_And_Bore.txt
05_Wave_5_Piping_Class_Master.txt
06_Wave_6_Legacy_Valve_CA8_Weight.txt
07_Wave_7_Remaining_Masters.txt
08_Wave_8_PCF_Emitter_And_Downloads.txt
09_Wave_9_Hardening.txt
10_Implementation_Order_And_Gates.txt
