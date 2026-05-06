#!/usr/bin/env python3
"""Convert AVEVA/RMSS attribute TXT directly to XSD-clean PSI116 XML.

Scope:
- Upstream XML only. Does not run or modify XML->CII.
- Emits XML matching XML TO CII/PSI116.xsd element order and namespace.
- Keeps current xml_to_cii.py compatibility by emitting at most one Restraint per Node.
"""
from __future__ import annotations

import argparse
import math
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

PSI116_NS = "http://aveva.com/pipestress116.xsd"

BORE_KEYS = ("HBOR", "TBOR", "ABORE", "LBORE", "BORE", "NBORE", "DBOR")
SUPPORT_COORD_KEYS = (
    "SUPPORTCOORD", "SUPPORT_COORD", "SCOORD", "SUPPORT_POS", "SUPPORTPOS",
    "COORDS", "CO_ORDS", "CO_ORD", "POS", "POSITION", "BPOS", "BP", "APOS", "LPOS",
)
KEY_VALUE_RE = re.compile(r"^\s*:?(?P<key>[A-Za-z][A-Za-z0-9_\-]*)\s*(?::=|=|:)\s*(?P<value>.*?)\s*$")
PS_TAG_RE = re.compile(r"\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b", re.I)
SUPPORT_TEXT_RE = re.compile(
    r"\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b",
    re.I,
)
TYPE_RULES = (
    (re.compile(r"WELDOLET|SOCKOLET|THREDOLET|SWEEPOLET|\bOLET\b", re.I), "OLET"),
    (re.compile(r"\bVALV(E)?\b", re.I), "VALV"),
    (re.compile(r"\bFLAN(GE)?\b", re.I), "FLAN"),
    (re.compile(r"\bGASK(ET)?\b", re.I), "GASK"),
    (re.compile(r"\b(ELBO(W)?|BEND)\b", re.I), "ELBO"),
    (re.compile(r"\bTEE\b", re.I), "TEE"),
    (re.compile(r"\bREDU(CER)?\b", re.I), "REDU"),
    (re.compile(r"\b(ATTA|ANCI|SUPP|SUPPORT|REST|GUIDE|LINE\s*STOP|LINESTOP|LIMIT|ANCHOR|FIXED|SHOE|BP|BASE\s*PLATE)\b", re.I), "ATTA"),
    (re.compile(r"\b(PIPE|TUBI)\b", re.I), "PIPE"),
)
SIGNED_AXIS_RE = re.compile(r"([+-]?)\s*([XYZ])\b", re.I)


def text(value) -> str:
    return "" if value is None else str(value)


def clean(value) -> str:
    return text(value).strip()


def xml_escape(value) -> str:
    return escape(text(value), {'"': "&quot;"})


def finite(value, default=0.0) -> float:
    try:
        n = float(value)
        return n if math.isfinite(n) else default
    except Exception:
        return default


def mm(value):
    match = re.search(r"-?\d+(?:\.\d+)?", text(value).replace("mm", " ").replace("MM", " "))
    return float(match.group(0)) if match else None


def number_text(value, decimals=3) -> str:
    rendered = f"{finite(value):.{decimals}f}".rstrip("0").rstrip(".")
    return rendered or "0"


def int_text(value) -> str:
    try:
        return str(int(round(finite(value, 0.0))))
    except Exception:
        return "0"


def parse_coord(value):
    if value is None or value == "":
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        p = tuple(finite(value[i], float("nan")) for i in range(3))
        return p if all(math.isfinite(v) for v in p) else None
    if isinstance(value, dict):
        p = (
            finite(value.get("x", value.get("X")), float("nan")),
            finite(value.get("y", value.get("Y")), float("nan")),
            finite(value.get("z", value.get("Z")), float("nan")),
        )
        return p if all(math.isfinite(v) for v in p) else None
    raw = text(value).strip()
    tokens = raw.split()
    out = {"x": 0.0, "y": 0.0, "z": 0.0}
    directional = False
    for i in range(0, max(len(tokens) - 1, 0), 2):
        axis = tokens[i].upper()
        val = mm(tokens[i + 1])
        if val is None:
            continue
        if axis == "E":
            out["x"] = val; directional = True
        elif axis == "W":
            out["x"] = -val; directional = True
        elif axis == "N":
            out["y"] = val; directional = True
        elif axis == "S":
            out["y"] = -val; directional = True
        elif axis == "U":
            out["z"] = val; directional = True
        elif axis == "D":
            out["z"] = -val; directional = True
    if directional:
        return (out["x"], out["y"], out["z"])
    vals = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", raw)]
    return tuple(vals[:3]) if len(vals) >= 3 else None


