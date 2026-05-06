#!/usr/bin/env python3
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
import json
import math
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

SENTINEL = -1.0101
BEND_TYPES = {"ELBO", "BEND"}
SIF_TYPES = {"TEE", "OLET"}
RIGID_TYPES = {"FBLI", "FLAN", "GASK", "VALV", "PCOM", "RIGID"}
SUPPORT_TYPES = {"ATTA", "ANCI", "SUPP", "SUPPORT"}
REDUCER_TYPES = {"REDU", "REDUCER"}
ROUTE_COMPONENT_TYPES = BEND_TYPES | SIF_TYPES | RIGID_TYPES | SUPPORT_TYPES | REDUCER_TYPES

NEW_RX = re.compile(r"^(?P<indent>\s*)NEW\s+(?P<title>.*)$", re.I)
END_RX = re.compile(r"^\s*END\b", re.I)
KV_RX = re.compile(r"^\s*:?(?P<key>[A-Za-z][A-Za-z0-9_ /\[\]\-]*?)\s*(?::=|=|:)\s*(?P<value>.*?)\s*$")
NUM_RX = re.compile(r"[-+]?\d+(?:\.\d+)?")
REF_RX = re.compile(r"=[0-9]+/[0-9]+")


@dataclass
class AttrRecord:
    title: str
    line: int
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["AttrRecord"] = field(default_factory=list)
    parent: "AttrRecord | None" = None

    @property
    def typ(self) -> str:
        return self.attrs.get("TYPE", "").upper()

    @property
    def name(self) -> str:
        return self.attrs.get("NAME") or self.attrs.get("REF") or self.title


def clean(value) -> str:
    return "" if value is None else str(value).strip()


def first_float(value, default=SENTINEL) -> float:
    match = NUM_RX.search(clean(value).replace(",", ""))
    return float(match.group(0)) if match else default


def mm(value, default=None):
    match = NUM_RX.search(clean(value).replace(",", ""))
    return float(match.group(0)) if match else default


def parse_point(value: str | None):
    text = clean(value)
    if not text:
        return None
    tokens = text.replace(",", " ").split()
    out = {"x": 0.0, "y": 0.0, "z": 0.0}
    found = False
    index = 0
    while index + 1 < len(tokens):
        axis = tokens[index].upper()
        number = mm(tokens[index + 1])
        if number is not None:
            if axis == "E":
                out["x"] = number; found = True; index += 2; continue
            if axis == "W":
                out["x"] = -number; found = True; index += 2; continue
            if axis == "N":
                out["y"] = number; found = True; index += 2; continue
            if axis == "S":
                out["y"] = -number; found = True; index += 2; continue
            if axis == "U":
                out["z"] = number; found = True; index += 2; continue
            if axis == "D":
                out["z"] = -number; found = True; index += 2; continue
        index += 1
    if found:
        return (out["x"], out["y"], out["z"])
    values = [float(v) for v in NUM_RX.findall(text)]
    if len(values) >= 3:
        return (values[0], values[1], values[2])
    return None


