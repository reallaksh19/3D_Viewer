#!/usr/bin/env python3
"""
Repair/validate CAESAR II 2019 CII section framing around:

    EQUIPMNT -> MISCEL_1 -> UNITS

Known failure:
InputXML->CII(2019) can generate valid MISCEL payload rows but miss the
`#$ MISCEL_1` header. Then the syntax checker reads those rows as EQUIPMNT
payload and reports:

    - missing_section MISCEL_1
    - EQUIPMNT row-count mismatch

This hardener is intentionally narrow:
- preserves existing payload rows when recoverable from EQUIPMNT
- guarantees a syntactically valid MISCEL_1 section before UNITS
- does not modify unrelated engineering sections
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


SECTION_HEADER_RX = re.compile(r"^\s*#\$\s+([A-Z0-9_&]+)\s*$")

MISCEL_TAIL = [
    "      0.000000     0.000000     0.000000     0.000000     0.000000     0.000000",
    "      0.000000     0.000000     0.000000     0.000000     0.000000     0.000000",
    "      0.000000     0.000000     0.000000     0.000000     0.000000     0.000000",
    "      0.000000",
]


@dataclass
class Section:
    name: str
    header: str
    payload: list[str]


def _strip_bom(line: str) -> str:
    return line.lstrip("\ufeff")


def _parse_sections(text: str) -> list[Section]:
    sections: list[Section] = []
    current: Section | None = None

    for raw in text.splitlines():
        line = raw.rstrip("\r\n")
        match = SECTION_HEADER_RX.match(_strip_bom(line))
        if match:
            current = Section(match.group(1), line, [])
            sections.append(current)
            continue
        if current is not None:
            current.payload.append(line)

    return sections


def _format_header(section_name: str) -> str:
    return f"#$ {section_name}"


def _tokens(line: str) -> list[str]:
    return line.strip().split()


def _is_int_token(token: str) -> bool:
    try:
        int(token)
        return True
    except ValueError:
        return False


def _is_real_token(token: str) -> bool:
    try:
        float(token)
        return True
    except ValueError:
        return False


def _nonblank(payload: list[str]) -> list[str]:
    return [line for line in payload if line.strip()]


def _control_metrics(sections: list[Section]) -> dict[str, int]:
    control = next((section for section in sections if section.name == "CONTROL"), None)
    if control is None:
        return {}

    rows = _nonblank(control.payload)
    if len(rows) < 4:
        return {}

    parsed: list[list[int]] = []
    for row in rows[:4]:
        toks = _tokens(row)
        if not toks:
            return {}
        if not all(_is_int_token(tok) for tok in toks):
            return {}
        parsed.append([int(tok) for tok in toks])

    if len(parsed[0]) < 6 or len(parsed[3]) < 1:
        return {}

    return {
        "elements": parsed[0][0],
        "nozzles": parsed[0][1],
        "hangers": parsed[0][2],
        "nodename_blocks": parsed[0][3],
        "reducers": parsed[0][4],
        "flanges": parsed[0][5],
        "equipmnt": parsed[3][0],
    }


def _rrmat_row_count(element_count: int) -> int:
    if element_count <= 0:
        return 0
    return element_count // 6 + (1 if element_count % 6 else 0)


def _build_rrmat_rows(element_count: int, default_material: float = 0.0) -> list[str]:
    rows: list[str] = []
    remaining = max(0, element_count)

    while remaining > 0:
        count = min(6, remaining)
        rows.append("".join(f"{default_material:13.6f}" for _ in range(count)))
        remaining -= count

    return rows


def _build_minimal_miscel_payload(element_count: int) -> list[str]:
    return _build_rrmat_rows(element_count) + list(MISCEL_TAIL)


def _tail_is_execution_block(rows: list[str]) -> bool:
    if len(rows) < 4:
        return False

    tail = rows[-4:]
    expected_counts = [6, 6, 6, 1]

    for row, expected_count in zip(tail, expected_counts):
        toks = _tokens(row)
        if len(toks) != expected_count:
            return False
        if not all(_is_real_token(tok) for tok in toks):
            return False

    return True


def _looks_like_miscel_payload(payload: list[str], element_count: int) -> bool:
    rows = _nonblank(payload)
    rrmat_rows = _rrmat_row_count(element_count)

    if len(rows) < rrmat_rows + 4:
        return False

    for row in rows[:rrmat_rows]:
        toks = _tokens(row)
        if not toks or len(toks) > 6:
            return False
        if not all(_is_real_token(tok) for tok in toks):
            return False

    return _tail_is_execution_block(rows)


def _section_index(sections: list[Section], name: str) -> int:
    for idx, section in enumerate(sections):
        if section.name == name:
            return idx
    return -1


def _insert_or_replace_miscel(sections: list[Section], payload: list[str]) -> str:
    miscel_idx = _section_index(sections, "MISCEL_1")
    if miscel_idx >= 0:
        sections[miscel_idx].payload = payload
        return "replaced_existing_miscel_1"

    units_idx = _section_index(sections, "UNITS")
    if units_idx >= 0:
        sections.insert(units_idx, Section("MISCEL_1", _format_header("MISCEL_1"), payload))
        return "inserted_miscel_1_before_units"

    equip_idx = _section_index(sections, "EQUIPMNT")
    insert_idx = equip_idx + 1 if equip_idx >= 0 else len(sections)
    sections.insert(insert_idx, Section("MISCEL_1", _format_header("MISCEL_1"), payload))
    return "inserted_miscel_1_after_equipmnt_fallback"


def _harden_sections(sections: list[Section]) -> tuple[list[Section], list[str]]:
    metrics = _control_metrics(sections)
    element_count = int(metrics.get("elements", 0))
    hanger_count = int(metrics.get("hangers", 0))
    equip_count = int(metrics.get("equipmnt", 0))

    equip_expected_rows = equip_count * 6
    notes: list[str] = []

    miscel_idx = _section_index(sections, "MISCEL_1")
    equip_idx = _section_index(sections, "EQUIPMNT")

    if miscel_idx >= 0:
        payload = _nonblank(sections[miscel_idx].payload)
        minimum_rows = _rrmat_row_count(element_count) + 4

        if len(payload) < minimum_rows or not _tail_is_execution_block(payload):
            sections[miscel_idx].payload = _build_minimal_miscel_payload(element_count)
            notes.append("rebuilt_short_or_malformed_miscel_1")

        return sections, notes

    recovered_payload: list[str] | None = None

    if equip_idx >= 0:
        equip_payload_nonblank = _nonblank(sections[equip_idx].payload)

        if len(equip_payload_nonblank) > equip_expected_rows:
            candidate = equip_payload_nonblank[equip_expected_rows:]

            if _looks_like_miscel_payload(candidate, element_count):
                recovered_payload = candidate
                sections[equip_idx].payload = equip_payload_nonblank[:equip_expected_rows]
                notes.append(
                    f"split_{len(candidate)}_miscel_rows_from_equipmnt;hangers={hanger_count}"
                )

    if recovered_payload is None:
        recovered_payload = _build_minimal_miscel_payload(element_count)
        note = "inserted_minimal_miscel_1"
        if hanger_count > 0:
            note += "_warning_hanger_rows_not_recovered"
        notes.append(note)

    action = _insert_or_replace_miscel(sections, recovered_payload)
    notes.append(action)

    return sections, notes


def _serialize_sections(sections: list[Section]) -> str:
    lines: list[str] = []

    for section in sections:
        lines.append(section.header if section.header.strip() else _format_header(section.name))
        lines.extend(section.payload)

    return "\r\n".join(lines).rstrip() + "\r\n"


def harden_cii_text(text: str) -> tuple[str, list[str]]:
    sections = _parse_sections(text)
    if not sections:
        raise ValueError("No CII section headers found; cannot harden MISCEL_1 framing.")

    hardened_sections, notes = _harden_sections(sections)
    return _serialize_sections(hardened_sections), notes


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Harden CII 2019 MISCEL_1 section framing after InputXML->CII(2019)."
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail when the hardened output still has no MISCEL_1 section.",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    source = args.input.read_text(encoding="utf-8-sig", errors="replace")
    output, notes = harden_cii_text(source)

    if args.strict and "#$ MISCEL_1" not in output:
        raise ValueError("MISCEL_1 hardening failed: output has no #$ MISCEL_1 section.")

    args.output.write_text(output, encoding="utf-8", newline="")

    if notes:
        print("CII2019_MISCEL_HARDENER " + ";".join(notes).replace(" ", "_"))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())