def parse_blocks(raw: str) -> list[dict[str, str]]:
    blocks = []
    current = None
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r"^NEW(\s|$)", line, re.I):
            if current:
                blocks.append(current)
            current = {"__RAW__": raw_line, "__NEW__": line[3:].strip()}
            continue
        if re.match(r"^END(\s|$)", line, re.I):
            if current:
                blocks.append(current)
                current = None
            continue
        if current is None:
            current = {"__RAW__": ""}
        current["__RAW__"] = f"{current.get('__RAW__', '')}\n{raw_line}".strip()
        match = KEY_VALUE_RE.match(line)
        if match:
            key = match.group("key").upper().replace("-", "_")
            current[key] = match.group("value").strip().strip('"')
    if current:
        blocks.append(current)
    return blocks


def read_attribute_text(path: Path) -> str:
    if path.suffix.lower() != ".zip":
        return path.read_text(encoding="utf-8", errors="replace")
    with zipfile.ZipFile(path, "r") as archive:
        members = sorted(m for m in archive.namelist() if m.lower().endswith((".att", ".txt")))
        if not members:
            raise SystemExit(f"Attribute ZIP contains no .att/.txt file: {path}")
        with archive.open(members[0], "r") as handle:
            return handle.read().decode("utf-8", errors="replace")


def combined_text(block: dict) -> str:
    return " ".join(text(block.get(k, "")) for k in (
        "__NEW__", "__RAW__", "TYPE", "STYP", "NAME", "TAG", "TAGNO", "SKEY", "SPRE",
        "DTXR", "CMPSUPTYPE", "SUPPORT_TYPE", "DESCRIPTION", "DESC",
    ))


def support_kind(block: dict) -> str:
    src = combined_text(block).upper()
    if re.search(r"\bLINE\s*STOP\b|\bLINESTOP\b|\bSTOPPER\b|\bSTOP\b", src):
        return "LINESTOP"
    if re.search(r"\bLIMIT\s*STOP\b|\bLIMIT\b", src):
        return "LIMIT"
    if re.search(r"\bGUIDE\b", src):
        return "GUIDE"
    if re.search(r"\bRESTING\b|\bREST\b|\bSHOE\b|\bBP\b|\bBASE\s*PLATE\b", src):
        return "REST"
    if re.search(r"\bANCHOR\b|\bFIXED\b", src):
        return "ANCHOR"
    return ""


def component_type(block: dict) -> str:
    if support_kind(block):
        return "ATTA"
    src = combined_text(block)
    for pattern, typ in TYPE_RULES:
        if pattern.search(src):
            return typ
    return "UNKNOWN"


def support_tag(block: dict) -> str:
    for key in ("CMPSUPREFN", "SUPPORT_TAG", "NAME", "TAG", "TAGNO", "ITEMCODE", "PARTNO", "REF", "REFNO", "DBREF", "COMPONENTREFNO", "CA97", "CA98", "SKEY", "SPRE", "__NEW__", "__RAW__"):
        match = PS_TAG_RE.search(text(block.get(key, "")))
        if match:
            return re.sub(r"\s+", "-", match.group(0).strip())
    return clean(block.get("CMPSUPREFN") or block.get("NAME") or block.get("__NEW__") or "SUPPORT")


def point_from_block(block: dict, keys):
    for key in keys:
        p = parse_coord(block.get(key))
        if p:
            return p
    return None


def points(block: dict) -> dict:
    return {
        "apos": point_from_block(block, ("APOS", "A_POS", "EP1", "END1", "START", "START_POINT", "POS_START")),
        "lpos": point_from_block(block, ("LPOS", "L_POS", "EP2", "END2", "END", "END_POINT", "POS_END")),
        "pos": point_from_block(block, ("POS", "POSITION", "COORDS", "CO_ORDS", "CO_ORD")),
        "cpos": point_from_block(block, ("CPOS", "CP", "CENTER", "CENTRE", "CENTER_POINT")),
        "bpos": point_from_block(block, ("BPOS", "BP", "BRANCH_POINT", "BPOS1")),
        "support": point_from_block(block, SUPPORT_COORD_KEYS),
    }


def bore(block: dict, default: float) -> float:
    for key in BORE_KEYS:
        val = mm(block.get(key))
        if val and val > 0:
            return val
    if block.get("DTXR") and not SUPPORT_TEXT_RE.search(clean(block.get("DTXR"))):
        val = mm(block.get("DTXR"))
        if val and val > 0:
            return val
    return default


