#!/usr/bin/env python3
"""Convert staged hierarchy JSON to XSD-clean PSI116 XML without dropping fittings/supports.

Scope:
- Upstream XML only. Do not depend on, or require changes in, xml_to_cii.py.
- Emit XML matching XML TO CII/PSI116.xsd element order and namespace.
- Emit CII-detectable fitting center nodes:
  ELBO endpoint 0 + BendType/BendRadius, TEE/OLET endpoint 0, REDU endpoint 0 + AlphaAngle.
- Emit only one Restraint per support node because current xml_to_cii.py accepts one.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from xml.sax.saxutils import escape

PSI116_NS = "http://aveva.com/pipestress116.xsd"

BORE_KEYS = ("HBOR", "TBOR", "ABORE", "LBORE", "BORE", "NBORE", "DBOR")
SUPPORT_COORD_KEYS = (
    "SUPPORTCOORD", "SUPPORT_COORD", "SCOORD", "SUPPORT_POS", "SUPPORTPOS",
    "COORDS", "CO_ORDS", "CO_ORD", "POS", "POSITION", "BPOS", "BP", "APOS", "LPOS",
)
SUPPORT_TAG_RX = re.compile(r"\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b", re.I)
SUPPORT_TEXT_RX = re.compile(
    r"\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b",
    re.I,
)
SIGNED_AXIS_RX = re.compile(r"([+-]?)\s*([XYZ])\b", re.I)
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


def text(value) -> str:
    return "" if value is None else str(value)


def clean(value) -> str:
    return text(value).strip()


def xml_escape(value) -> str:
    return escape(text(value), {'"': "&quot;"})


def finite(value, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except Exception:
        return default


def number_text(value, decimals: int = 3) -> str:
    rendered = f"{finite(value):.{decimals}f}".rstrip("0").rstrip(".")
    return rendered or "0"


def int_text(value) -> str:
    try:
        return str(int(round(finite(value, 0.0))))
    except Exception:
        return "0"


def mm(value):
    match = re.search(r"-?\d+(?:\.\d+)?", text(value).replace("mm", " ").replace("MM", " "))
    return float(match.group(0)) if match else None


def attrs(obj) -> dict:
    out = {}
    if isinstance(obj, dict):
        for key in ("attributes", "attrs", "attr", "rawAttributes", "raw_attributes", "normalized"):
            if isinstance(obj.get(key), dict):
                out.update(obj[key])
        for key, value in obj.items():
            if key not in {"children", "items", "branches", "attributes", "attrs", "attr", "rawAttributes", "raw_attributes", "normalized"}:
                if isinstance(value, (str, int, float, bool, list, tuple, dict)):
                    out.setdefault(key, value)
    return out


def first(values: dict, keys) -> str:
    for key in keys:
        if key in values and clean(values[key]):
            return values[key]
    return ""


def object_text(obj, values: dict) -> str:
    parts = []
    if isinstance(obj, dict):
        parts.extend([obj.get("type"), obj.get("kind"), obj.get("name"), obj.get("path"), obj.get("id")])
    parts.extend(values.get(k) for k in (
        "TYPE", "STYP", "SPRE", "PTYPE", "DETAIL", "NAME", "TAG", "TAGNO", "ITEMCODE",
        "PARTNO", "SKEY", "DTXR", "SUPPORT_TYPE", "CMPSUPTYPE", "DESCRIPTION", "DESC", "CONNECTIONTYPE",
    ))
    return " ".join(clean(v) for v in parts if clean(v))


def normalize_support_kind(obj, values: dict) -> str:
    src = object_text(obj, values).upper()
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


def extract_support_tag(obj, values: dict) -> str:
    candidates = []
    if isinstance(obj, dict):
        candidates.extend([obj.get("name"), obj.get("path"), obj.get("id")])
    candidates.extend(values.get(k) for k in (
        "SUPPORT_TAG", "CMPSUPREFN", "NAME", "TAG", "TAGNO", "ITEMCODE", "PARTNO",
        "REF", "REFNO", "DBREF", "COMPONENTREFNO", "CA97", "CA98", "SKEY", "SPRE", "DESCRIPTION", "DESC",
    ))
    for candidate in candidates:
        match = SUPPORT_TAG_RX.search(clean(candidate))
        if match:
            return re.sub(r"\s+", "-", match.group(0).strip())
    return clean(first(values, ("CMPSUPREFN", "SUPPORT_TAG", "NAME", "TAG", "TAGNO")))


def point(value):
    if value in (None, ""):
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
    vals = [float(q) for q in re.findall(r"-?\d+(?:\.\d+)?", text(value))]
    return tuple(vals[:3]) if len(vals) >= 3 else None


def get_point(obj, values: dict, keys):
    for key in keys:
        value = values.get(key)
        if value is None and isinstance(obj, dict):
            value = obj.get(key)
        p = point(value)
        if p:
            return p
    return None


def points(obj) -> dict:
    values = attrs(obj)
    return {
        "apos": get_point(obj, values, ("APOS", "A_POS", "EP1", "END1", "START", "START_POINT", "POS_START")),
        "lpos": get_point(obj, values, ("LPOS", "L_POS", "EP2", "END2", "END", "END_POINT", "POS_END")),
        "pos": get_point(obj, values, ("POS", "POSITION", "COORDS", "CO_ORDS", "CO_ORD", "POSS")),
        "cpos": get_point(obj, values, ("CPOS", "CP", "CENTER", "CENTRE", "CENTER_POINT", "CENTRE_POINT")),
        "bpos": get_point(obj, values, ("BPOS", "BP", "BRANCH_POINT", "BPOS1", "TEE_POINT")),
        "support": get_point(obj, values, SUPPORT_COORD_KEYS),
    }


def component_type(obj) -> str:
    values = attrs(obj)
    if normalize_support_kind(obj, values):
        return "ATTA"
    src = object_text(obj, values)
    for pattern, typ in TYPE_RULES:
        if pattern.search(src):
            return typ
    return "UNKNOWN"


def bore(values: dict, default: float) -> float:
    for key in BORE_KEYS:
        value = mm(values.get(key))
        if value and value > 0:
            return value
    dtxr = values.get("DTXR")
    if dtxr is not None and not SUPPORT_TEXT_RX.search(clean(dtxr)):
        value = mm(dtxr)
        if value and value > 0:
            return value
    return default


def distance(a, b) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3))) if a and b else 0.0


def bend_radius(obj, ps: dict) -> float:
    values = attrs(obj)
    value = mm(first(values, ("BENDRADIUS", "BEND_RADIUS", "BRAD", "RADI", "RADIUS")))
    if value and value > 0:
        return value
    center = ps.get("cpos") or ps.get("pos")
    return min(distance(center, ps.get("apos")), distance(center, ps.get("lpos"))) if center and ps.get("apos") and ps.get("lpos") else 0.0


def reducer_angle(obj) -> float:
    values = attrs(obj)
    value = mm(first(values, ("ALPHAANGLE", "ALPHA_ANGLE", "ANGLE", "REDUCERANGLE")))
    return value if value is not None else 1.0


def iter_children(root):
    if not isinstance(root, dict):
        return
    for key in ("children", "items", "branches"):
        children = root.get(key)
        if isinstance(children, list):
            for child in children:
                yield child
                yield from iter_children(child)


def branch_roots(data):
    roots = data if isinstance(data, list) else [data]
    out = []
    for entry in roots:
        if isinstance(entry, dict) and any(isinstance(entry.get(key), list) for key in ("children", "items", "branches")):
            out.append(entry)
    return out


def axis_name(value: str) -> str:
    value = clean(value).upper()
    if value in ("+X", "-X", "X", "+Y", "-Y", "Y", "+Z", "-Z", "Z"):
        return value
    if value in ("E", "W"):
        return "X"
    if value in ("N", "S"):
        return "Y"
    if value in ("U", "D"):
        return "Z"
    match = SIGNED_AXIS_RX.search(value)
    if match:
        return f"{match.group(1)}{match.group(2).upper()}" if match.group(1) else match.group(2).upper()
    return ""


def axis_unsigned(axis: str) -> str:
    return axis_name(axis).replace("+", "").replace("-", "")


def dominant_axis_from_points(a, b) -> str:
    if not a or not b:
        return ""
    deltas = [abs(b[i] - a[i]) for i in range(3)]
    return ("X", "Y", "Z")[deltas.index(max(deltas))] if max(deltas) > 1e-9 else ""


def support_direction_from_attrs(obj, values: dict) -> str:
    for key in ("RESTRAINT_DIRECTION", "RESTRAINTDIR", "DIRECTION", "DIR", "AXIS", "PIPE_AXIS", "ROUTE_AXIS"):
        value = axis_name(values.get(key))
        if value:
            return value
    if isinstance(obj, dict):
        for key in ("direction", "axis", "pipeAxis"):
            value = axis_name(obj.get(key))
            if value:
                return value
    return ""


def pipe_axis_for_support(obj, values: dict, ps: dict, opt) -> str:
    explicit = support_direction_from_attrs(obj, values)
    if explicit:
        return axis_unsigned(explicit)
    derived = dominant_axis_from_points(ps.get("apos"), ps.get("lpos"))
    return derived or axis_unsigned(opt.support_pipe_axis) or "X"


def single_guide_axis(pipe_axis: str, vertical_axis: str) -> str:
    transverse = [axis for axis in ("X", "Y", "Z") if axis != pipe_axis]
    non_vertical = [axis for axis in transverse if axis != vertical_axis]
    return (non_vertical or transverse or ["Y"])[0]


def restraint_entry(rtype: str, gap: str, opt) -> dict:
    return {"type": rtype, "stiffness": clean(opt.support_stiffness), "gap": clean(gap), "friction": clean(opt.support_friction)}


def support_restraint(kind: str, obj, values: dict, ps: dict, opt) -> list[dict]:
    """Return zero or one restraint to match current xml_to_cii.py."""
    kind = (kind or "").upper()
    vertical = axis_unsigned(opt.vertical_axis) or "Y"
    axial = pipe_axis_for_support(obj, values, ps, opt)
    explicit = support_direction_from_attrs(obj, values)
    if kind == "GUIDE":
        return [restraint_entry(single_guide_axis(axial, vertical), clean(opt.guide_gap) or clean(opt.support_gap), opt)]
    if kind == "LINESTOP":
        return [restraint_entry(axis_name(opt.line_stop_direction) or axis_name(explicit) or axial, clean(opt.line_stop_gap) or clean(opt.support_gap), opt)]
    if kind == "LIMIT":
        return [restraint_entry(axis_name(opt.limit_direction) or axis_name(explicit) or axial, clean(opt.limit_gap) or clean(opt.support_gap), opt)]
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
        self.ref = 1
        self.default_diameter = max(0.001, finite(opt.default_diameter, 100))
        self.default_wall = max(0.0, finite(opt.default_wall_thickness, 0.01))
        self.default_corr = max(0.0, finite(opt.default_corrosion_allowance, 0))
        self.default_insu = max(0.0, finite(opt.default_insulation_thickness, 0))

    def next(self) -> int:
        number = self.node
        self.node += self.step
        return number

    def autoref(self) -> str:
        value = f"AUTO-{self.ref}"
        self.ref += 1
        return value


def make_node(obj, typ, endpoint, pos, ctx: Context, number=-1, bend_radius_value=0, bend_type=None, alpha=None):
    values = attrs(obj)
    kind = normalize_support_kind(obj, values) if typ == "ATTA" else ""
    tag = extract_support_tag(obj, values) if typ == "ATTA" else ""
    ps = points(obj)
    name = tag or clean(first(values, ("NAME", "TAG", "TAGNO", "ITEMCODE", "PARTNO"))) or clean(obj.get("name") if isinstance(obj, dict) else "")
    ref = tag or clean(first(values, ("COMPONENTREFNO", "REFNO", "REF", "DBREF", "CA97", "CA98", "CMPSUPREFN"))) or clean(obj.get("id") if isinstance(obj, dict) else "") or ctx.autoref()
    return {
        "number": number,
        "name": name,
        "endpoint": endpoint,
        "ctype": typ,
        "ref": ref,
        "conn": kind or clean(first(values, ("CONNECTIONTYPE", "CONN", "CONNECTION", "CREF", "CTYP"))),
        "od": bore(values, ctx.default_diameter),
        "wall": mm(values.get("WTHK") or values.get("WALLTHK") or values.get("WALL_THICKNESS")) or ctx.default_wall,
        "corr": mm(values.get("CORA") or values.get("CORROSIONALLOWANCE")) or ctx.default_corr,
        "insu": mm(values.get("INSU") or values.get("INSULATIONTHICKNESS")) or ctx.default_insu,
        "pos": pos,
        "br": bend_radius_value,
        "bt": bend_type,
        "alpha": alpha,
        "sif": int_text(values.get("SIF")),
        "weight": finite(values.get("WEIG") or values.get("WEIGHT"), 0),
        "restraints": support_restraint(kind, obj, values, ps, ctx.opt) if typ == "ATTA" else [],
    }


def expand(obj, ctx: Context):
    typ = component_type(obj)
    ps = points(obj)
    base = ps.get("support") or ps.get("pos") or ps.get("cpos") or ps.get("apos") or ps.get("lpos") or ps.get("bpos")
    if typ == "UNKNOWN" or not base:
        return []
    if typ == "ELBO":
        radius = bend_radius(obj, ps)
        return [
            make_node(obj, typ, 1, ps.get("apos") or base, ctx, -1, radius, 0),
            make_node(obj, typ, 0, ps.get("cpos") or ps.get("pos") or base, ctx, ctx.next(), radius, 1),
            make_node(obj, typ, 2, ps.get("lpos") or base, ctx, -1, radius, 0),
        ]
    if typ in ("OLET", "TEE"):
        center = ps.get("pos") or ps.get("cpos") or base
        return [
            make_node(obj, typ, 1, ps.get("apos") or center, ctx, -1),
            make_node(obj, typ, 3, ps.get("bpos") or ps.get("lpos") or center, ctx, -1),
            make_node(obj, typ, 0, center, ctx, ctx.next()),
            make_node(obj, typ, 2, ps.get("lpos") or center, ctx, -1),
        ]
    if typ == "REDU":
        return [
            make_node(obj, typ, 1, ps.get("apos") or base, ctx, -1),
            make_node(obj, typ, 0, ps.get("pos") or base, ctx, ctx.next(), alpha=reducer_angle(obj)),
            make_node(obj, typ, 2, ps.get("lpos") or base, ctx, -1),
        ]
    if typ == "ATTA":
        return [make_node(obj, typ, 0, base, ctx, ctx.next())]
    if ps.get("apos") and ps.get("lpos"):
        return [
            make_node(obj, typ, 1, ps["apos"], ctx, -1),
            make_node(obj, typ, 0, ps.get("pos") or ps["apos"], ctx, ctx.next()),
            make_node(obj, typ, 2, ps["lpos"], ctx, -1),
        ]
    return [make_node(obj, typ, 0, base, ctx, ctx.next())]


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
    for restraint in node.get("restraints") or []:
        lines.extend([
            "        <Restraint>",
            f"          <Type>{xml_escape(restraint.get('type', ''))}</Type>",
            f"          <Stiffness>{xml_escape(restraint.get('stiffness', ''))}</Stiffness>",
            f"          <Gap>{xml_escape(restraint.get('gap', ''))}</Gap>",
            f"          <Friction>{xml_escape(restraint.get('friction', ''))}</Friction>",
            "        </Restraint>",
        ])
        break
    lines.append("      </Node>")
    return "\n".join(lines)


def convert(input_path: Path, output_path: Path, opt):
    data = json.loads(input_path.read_text(encoding="utf-8-sig"))
    branches = branch_roots(data)
    if not branches:
        raise SystemExit("Staged JSON has no branch children.")
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
    ])
    for branch in branches:
        values = attrs(branch)
        branch_name = branch.get("name") or branch.get("path") or values.get("NAME") or "B1"
        lines.extend(["    <Branch>", f"      <Branchname>{xml_escape(branch_name)}</Branchname>"])
        lines.append("      <Temperature>" + "".join(f"<Temperature{i}>-100000</Temperature{i}>" for i in range(1, 10)) + "</Temperature>")
        lines.append("      <Pressure>" + "".join(f"<Pressure{i}>0</Pressure{i}>" for i in range(1, 10)) + "</Pressure>")
        lines.extend(["      <MaterialNumber>0</MaterialNumber>", "      <InsulationDensity>0</InsulationDensity>", "      <FluidDensity>0</FluidDensity>"])
        for child in iter_children(branch):
            nodes = expand(child, ctx)
            if not nodes:
                skipped += 1
                continue
            for node in nodes:
                lines.append(node_xml(node))
                count += 1
                restraint_count += 1 if node.get("restraints") else 0
                bytype[node["ctype"]] = bytype.get(node["ctype"], 0) + 1
        lines.append("    </Branch>")
    lines.extend([
        "  </Pipe>",
        f"  <!-- StagedJSON XSD-clean upstream XML generated {count} Node records; support restraints {restraint_count}; skipped {skipped}. Counts: {bytype} -->",
        "</PipeStressExport>",
    ])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {output_path} with {count} XML nodes; support restraints {restraint_count}; preserved counts: {bytype}; skipped {skipped}.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--node-start", type=int, default=10)
    parser.add_argument("--node-step", type=int, default=10)
    parser.add_argument("--source", default="AVEVA PSI")
    parser.add_argument("--purpose", default="RMSS staged JSON conversion")
    parser.add_argument("--title-line", default="RMSS StagedJSON Output")
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
    convert(Path(args.input), Path(args.output), args)


if __name__ == "__main__":
    main()