def dist(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def delta(a, b):
    return (b[0] - a[0], b[1] - a[1], b[2] - a[2])


def read_attribute_text(path: Path) -> str:
    if path.suffix.lower() != ".zip":
        return path.read_text(encoding="utf-8-sig", errors="replace")
    with zipfile.ZipFile(path, "r") as archive:
        members = sorted(m for m in archive.namelist() if m.lower().endswith((".txt", ".att")))
        if not members:
            raise SystemExit(f"Attribute ZIP contains no .txt/.att: {path}")
        return archive.read(members[0]).decode("utf-8-sig", errors="replace")


def parse_attribute_records(raw: str) -> list[AttrRecord]:
    roots: list[AttrRecord] = []
    stack: list[AttrRecord] = []
    for line_no, raw_line in enumerate(raw.splitlines(), 1):
        new_match = NEW_RX.match(raw_line)
        if new_match:
            rec = AttrRecord(title=new_match.group("title").strip(), line=line_no, parent=stack[-1] if stack else None)
            if stack:
                stack[-1].children.append(rec)
            else:
                roots.append(rec)
            stack.append(rec)
            continue
        if END_RX.match(raw_line):
            if stack:
                stack.pop()
            continue
        if not stack:
            continue
        for part in raw_line.split("&end&"):
            kv_match = KV_RX.match(part)
            if not kv_match:
                continue
            key = kv_match.group("key").strip().upper().replace(" ", "_")
            value = kv_match.group("value").strip().strip('"')
            stack[-1].attrs[key] = value
    return roots


def flatten(records: list[AttrRecord]):
    for rec in records:
        yield rec
        yield from flatten(rec.children)


def source_inventory(records: list[AttrRecord], raw: str | None = None) -> dict:
    all_records = list(flatten(records))
    type_counts = Counter(r.typ or "UNKNOWN" for r in all_records)
    branches = [r for r in all_records if r.typ == "BRAN"]
    branch_child_types = Counter()
    for branch in branches:
        for child in branch.children:
            if child.typ:
                branch_child_types[child.typ] += 1
    return {
        "records": len(all_records),
        "branches": len(branches),
        "typeCounts": dict(sorted(type_counts.items())),
        "branchChildTypeCounts": dict(sorted(branch_child_types.items())),
        "refs": len(set(REF_RX.findall(raw or ""))),
    }


def get_header(records: list[AttrRecord]) -> dict[str, str]:
    for rec in records:
        if rec.title.lower().startswith("header"):
            return rec.attrs
    return {}


def get_branches(records: list[AttrRecord]) -> list[AttrRecord]:
    return [r for r in flatten(records) if r.typ == "BRAN" and any(c.typ in ROUTE_COMPONENT_TYPES for c in r.children)]


def bore_mm(record: AttrRecord, fallback: float) -> float:
    for key in ("ABORE", "LBORE", "HBOR", "TBOR", "PBORE", "BORE", "NBORE"):
        value = mm(record.attrs.get(key))
        if value and value > 0:
            return value
    return fallback


def branch_temp(branch: AttrRecord, default: float) -> float:
    value = first_float(branch.attrs.get("TEMP"), default)
    return value if abs(value + 100000.0) > 1e-6 else default


def branch_pressure(branch: AttrRecord, default: float) -> float:
    value = first_float(branch.attrs.get("PRES"), default)
    return value if abs(value + 100000.0) > 1e-6 else default


def point_for(record: AttrRecord, *keys: str):
    for key in keys:
        point = parse_point(record.attrs.get(key))
        if point is not None:
            return point
    return None


def bend_radius(record: AttrRecord, default_radius: float) -> float:
    for key in ("BRAD", "BENDRADIUS", "BEND_RADIUS", "RADI", "RADIUS"):
        value = mm(record.attrs.get(key))
        if value and value > 1e-9:
            return value
    return max(default_radius, bore_mm(record, 100.0) * 1.5)


def rigid_weight(record: AttrRecord) -> float:
    return max(0.0, first_float(record.attrs.get("WEIGHT") or record.attrs.get(":WEIGHT"), 0.0))


def fmt(value: float) -> str:
    if not math.isfinite(value):
        value = SENTINEL
    return f"{value:.6f}"


class NodeAllocator:
    def __init__(self, start=10, step=10):
        self.next_node = int(start)
        self.step = int(step)
        self.by_point: dict[tuple[int, int, int], int] = {}

    def node_for(self, point) -> int:
        key = tuple(int(round(c * 1000)) for c in point)
        if key in self.by_point:
            return self.by_point[key]
        node = self.next_node
        self.next_node += self.step
        self.by_point[key] = node
        return node


def add_common_attrs(element: ET.Element, from_node: int, to_node: int, a, b, diameter, opts, branch: AttrRecord, name="") -> None:
    dx, dy, dz = delta(a, b)
    attrs = {
        "FROM_NODE": fmt(float(from_node)),
        "TO_NODE": fmt(float(to_node)),
        "DELTA_X": fmt(dx),
        "DELTA_Y": fmt(dy),
        "DELTA_Z": fmt(dz),
        "DIAMETER": fmt(diameter),
        "WALL_THICK": fmt(getattr(opts, "default_wall_thickness", 0.01)),
        "INSUL_THICK": fmt(getattr(opts, "default_insulation_thickness", 0.0)),
        "CORR_ALLOW": fmt(getattr(opts, "default_corrosion_allowance", 0.0)),
        "TEMP_EXP_C1": fmt(branch_temp(branch, getattr(opts, "default_temperature", 21.0))),
        "TEMP_EXP_C2": fmt(SENTINEL),
        "TEMP_EXP_C3": fmt(SENTINEL),
        "PRESSURE1": fmt(branch_pressure(branch, getattr(opts, "default_pressure", 0.0))),
        "PRESSURE2": fmt(SENTINEL),
        "PRESSURE3": fmt(SENTINEL),
        "MATERIAL_NUM": "0.000000",
        "MATERIAL_NAME": "",
        "NAME": name or "",
    }
    for key, value in attrs.items():
        element.set(key, value)


def make_element(parent: ET.Element, from_node: int, to_node: int, p1, p2, diameter: float, opts, branch: AttrRecord, name="") -> ET.Element | None:
    if p1 is None or p2 is None or dist(p1, p2) <= getattr(opts, "min_element_length", 1e-3):
        return None
    element = ET.SubElement(parent, "PIPINGELEMENT")
    add_common_attrs(element, from_node, to_node, p1, p2, diameter, opts, branch, name=name)
    return element


def restraint_direction(record: AttrRecord, default_axis: str) -> tuple[float, float, float, int]:
    text = " ".join(clean(v).upper() for v in record.attrs.values())
    if "GUIDE" in text:
        return (1.0, 0.0, 0.0, 1)
    if "LINE" in text and "STOP" in text:
        return (0.0, 1.0, 0.0, 3)
    if "ANCHOR" in text or "FIX" in text:
        return (0.0, 0.0, 0.0, 17)
    axis = default_axis.upper()
    if axis == "X":
        return (1.0, 0.0, 0.0, 1)
    if axis == "Z":
        return (0.0, 0.0, 1.0, 3)
    return (0.0, 1.0, 0.0, 3)


def add_bend_aux(parent: ET.Element, record: AttrRecord, node: int, radius: float):
    ET.SubElement(parent, "BEND", {
        "RADIUS": fmt(radius),
        "TYPE": "0.000000",
        "ANGLE1": "0.000000",
        "NODE1": fmt(float(node)),
        "ANGLE2": fmt(SENTINEL),
        "NODE2": fmt(SENTINEL),
        "ANGLE3": fmt(SENTINEL),
        "NODE3": fmt(SENTINEL),
        "NUM_MITER": "0.000000",
        "FITTINGTHICKNESS": fmt(SENTINEL),
        "KFACTOR": fmt(SENTINEL),
    })


def add_rigid_aux(parent: ET.Element, record: AttrRecord):
    ET.SubElement(parent, "RIGID", {"WEIGHT": fmt(rigid_weight(record)), "TYPE": record.attrs.get("DTXR") or record.typ})


def add_sif_aux(parent: ET.Element, node: int):
    ET.SubElement(parent, "SIF", {"NODE": fmt(float(node))})


def add_restraint_aux(parent: ET.Element, record: AttrRecord, node: int, opts):
    x, y, z, typ = restraint_direction(record, getattr(opts, "default_restraint_axis", "Y"))
    ET.SubElement(parent, "RESTRAINT", {
        "NUM": "1",
        "NODE": fmt(float(node)),
        "TYPE": fmt(float(typ)),
        "STIFFNESS": fmt(getattr(opts, "default_restraint_stiffness", 1.75127e12)),
        "GAP": fmt(getattr(opts, "default_restraint_gap", SENTINEL)),
        "FRIC_COEF": fmt(getattr(opts, "default_restraint_friction", SENTINEL)),
        "CNODE": fmt(SENTINEL),
        "XCOSINE": fmt(x),
        "YCOSINE": fmt(y),
        "ZCOSINE": fmt(z),
        "TAG": record.name,
        "GUID": "",
    })


def convert_attribute_txt_to_inputxml(input_path: Path, output_path: Path, opts) -> dict:
    raw = read_attribute_text(input_path)
    records = parse_attribute_records(raw)
    header = get_header(records)
    branches = get_branches(records)
    if not branches:
        raise SystemExit("Attribute TXT contains no BRAN records with route components.")

    root = ET.Element("CAESARII", {"xmlns": "COADE", "VERSION": getattr(opts, "version", "11.00"), "XML_TYPE": "Input"})
    job_name = header.get("ELEMENT") or header.get("PROJECT") or input_path.stem
    model = ET.SubElement(root, "PIPINGMODEL", {
        "xmlns": "",
        "JOBNAME": clean(job_name),
        "TIME": getattr(opts, "time", "") or datetime.now().strftime("%Y/%m/%d %H:%M:%S"),
        "ISSUE_NO": "",
        "NUMELT": "0",
        "NUMBEND": "0",
        "NUMRIGID": "0",
        "NUMREST": "0",
        "NUMALLOW": "0",
        "NUMNOZ": "0",
        "NOHGRS": "0",
        "NUMEXPJNT": "0",
        "NUMFORCMNT": "0",
        "NUMUNFLOAD": "0",
        "NUMWIND": "0",
        "NUMELEOFF": "0",
        "NUMISECT": "0",
        "NORTH_Z": "-1",
        "NORTH_Y": "0",
        "NORTH_X": "0",
    })

    allocator = NodeAllocator(getattr(opts, "node_start", 10), getattr(opts, "node_step", 10))
    counts = Counter()
    skipped = Counter()
    default_diameter = getattr(opts, "default_diameter", 100.0)

    for branch in branches:
        current = point_for(branch, "HPOS", "POS")
        tail = point_for(branch, "TPOS")
        if current is None:
            skipped["branch_no_hpos"] += 1
            continue
        current_node = allocator.node_for(current)
        current_dia = bore_mm(branch, default_diameter)

        for child in branch.children:
            typ = child.typ
            if typ not in ROUTE_COMPONENT_TYPES:
                continue
            apos = point_for(child, "APOS")
            lpos = point_for(child, "LPOS")
            pos = point_for(child, "POS", "PPOS", "BPOS")
            target = pos or lpos or apos
            if target is None:
                skipped[f"{typ}_no_point"] += 1
                continue
            child_dia = bore_mm(child, current_dia)

            if typ in BEND_TYPES:
                bend_node = allocator.node_for(target)
                element = make_element(model, current_node, bend_node, current, target, current_dia, opts, branch, name=child.name)
                if element is not None:
                    add_bend_aux(element, child, bend_node, bend_radius(child, current_dia * 1.5))
                    counts["elements"] += 1; counts["bends"] += 1
                current, current_node = target, bend_node
                if lpos is not None and dist(current, lpos) > getattr(opts, "min_element_length", 1e-3):
                    next_node = allocator.node_for(lpos)
                    element2 = make_element(model, current_node, next_node, current, lpos, child_dia, opts, branch)
                    if element2 is not None:
                        counts["elements"] += 1
                    current, current_node = lpos, next_node
                current_dia = child_dia
                continue

            if typ in SIF_TYPES:
                sif_node = allocator.node_for(target)
                element = make_element(model, current_node, sif_node, current, target, current_dia, opts, branch, name=child.name)
                if element is not None:
                    add_sif_aux(element, sif_node)
                    counts["elements"] += 1; counts["sifs"] += 1
                current, current_node = target, sif_node
                if lpos is not None and dist(current, lpos) > getattr(opts, "min_element_length", 1e-3):
                    next_node = allocator.node_for(lpos)
                    element2 = make_element(model, current_node, next_node, current, lpos, child_dia, opts, branch)
                    if element2 is not None:
                        counts["elements"] += 1
                    current, current_node = lpos, next_node
                current_dia = child_dia
                continue

            endpoint = lpos or target
            end_node = allocator.node_for(endpoint)
            diameter = child_dia if typ in REDUCER_TYPES else current_dia
            element = make_element(model, current_node, end_node, current, endpoint, diameter, opts, branch, name=child.name)
            if element is None:
                if typ in SUPPORT_TYPES and len(model):
                    add_restraint_aux(list(model)[-1], child, current_node, opts)
                    counts["restraints"] += 1
                else:
                    skipped[f"{typ}_zero_length"] += 1
                continue
            counts["elements"] += 1
            if typ in RIGID_TYPES:
                add_rigid_aux(element, child); counts["rigids"] += 1
            elif typ in SUPPORT_TYPES:
                add_restraint_aux(element, child, end_node, opts); counts["restraints"] += 1
            elif typ in REDUCER_TYPES:
                counts["reducersSource"] += 1
            current, current_node = endpoint, end_node
            current_dia = child_dia

        if tail is not None and dist(current, tail) > getattr(opts, "min_element_length", 1e-3):
            tail_node = allocator.node_for(tail)
            tail_element = make_element(model, current_node, tail_node, current, tail, current_dia, opts, branch)
            if tail_element is not None:
                counts["elements"] += 1

    model.set("NUMELT", str(counts["elements"]))
    model.set("NUMBEND", str(counts["bends"]))
    model.set("NUMRIGID", str(counts["rigids"]))
    model.set("NUMREST", str(counts["restraints"]))
    model.set("NUMISECT", str(counts["sifs"]))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(root).write(output_path, encoding="utf-8", xml_declaration=True)
    return {
        "input": str(input_path),
        "output": str(output_path),
        "sourceInventory": source_inventory(records, raw),
        "inputXmlCounts": dict(counts),
        "skipped": dict(skipped),
        "nodesAllocated": len(allocator.by_point),
    }


def write_inventory_json(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