def axis_name(value: str) -> str:
    value = clean(value).upper()
    if value in ("+X", "-X", "X", "+Y", "-Y", "Y", "+Z", "-Z", "Z"):
        return value
    match = SIGNED_AXIS_RE.search(value)
    if match:
        return f"{match.group(1)}{match.group(2).upper()}" if match.group(1) else match.group(2).upper()
    return ""


def unsigned(axis: str) -> str:
    return axis_name(axis).replace("+", "").replace("-", "")


def dominant_axis(a, b) -> str:
    if not a or not b:
        return ""
    deltas = [abs(b[i] - a[i]) for i in range(3)]
    return ("X", "Y", "Z")[deltas.index(max(deltas))] if max(deltas) > 1e-9 else ""


def pipe_axis(block: dict, ps: dict, opt) -> str:
    for key in ("RESTRAINT_DIRECTION", "RESTRAINTDIR", "DIRECTION", "DIR", "AXIS", "PIPE_AXIS", "ROUTE_AXIS"):
        value = axis_name(block.get(key, ""))
        if value:
            return unsigned(value)
    return dominant_axis(ps.get("apos"), ps.get("lpos")) or unsigned(opt.support_pipe_axis) or "X"


def single_guide_axis(axial: str, vertical: str) -> str:
    transverse = [axis for axis in ("X", "Y", "Z") if axis != axial]
    non_vertical = [axis for axis in transverse if axis != vertical]
    return (non_vertical or transverse or ["Y"])[0]


def restraint_entry(rtype: str, gap: str, opt) -> dict:
    return {"type": rtype, "stiffness": clean(opt.support_stiffness), "gap": clean(gap), "friction": clean(opt.support_friction)}


def restraint(block: dict, ps: dict, opt) -> list[dict]:
    """Return zero or one restraint to match current xml_to_cii.py."""
    kind = support_kind(block)
    if not kind:
        return []
    vertical = unsigned(opt.vertical_axis) or "Y"
    axial = pipe_axis(block, ps, opt)
    if kind == "GUIDE":
        return [restraint_entry(single_guide_axis(axial, vertical), clean(opt.guide_gap) or clean(opt.support_gap), opt)]
    if kind == "LINESTOP":
        return [restraint_entry(axis_name(opt.line_stop_direction) or axial, clean(opt.line_stop_gap) or clean(opt.support_gap), opt)]
    if kind == "LIMIT":
        return [restraint_entry(axis_name(opt.limit_direction) or axial, clean(opt.limit_gap) or clean(opt.support_gap), opt)]
    if kind == "REST":
        return [restraint_entry(axis_name(opt.rest_direction) or vertical, clean(opt.rest_gap) or clean(opt.support_gap), opt)]
    if kind == "ANCHOR":
        return [restraint_entry("A", clean(opt.anchor_gap) or clean(opt.support_gap), opt)]
    return []


class Context:
    def __init__(self, opt):
        self.opt = opt
        self.node = max(1, int(finite(opt.node_start, 10)))
        self.step = max(1, int(finite(opt.node_step, 10)))
        self.default_diameter = max(0.001, finite(opt.default_diameter, 100))
        self.default_wall = max(0.0, finite(opt.default_wall_thickness, 0.01))
        self.default_corr = max(0.0, finite(opt.default_corrosion_allowance, 0))
        self.default_insu = max(0.0, finite(opt.default_insulation_thickness, 0))
        self.auto_ref = 1

    def next(self):
        n = self.node
        self.node += self.step
        return n

    def ref(self):
        value = f"AUTO-{self.auto_ref}"
        self.auto_ref += 1
        return value


def distance(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3))) if a and b else 0.0


def bend_radius(block, ps):
    val = mm(block.get("BENDRADIUS") or block.get("BEND_RADIUS") or block.get("BRAD") or block.get("RADIUS"))
    if val and val > 0:
        return val
    center = ps.get("cpos") or ps.get("pos")
    return min(distance(center, ps.get("apos")), distance(center, ps.get("lpos"))) if center and ps.get("apos") and ps.get("lpos") else 0.0


