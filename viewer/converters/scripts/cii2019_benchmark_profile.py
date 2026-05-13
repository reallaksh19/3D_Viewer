#!/usr/bin/env python3
"""
Benchmark-first CII 2019 profile analyzer.

This module treats project benchmark CII files as the executable contract.
Hexagon documentation is a base reference, but observed benchmark files define
the active project profile where they contain nonzero section counts.

Important:
- A benchmark with CONTROL count = 0 for a section cannot prove that section's
  rows-per-block.
- Only infer rows-per-block when CONTROL count > 0.
- If count > 0 and payload row count is not divisible by count, fail.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


SECTION_HEADER_RX = re.compile(r"^\s*#\$\s+([A-Z0-9_&]+)\b.*$")

AUX_SECTION_TO_CONTROL_KEY = {
    "BEND": "bends",
    "RIGID": "rigids",
    "EXPJT": "expjts",
    "RESTRANT": "restraints",
    "DISPLMNT": "displmnt",
    "FORCMNT": "forcmnt",
    "UNIFORM": "uniform",
    "WIND": "wind",
    "OFFSETS": "offsets",
    "ALLOWBLS": "allowbls",
    "SIF&TEES": "sif_tees",
    "REDUCERS": "reducers",
    "FLANGES": "flanges",
    "EQUIPMNT": "equipmnt",
}

# Reference only. Do not override benchmark-observed values with these.
HEXAGON_REFERENCE_LINES_PER_BLOCK = {
    "BEND": 3,
    "RIGID": 1,
    "EXPJT": 1,
    "RESTRANT": 24,
    "DISPLMNT": 20,
    "FORCMNT": 20,
    "UNIFORM": 6,
    "WIND": 1,
    "OFFSETS": 1,
    "ALLOWBLS": 26,
    "SIF&TEES": 10,
    "REDUCERS": 1,
    "FLANGES": 12,
    "EQUIPMNT": 6,
}

CURRENT_CHECKER_FALLBACK_LINES_PER_BLOCK = {
    "BEND": 3,
    "RIGID": 1,
    "EXPJT": 1,
    "RESTRANT": 24,
    "DISPLMNT": 20,
    "FORCMNT": 13,
    "UNIFORM": 6,
    "WIND": 1,
    "OFFSETS": 1,
    "ALLOWBLS": 26,
    "SIF&TEES": 10,
    "REDUCERS": 1,
    "FLANGES": 11,
    "EQUIPMNT": 6,
}


@dataclass
class ObservedSection:
    section: str
    file: str
    control_count: int
    payload_rows: int
    observed_lines_per_block: int | None
    remainder_rows: int
    status: str


@dataclass
class BenchmarkProfileReport:
    ok: bool = True
    observations: list[ObservedSection] = field(default_factory=list)
    profile: dict[str, object] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.ok = False
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def _nonblank(rows: Iterable[str]) -> list[str]:
    return [row for row in rows if row.strip()]


def parse_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None

    for raw in text.splitlines():
        line = raw.rstrip("\r\n")
        match = SECTION_HEADER_RX.match(line.lstrip("\ufeff"))
        if match:
            current = match.group(1)
            sections.setdefault(current, [])
            continue

        if current is not None:
            sections[current].append(line)

    return sections


def parse_section_order(text: str) -> list[str]:
    order: list[str] = []

    for raw in text.splitlines():
        match = SECTION_HEADER_RX.match(raw.rstrip("\r\n").lstrip("\ufeff"))
        if match:
            order.append(match.group(1))

    return order


def parse_control(sections: dict[str, list[str]]) -> dict[str, int]:
    rows = _nonblank(sections.get("CONTROL", []))
    if len(rows) < 4:
        raise ValueError("CONTROL requires at least 4 rows.")

    parsed = []
    for row in rows[:4]:
        tokens = row.split()
        parsed.append([int(token) for token in tokens])

    if len(parsed[0]) < 6 or len(parsed[1]) < 6 or len(parsed[2]) < 6 or len(parsed[3]) < 1:
        raise ValueError("CONTROL does not have expected 6/6/6/1 integer layout.")

    return {
        "elements": parsed[0][0],
        "nozzles": parsed[0][1],
        "hangers": parsed[0][2],
        "nodename_blocks": parsed[0][3],
        "reducers": parsed[0][4],
        "flanges": parsed[0][5],
        "bends": parsed[1][0],
        "rigids": parsed[1][1],
        "expjts": parsed[1][2],
        "restraints": parsed[1][3],
        "displmnt": parsed[1][4],
        "forcmnt": parsed[1][5],
        "uniform": parsed[2][0],
        "wind": parsed[2][1],
        "offsets": parsed[2][2],
        "allowbls": parsed[2][3],
        "sif_tees": parsed[2][4],
        "control_line3_field6": parsed[2][5],
        "equipmnt": parsed[3][0],
    }


def analyze_benchmark_file(path: Path) -> tuple[dict[str, int], list[ObservedSection], list[str]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    sections = parse_sections(text)
    control = parse_control(sections)

    errors: list[str] = []
    observations: list[ObservedSection] = []

    for section_name, control_key in AUX_SECTION_TO_CONTROL_KEY.items():
        count = int(control.get(control_key, 0))
        payload_rows = len(_nonblank(sections.get(section_name, [])))

        if count == 0:
            status = "unobserved_zero_count"
            observed = None
            remainder = payload_rows
            if payload_rows != 0:
                status = "error_payload_rows_with_zero_control"
                errors.append(
                    f"{path}: #$ {section_name} has {payload_rows} rows but CONTROL {control_key}=0"
                )
        else:
            remainder = payload_rows % count
            if remainder != 0:
                status = "error_not_divisible"
                observed = None
                errors.append(
                    f"{path}: #$ {section_name} rows={payload_rows} not divisible by "
                    f"CONTROL {control_key}={count}"
                )
            else:
                observed = payload_rows // count
                status = "observed"

        observations.append(
            ObservedSection(
                section=section_name,
                file=str(path),
                control_count=count,
                payload_rows=payload_rows,
                observed_lines_per_block=observed,
                remainder_rows=remainder,
                status=status,
            )
        )

    return control, observations, errors


def build_profile(benchmark_paths: list[Path]) -> BenchmarkProfileReport:
    report = BenchmarkProfileReport()

    observed_by_section: dict[str, set[int]] = {
        section: set() for section in AUX_SECTION_TO_CONTROL_KEY
    }

    for path in benchmark_paths:
        try:
            _control, observations, errors = analyze_benchmark_file(path)
        except Exception as exc:
            report.fail(f"{path}: failed to analyze benchmark: {exc}")
            continue

        for error in errors:
            report.fail(error)

        report.observations.extend(observations)

        for obs in observations:
            if obs.status == "observed" and obs.observed_lines_per_block is not None:
                observed_by_section[obs.section].add(obs.observed_lines_per_block)

    profile_sections: dict[str, object] = {}

    for section_name in AUX_SECTION_TO_CONTROL_KEY:
        observed_values = sorted(observed_by_section[section_name])

        if len(observed_values) == 1:
            observed_value = observed_values[0]
            profile_sections[section_name] = {
                "status": "observed",
                "linesPerBlock": observed_value,
                "source": "benchmark_corpus",
                "hexagonReference": HEXAGON_REFERENCE_LINES_PER_BLOCK.get(section_name),
                "currentCheckerFallback": CURRENT_CHECKER_FALLBACK_LINES_PER_BLOCK.get(section_name),
            }

            ref = HEXAGON_REFERENCE_LINES_PER_BLOCK.get(section_name)
            if ref is not None and ref != observed_value:
                report.warn(
                    f"{section_name}: benchmark observed {observed_value}, "
                    f"Hexagon reference says {ref}; benchmark profile overrides."
                )

        elif len(observed_values) > 1:
            report.fail(
                f"{section_name}: conflicting benchmark observed rows-per-block values: {observed_values}"
            )
            profile_sections[section_name] = {
                "status": "conflict",
                "observedValues": observed_values,
            }

        else:
            profile_sections[section_name] = {
                "status": "unobserved",
                "linesPerBlock": CURRENT_CHECKER_FALLBACK_LINES_PER_BLOCK.get(section_name),
                "source": "fallback_current_checker_until_nonzero_benchmark_exists",
                "hexagonReference": HEXAGON_REFERENCE_LINES_PER_BLOCK.get(section_name),
            }

    report.profile = {
        "schema": "cii2019-benchmark-profile/v1",
        "benchmarkFileCount": len(benchmark_paths),
        "rulePriority": [
            "observed_nonzero_benchmark_rows_per_block",
            "current_checker_fallback_for_unobserved_sections",
            "hexagon_reference_documentation_only",
        ],
        "sections": profile_sections,
    }

    return report


def _find_benchmark_files(root: Path) -> list[Path]:
    candidates: list[Path] = []

    for path in root.rglob("*"):
        if not path.is_file():
            continue

        name = path.name.lower()
        if not name.endswith(".cii"):
            continue

        if "benchmark" in name:
            candidates.append(path)

    return sorted(candidates)


def _write_markdown(report: BenchmarkProfileReport, output: Path) -> None:
    lines = [
        "# CII 2019 Benchmark Profile",
        "",
        "Benchmark files override generic Hexagon assumptions for this project profile.",
        "",
        f"Status: `{'PASS' if report.ok else 'FAIL'}`",
        "",
        "## Profile",
        "",
        "```json",
        json.dumps(report.profile, indent=2),
        "```",
        "",
        "## Warnings",
        "",
    ]

    if report.warnings:
        for warning in report.warnings:
            lines.append(f"- {warning}")
    else:
        lines.append("- None")

    lines.extend(["", "## Errors", ""])

    if report.errors:
        for error in report.errors:
            lines.append(f"- {error}")
    else:
        lines.append("- None")

    lines.extend(["", "## Observations", ""])

    lines.append("| Section | File | CONTROL Count | Payload Rows | Observed Rows/Block | Status |")
    lines.append("|---|---|---:|---:|---:|---|")

    for obs in report.observations:
        value = "" if obs.observed_lines_per_block is None else str(obs.observed_lines_per_block)
        lines.append(
            f"| {obs.section} | `{obs.file}` | {obs.control_count} | "
            f"{obs.payload_rows} | {value} | {obs.status} |"
        )

    output.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Analyze CII benchmark profile rules.")
    parser.add_argument(
        "--benchmark-root",
        type=Path,
        default=Path("Benchmarks") / "INPUT XML to CII 2019",
    )
    parser.add_argument(
        "--profile-output",
        type=Path,
        default=Path("Benchmarks")
        / "INPUT XML to CII 2019"
        / "cii2019_benchmark_profile.generated.json",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=Path("Benchmarks")
        / "INPUT XML to CII 2019"
        / "INPUTXML_CII2019_BENCHMARK_PROFILE.md",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    benchmark_files = _find_benchmark_files(args.benchmark_root)

    if not benchmark_files:
        print(f"No *Benchmark*.CII files found under {args.benchmark_root}")
        return 1

    report = build_profile(benchmark_files)

    args.profile_output.write_text(json.dumps(report.profile, indent=2), encoding="utf-8")
    _write_markdown(report, args.markdown_output)

    if report.errors:
        print("BENCHMARK PROFILE FAIL")
        for error in report.errors:
            print(f"  ERROR: {error}")
        return 1

    print("BENCHMARK PROFILE PASS")
    print(f"Benchmarks analyzed: {len(benchmark_files)}")
    print(f"Profile JSON: {args.profile_output}")
    print(f"Markdown: {args.markdown_output}")

    for warning in report.warnings:
        print(f"  WARNING: {warning}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
