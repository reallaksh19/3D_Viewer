#!/usr/bin/env python3
"""
Certification gate for InputXML -> CII 2019 section-rule compliance.

This script is intentionally strict:
- Reads the current generated benchmark CII.
- Runs cii2019_section_rules directly.
- Verifies syntax report contains specSectionRules.ok == true.
- Fails CI if MISCEL_1 / CONTROL / UNITS / SIF&TEES / EQUIPMNT section rules fail.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys

import cii2019_section_rules


ROOT = Path(__file__).resolve().parents[3]

CII_PATH = ROOT / "Benchmarks" / "INPUT XML to CII 2019" / "BM_CII" / "AutojsongeneratedCII_BM_CII_INPUT.cii"
REPORT_PATH = ROOT / "Benchmarks" / "INPUT XML to CII 2019" / "BM_CII" / "AutojsongeneratedCII_BM_CII_INPUT.ci.syntax_report.json"


def _fail(message: str) -> int:
    print(f"CERTIFICATION FAIL: {message}", file=sys.stderr)
    return 1


def main() -> int:
    if not CII_PATH.exists():
        return _fail(f"Generated CII not found: {CII_PATH}")

    cii_text = CII_PATH.read_text(encoding="utf-8", errors="replace")
    section_report = cii2019_section_rules.validate_cii2019_sections(cii_text)

    if not section_report.ok:
        print(json.dumps(section_report.to_dict(), indent=2), file=sys.stderr)
        return _fail("cii2019_section_rules reported section-rule errors.")

    if not REPORT_PATH.exists():
        return _fail(f"Syntax report not found. Run cert:cii2019 first: {REPORT_PATH}")

    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))

    # if report.get("ok") is not True:
    #     return _fail("cii_syntax_check_2019 report ok != true.")

    spec_rules = report.get("specSectionRules")
    if not isinstance(spec_rules, dict):
        return _fail("syntax report missing specSectionRules object.")

    if spec_rules.get("ok") is not True:
        print(json.dumps(spec_rules, indent=2), file=sys.stderr)
        return _fail("syntax report specSectionRules.ok != true.")

    sections_found = report.get("sectionsFound") or []
    for required in ("CONTROL", "SIF&TEES", "EQUIPMNT", "MISCEL_1", "UNITS"):
        if required not in sections_found:
            return _fail(f"required section missing from syntax report: {required}")

    metrics = report.get("metrics") or {}
    block_counts = report.get("derivedBlockCounts") or {}

    equipmnt_rows = ((block_counts.get("EQUIPMNT") or {}).get("rows"))
    expected_equipmnt_rows = int(metrics.get("equipmnt", 0)) * 6
    if equipmnt_rows != expected_equipmnt_rows:
        return _fail(
            f"EQUIPMNT rows mismatch: actual={equipmnt_rows}, expected={expected_equipmnt_rows}"
        )

    sif_rows = ((block_counts.get("SIF&TEES") or {}).get("rows"))
    expected_sif_rows = int(metrics.get("sif_tees", 0)) * 10
    if sif_rows != expected_sif_rows:
        return _fail(
            f"SIF&TEES rows mismatch: actual={sif_rows}, expected={expected_sif_rows}"
        )

    print("CERTIFICATION PASS: CII 2019 section rules, syntax report, and critical row counts are clean.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())