def make_node(block, typ, endpoint, pos, ctx: Context, number=-1, bend_radius_value=0, bend_type=None, alpha=None):
    kind = support_kind(block) if typ == "ATTA" else ""
    tag = support_tag(block) if typ == "ATTA" else ""
    ps = points(block)
    return {
        "number": number,
        "name": tag or clean(block.get("NAME") or block.get("TAG") or block.get("__NEW__")),
        "endpoint": endpoint,
        "ctype": typ,
        "ref": tag or clean(block.get("COMPONENTREFNO") or block.get("REFNO") or block.get("REF") or block.get("DBREF")) or ctx.ref(),
        "conn": kind or clean(block.get("CONNECTIONTYPE") or block.get("CONN") or block.get("CONNECTION") or block.get("CREF") or block.get("CTYP")),
        "od": bore(block, ctx.default_diameter),
        "wall": mm(block.get("WTHK") or block.get("WALLTHK") or block.get("WALL_THICKNESS")) or ctx.default_wall,
        "corr": mm(block.get("CORA") or block.get("CORROSIONALLOWANCE")) or ctx.default_corr,
        "insu": mm(block.get("INSU") or block.get("INSULATIONTHICKNESS")) or ctx.default_insu,
        "pos": pos,
        "br": bend_radius_value,
        "bt": bend_type,
        "alpha": alpha,
        "sif": int_text(block.get("SIF")),
        "weight": finite(block.get("WEIG") or block.get("WEIGHT"), 0),
        "restraints": restraint(block, ps, ctx.opt) if typ == "ATTA" else [],
    }


def expand(block, ctx: Context):
    typ = component_type(block)
    ps = points(block)
    base = ps.get("support") or ps.get("pos") or ps.get("cpos") or ps.get("apos") or ps.get("lpos") or ps.get("bpos")
    if typ == "UNKNOWN" or not base:
        return []
    if typ == "ELBO":
        radius = bend_radius(block, ps)
        return [
            make_node(block, typ, 1, ps.get("apos") or base, ctx, -1, radius, 0),
            make_node(block, typ, 0, ps.get("cpos") or ps.get("pos") or base, ctx, ctx.next(), radius, 1),
            make_node(block, typ, 2, ps.get("lpos") or base, ctx, -1, radius, 0),
        ]
    if typ in ("TEE", "OLET"):
        center = ps.get("pos") or ps.get("cpos") or base
        return [
            make_node(block, typ, 1, ps.get("apos") or center, ctx),
            make_node(block, typ, 3, ps.get("bpos") or ps.get("lpos") or center, ctx),
            make_node(block, typ, 0, center, ctx, ctx.next()),
            make_node(block, typ, 2, ps.get("lpos") or center, ctx),
        ]
    if typ == "REDU":
        alpha = mm(block.get("ALPHAANGLE") or block.get("ALPHA_ANGLE") or block.get("ANGLE")) or 1.0
        return [
            make_node(block, typ, 1, ps.get("apos") or base, ctx),
            make_node(block, typ, 0, ps.get("pos") or base, ctx, ctx.next(), alpha=alpha),
            make_node(block, typ, 2, ps.get("lpos") or base, ctx),
        ]
    if typ == "ATTA":
        return [make_node(block, typ, 0, base, ctx, ctx.next())]
    if ps.get("apos") and ps.get("lpos"):
        return [
            make_node(block, typ, 1, ps["apos"], ctx),
            make_node(block, typ, 0, ps.get("pos") or ps["apos"], ctx, ctx.next()),
            make_node(block, typ, 2, ps["lpos"], ctx),
        ]
    return [make_node(block, typ, 0, base, ctx, ctx.next())]


def node_xml(node: dict) -> str:
    pos = node["pos"]
    lines = [
        "      <Node>",
        f"        <NodeNumber>{node['number']}</NodeNumber>",
        f"        <NodeName>{xml_escape(node['name'])}</NodeName>",
        f"        <Endpoint>{node['endpoint']}</Endpoint>",
        f"        <ComponentType>{xml_escape(node['ctype'])}</ComponentType>",
        f"        <Weight>{number_text(node['weight'])}</Weight>",
        f"        <ComponentRefNo>{xml_escape(node['ref'])}</ComponentRefNo>",
        f"        <ConnectionType>{xml_escape(node['conn'])}</ConnectionType>",
        f"        <OutsideDiameter>{number_text(node['od'])}</OutsideDiameter>",
        f"        <WallThickness>{number_text(node['wall'])}</WallThickness>",
        f"        <CorrosionAllowance>{number_text(node['corr'])}</CorrosionAllowance>",
    ]
    if node["alpha"] is not None:
        lines.append(f"        <AlphaAngle>{number_text(node['alpha'])}</AlphaAngle>")
    lines.extend([
        f"        <InsulationThickness>{number_text(node['insu'])}</InsulationThickness>",
        f"        <Position>{pos[0]:.2f} {pos[1]:.2f} {pos[2]:.2f}</Position>",
        f"        <BendRadius>{number_text(node['br'])}</BendRadius>",
    ])
    if node["bt"] is not None:
        lines.append(f"        <BendType>{int_text(node['bt'])}</BendType>")
    lines.append(f"        <SIF>{int_text(node['sif'])}</SIF>")
    for r in node.get("restraints") or []:
        lines.extend([
            "        <Restraint>",
            f"          <Type>{xml_escape(r.get('type', ''))}</Type>",
            f"          <Stiffness>{xml_escape(r.get('stiffness', ''))}</Stiffness>",
            f"          <Gap>{xml_escape(r.get('gap', ''))}</Gap>",
            f"          <Friction>{xml_escape(r.get('friction', ''))}</Friction>",
            "        </Restraint>",
        ])
        break
    lines.append("      </Node>")
    return "\n".join(lines)


def convert(input_path: Path, output_path: Path, opt):
    blocks = parse_blocks(read_attribute_text(input_path))
    ctx = Context(opt)
    project = input_path.stem
    count = skipped = restraint_count = 0
    bytype = {}
    lines = ["<?xml version=\"1.0\" encoding=\"utf-8\"?>", f'<PipeStressExport xmlns="{PSI116_NS}">']
    lines.extend([
        "  <DateTime></DateTime>",
        f"  <Source>{xml_escape(opt.source)}</Source>",
        "  <Version>0.0.0.0</Version>",
        "  <UserName>browser-runtime</UserName>",
        f"  <Purpose>{xml_escape(opt.purpose)}</Purpose>",
        f"  <ProjectName>{xml_escape(project)}</ProjectName>",
        f"  <MDBName>/{xml_escape(project)}</MDBName>",
        f"  <TitleLine>{xml_escape(opt.title_line)}</TitleLine>",
        "  <RestrainOpenEnds>No</RestrainOpenEnds>",
        "  <AmbientTemperature>0</AmbientTemperature>",
        "  <Pipe>",
        f"    <FullName>/{xml_escape(project)}</FullName>",
        "    <Ref></Ref>",
        "    <Branch>",
        f"      <Branchname>{xml_escape(project)}</Branchname>",
    ])
    lines.append("      <Temperature>" + "".join(f"<Temperature{i}>-100000</Temperature{i}>" for i in range(1, 10)) + "</Temperature>")
    lines.append("      <Pressure>" + "".join(f"<Pressure{i}>0</Pressure{i}>" for i in range(1, 10)) + "</Pressure>")
    lines.extend(["      <MaterialNumber>0</MaterialNumber>", "      <InsulationDensity>0</InsulationDensity>", "      <FluidDensity>0</FluidDensity>"])
    for block in blocks:
        nodes = expand(block, ctx)
        if not nodes:
            skipped += 1
            continue
        for node in nodes:
            lines.append(node_xml(node))
            count += 1
            restraint_count += 1 if node.get("restraints") else 0
            bytype[node["ctype"]] = bytype.get(node["ctype"], 0) + 1
    lines.extend([
        "    </Branch>",
        "  </Pipe>",
        f"  <!-- Attribute TXT XSD-clean upstream XML generated {count} Node records; support restraints {restraint_count}; skipped {skipped}. Counts: {bytype} -->",
        "</PipeStressExport>",
    ])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {output_path} with {count} XML nodes; support restraints {restraint_count}; preserved counts: {bytype}; skipped {skipped}.")


def main():
    parser = argparse.ArgumentParser(description="Convert AVEVA/RMSS attribute TXT to XSD-clean PSI116 XML.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--node-start", type=int, default=10)
    parser.add_argument("--node-step", type=int, default=10)
    parser.add_argument("--source", default="AVEVA PSI")
    parser.add_argument("--purpose", default="RMSS attribute TXT conversion")
    parser.add_argument("--title-line", default="RMSS Attribute TXT Output")
    parser.add_argument("--default-diameter", type=float, default=100.0)
    parser.add_argument("--default-wall-thickness", type=float, default=0.01)
    parser.add_argument("--default-insulation-thickness", type=float, default=0.0)
    parser.add_argument("--default-corrosion-allowance", type=float, default=0.0)
    parser.add_argument("--support-stiffness", default="")
    parser.add_argument("--support-gap", default="")
    parser.add_argument("--support-friction", default="0.3")
    parser.add_argument("--guide-gap", default="")
    parser.add_argument("--line-stop-gap", default="")
    parser.add_argument("--limit-gap", default="")
    parser.add_argument("--rest-gap", default="")
    parser.add_argument("--anchor-gap", default="")
    parser.add_argument("--support-pipe-axis", default="X")
    parser.add_argument("--vertical-axis", default="Y")
    parser.add_argument("--line-stop-direction", default="")
    parser.add_argument("--limit-direction", default="")
    parser.add_argument("--rest-direction", default="")
    args = parser.parse_args()
    convert(args.input, args.output, args)


if __name__ == "__main__":
    main()
