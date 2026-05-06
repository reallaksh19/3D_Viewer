#!/usr/bin/env python3
"""Convert staged hierarchy JSON to PSI116 XML without dropping fittings/supports.

Upstream-only scope:
- Do not depend on xml_to_cii.py changes.
- Preserve supports/fittings in XML so the existing downstream converter can consume them.
- Keep the existing PSI116 XML shape: PipeStressExport > Pipe > Branch > Node.

Support rules:
- DTXR GUIDE / LINE STOP / LIMIT / REST / BP / ANCHOR is support intent.
- Support nodes are ComponentType=ATTA with ConnectionType=<normalized support kind>.
- Stiffness and Gap are blank by default; Friction defaults to 0.3.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from xml.sax.saxutils import escape

BORE_KEYS = ('HBOR', 'TBOR', 'ABORE', 'LBORE', 'BORE', 'NBORE', 'DBOR')
SUPPORT_COORD_KEYS = (
    'SUPPORTCOORD', 'SUPPORT_COORD', 'SCOORD', 'SUPPORT_POS', 'SUPPORTPOS',
    'COORDS', 'CO_ORDS', 'CO_ORD', 'POS', 'POSITION', 'BPOS', 'BP', 'APOS', 'LPOS'
)
SUPPORT_TAG_RX = re.compile(r'\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b', re.I)
SUPPORT_TEXT_RX = re.compile(
    r'\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b',
    re.I,
)
SIGNED_AXIS_RX = re.compile(r'([+-]?)\s*([XYZ])\b', re.I)
TYPE_RULES = (
    (re.compile(r'WELDOLET|SOCKOLET|THREDOLET|SWEEPOLET|\bOLET\b', re.I), 'OLET'),
    (re.compile(r'\bVALV(E)?\b', re.I), 'VALV'),
    (re.compile(r'\bFLAN(GE)?\b', re.I), 'FLAN'),
    (re.compile(r'\bGASK(ET)?\b', re.I), 'GASK'),
    (re.compile(r'\b(ELBO(W)?|BEND)\b', re.I), 'ELBO'),
    (re.compile(r'\bTEE\b', re.I), 'TEE'),
    (re.compile(r'\bREDU(CER)?\b', re.I), 'REDU'),
    (re.compile(r'\b(ATTA|ANCI|SUPP|SUPPORT|REST|GUIDE|LINE\s*STOP|LINESTOP|LIMIT|ANCHOR|FIXED|SHOE|BP|BASE\s*PLATE)\b', re.I), 'ATTA'),
    (re.compile(r'\b(PIPE|TUBI)\b', re.I), 'PIPE'),
)


def txt(v) -> str:
    return '' if v is None else str(v)


def clean(v) -> str:
    return txt(v).strip()


def x(v) -> str:
    return escape(txt(v), {'"': '&quot;'})


def finite(v, default: float = 0.0) -> float:
    try:
        n = float(v)
        return n if math.isfinite(n) else default
    except Exception:
        return default


def nfmt(v, dec: int = 3) -> str:
    s = f"{finite(v):.{dec}f}".rstrip('0').rstrip('.')
    return s or '0'


def mm(v):
    m = re.search(r'-?\d+(?:\.\d+)?', txt(v).replace('mm', ' ').replace('MM', ' '))
    return float(m.group(0)) if m else None


def attrs(o) -> dict:
    out = {}
    if isinstance(o, dict):
        for key in ('attributes', 'attrs', 'attr', 'rawAttributes', 'raw_attributes', 'normalized'):
            if isinstance(o.get(key), dict):
                out.update(o[key])
        for key, value in o.items():
            if key not in {'children', 'items', 'branches', 'attributes', 'attrs', 'attr', 'rawAttributes', 'raw_attributes', 'normalized'}:
                if isinstance(value, (str, int, float, bool, list, tuple, dict)):
                    out.setdefault(key, value)
    return out


def first(a: dict, keys) -> str:
    for key in keys:
        if key in a and clean(a[key]):
            return a[key]
    return ''


def object_text(o, a: dict) -> str:
    values = []
    if isinstance(o, dict):
        values.extend([o.get('type'), o.get('kind'), o.get('name'), o.get('path'), o.get('id')])
    values.extend(a.get(k) for k in (
        'TYPE', 'STYP', 'SPRE', 'PTYPE', 'DETAIL', 'NAME', 'TAG', 'TAGNO', 'ITEMCODE',
        'PARTNO', 'SKEY', 'DTXR', 'SUPPORT_TYPE', 'CMPSUPTYPE', 'DESCRIPTION', 'DESC', 'CONNECTIONTYPE'
    ))
    return ' '.join(clean(v) for v in values if clean(v))


def normalize_support_kind(o, a: dict) -> str:
    s = object_text(o, a).upper()
    if re.search(r'\bLINE\s*STOP\b|\bLINESTOP\b|\bSTOPPER\b|\bSTOP\b', s):
        return 'LINESTOP'
    if re.search(r'\bLIMIT\s*STOP\b|\bLIMIT\b', s):
        return 'LIMIT'
    if re.search(r'\bGUIDE\b', s):
        return 'GUIDE'
    if re.search(r'\bRESTING\b|\bREST\b|\bSHOE\b|\bBP\b|\bBASE\s*PLATE\b', s):
        return 'REST'
    if re.search(r'\bANCHOR\b|\bFIXED\b', s):
        return 'ANCHOR'
    return ''


def extract_support_tag(o, a: dict) -> str:
    candidates = []
    if isinstance(o, dict):
        candidates.extend([o.get('name'), o.get('path'), o.get('id')])
    candidates.extend(a.get(k) for k in (
        'SUPPORT_TAG', 'CMPSUPREFN', 'NAME', 'TAG', 'TAGNO', 'ITEMCODE', 'PARTNO',
        'REF', 'REFNO', 'DBREF', 'COMPONENTREFNO', 'CA97', 'CA98', 'SKEY', 'SPRE', 'DESCRIPTION', 'DESC'
    ))
    for candidate in candidates:
        m = SUPPORT_TAG_RX.search(clean(candidate))
        if m:
            return re.sub(r'\s+', '-', m.group(0).strip())
    fallback = first(a, ('CMPSUPREFN', 'SUPPORT_TAG', 'NAME', 'TAG', 'TAGNO'))
    return clean(fallback)


def point(v):
    if v in (None, ''):
        return None
    if isinstance(v, (list, tuple)) and len(v) >= 3:
        p = tuple(finite(v[i], float('nan')) for i in range(3))
        return p if all(math.isfinite(c) for c in p) else None
    if isinstance(v, dict):
        p = (
            finite(v.get('x', v.get('X')), float('nan')),
            finite(v.get('y', v.get('Y')), float('nan')),
            finite(v.get('z', v.get('Z')), float('nan')),
        )
        return p if all(math.isfinite(c) for c in p) else None
    vals = [float(q) for q in re.findall(r'-?\d+(?:\.\d+)?', txt(v))]
    return tuple(vals[:3]) if len(vals) >= 3 else None


def getp(o, a: dict, keys):
    for key in keys:
        value = a.get(key)
        if value is None and isinstance(o, dict):
            value = o.get(key)
        p = point(value)
        if p:
            return p
    return None


def points(o) -> dict:
    a = attrs(o)
    return {
        'apos': getp(o, a, ('APOS', 'A_POS', 'EP1', 'END1', 'START', 'START_POINT', 'POS_START')),
        'lpos': getp(o, a, ('LPOS', 'L_POS', 'EP2', 'END2', 'END', 'END_POINT', 'POS_END')),
        'pos': getp(o, a, ('POS', 'POSITION', 'COORDS', 'CO_ORDS', 'CO_ORD', 'POSS')),
        'cpos': getp(o, a, ('CPOS', 'CP', 'CENTER', 'CENTRE', 'CENTER_POINT', 'CENTRE_POINT')),
        'bpos': getp(o, a, ('BPOS', 'BP', 'BRANCH_POINT', 'BPOS1', 'TEE_POINT')),
        'support': getp(o, a, SUPPORT_COORD_KEYS),
    }


def ctype(o) -> str:
    a = attrs(o)
    if normalize_support_kind(o, a):
        return 'ATTA'
    source = object_text(o, a)
    for rx, typ in TYPE_RULES:
        if rx.search(source):
            return typ
    return 'UNKNOWN'


def bore(a: dict, default: float) -> float:
    for key in BORE_KEYS:
        v = mm(a.get(key))
        if v and v > 0:
            return v
    dtxr = a.get('DTXR')
    if dtxr is not None and not SUPPORT_TEXT_RX.search(clean(dtxr)):
        v = mm(dtxr)
        if v and v > 0:
            return v
    return default


def dist(a, b) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3))) if a and b else 0.0


def bend_radius(o, ps: dict) -> float:
    a = attrs(o)
    v = mm(first(a, ('BENDRADIUS', 'BEND_RADIUS', 'BRAD', 'RADI', 'RADIUS')))
    if v and v > 0:
        return v
    center = ps.get('cpos') or ps.get('pos')
    return min(dist(center, ps.get('apos')), dist(center, ps.get('lpos'))) if center and ps.get('apos') and ps.get('lpos') else 0.0


def reducer_angle(o) -> float:
    a = attrs(o)
    v = mm(first(a, ('ALPHAANGLE', 'ALPHA_ANGLE', 'ANGLE', 'REDUCERANGLE')))
    return v if v is not None else 1.0


def iter_children(root):
    if not isinstance(root, dict):
        return
    for key in ('children', 'items', 'branches'):
        children = root.get(key)
        if isinstance(children, list):
            for child in children:
                yield child
                yield from iter_children(child)


def branch_roots(data):
    roots = data if isinstance(data, list) else [data]
    out = []
    for entry in roots:
        if isinstance(entry, dict) and any(isinstance(entry.get(k), list) for k in ('children', 'items', 'branches')):
            out.append(entry)
    return out


def axis_name(value: str) -> str:
    s = clean(value).upper()
    if s in ('+X', '-X', 'X', '+Y', '-Y', 'Y', '+Z', '-Z', 'Z'):
        return s
    if s in ('E', 'W'):
        return 'X'
    if s in ('N', 'S'):
        return 'Y'
    if s in ('U', 'D'):
        return 'Z'
    m = SIGNED_AXIS_RX.search(s)
    if m:
        return f"{m.group(1)}{m.group(2).upper()}" if m.group(1) else m.group(2).upper()
    return ''


def axis_unsigned(axis: str) -> str:
    return axis_name(axis).replace('+', '').replace('-', '')


def dominant_axis_from_points(a, b) -> str:
    if not a or not b:
        return ''
    dx, dy, dz = abs(b[0] - a[0]), abs(b[1] - a[1]), abs(b[2] - a[2])
    if dx >= dy and dx >= dz and dx > 1e-9:
        return 'X'
    if dy >= dx and dy >= dz and dy > 1e-9:
        return 'Y'
    return 'Z' if dz > 1e-9 else ''


def support_direction_from_attrs(o, a: dict) -> str:
    for key in ('RESTRAINT_DIRECTION', 'RESTRAINTDIR', 'DIRECTION', 'DIR', 'AXIS', 'PIPE_AXIS', 'ROUTE_AXIS'):
        val = axis_name(a.get(key))
        if val:
            return val
    if isinstance(o, dict):
        for key in ('direction', 'axis', 'pipeAxis'):
            val = axis_name(o.get(key))
            if val:
                return val
    return ''


def pipe_axis_for_support(o, a: dict, ps: dict, opt) -> str:
    explicit = support_direction_from_attrs(o, a)
    if explicit:
        return axis_unsigned(explicit)
    derived = dominant_axis_from_points(ps.get('apos'), ps.get('lpos'))
    return derived or axis_unsigned(opt.support_pipe_axis) or 'X'


def restraint_entry(rtype: str, gap: str, opt) -> dict:
    return {'type': rtype, 'stiffness': clean(opt.support_stiffness), 'gap': clean(gap), 'friction': clean(opt.support_friction)}


def support_restraints(kind: str, o, a: dict, ps: dict, opt) -> list[dict]:
    vertical = axis_unsigned(opt.vertical_axis) or 'Y'
    pipe_axis = pipe_axis_for_support(o, a, ps, opt)
    explicit = support_direction_from_attrs(o, a)
    kind = (kind or '').upper()
    if kind == 'GUIDE':
        gap = clean(opt.guide_gap) or clean(opt.support_gap)
        return [restraint_entry(axis, gap, opt) for axis in ('X', 'Y', 'Z') if axis != pipe_axis]
    if kind == 'LINESTOP':
        return [restraint_entry(axis_name(opt.line_stop_direction) or axis_name(explicit) or pipe_axis, clean(opt.line_stop_gap) or clean(opt.support_gap), opt)]
    if kind == 'LIMIT':
        return [restraint_entry(axis_name(opt.limit_direction) or axis_name(explicit) or pipe_axis, clean(opt.limit_gap) or clean(opt.support_gap), opt)]
    if kind == 'REST':
        return [restraint_entry(axis_name(opt.rest_direction) or vertical, clean(opt.rest_gap) or clean(opt.support_gap), opt)]
    if kind == 'ANCHOR':
        return [restraint_entry('A', clean(opt.anchor_gap) or clean(opt.support_gap), opt)]
    return []


class Ctx:
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
        n = self.node
        self.node += self.step
        return n

    def autoref(self) -> str:
        r = f'AUTO-{self.ref}'
        self.ref += 1
        return r


def make_node(o, typ, ep, p, ctx: Ctx, number=-1, bend_radius_value=0, bend_type=None, alpha=None):
    a = attrs(o)
    kind = normalize_support_kind(o, a) if typ == 'ATTA' else ''
    tag = extract_support_tag(o, a) if typ == 'ATTA' else ''
    ps = points(o)
    name = tag or clean(first(a, ('NAME', 'TAG', 'TAGNO', 'ITEMCODE', 'PARTNO'))) or clean(o.get('name') if isinstance(o, dict) else '')
    ref = tag or clean(first(a, ('COMPONENTREFNO', 'REFNO', 'REF', 'DBREF', 'CA97', 'CA98', 'CMPSUPREFN'))) or clean(o.get('id') if isinstance(o, dict) else '') or ctx.autoref()
    conn = kind or clean(first(a, ('CONNECTIONTYPE', 'CONN', 'CONNECTION', 'CREF', 'CTYP')))
    return dict(
        number=number,
        name=name,
        endpoint=ep,
        ctype=typ,
        ref=ref,
        conn=conn,
        od=bore(a, ctx.default_diameter),
        wall=mm(a.get('WTHK') or a.get('WALLTHK') or a.get('WALL_THICKNESS')) or ctx.default_wall,
        corr=mm(a.get('CORA') or a.get('CORROSIONALLOWANCE')) or ctx.default_corr,
        insu=mm(a.get('INSU') or a.get('INSULATIONTHICKNESS')) or ctx.default_insu,
        pos=p,
        br=bend_radius_value,
        bt=bend_type,
        alpha=alpha,
        sif=finite(a.get('SIF'), 0),
        weight=finite(a.get('WEIG') or a.get('WEIGHT'), 0),
        restraints=support_restraints(kind, o, a, ps, ctx.opt) if typ == 'ATTA' else [],
    )


def expand(o, ctx: Ctx):
    typ = ctype(o)
    ps = points(o)
    base = ps.get('support') or ps.get('pos') or ps.get('cpos') or ps.get('apos') or ps.get('lpos') or ps.get('bpos')
    if typ == 'UNKNOWN' or not base:
        return []
    out = []
    if typ == 'ELBO':
        r = bend_radius(o, ps)
        out += [
            make_node(o, typ, 1, ps.get('apos') or base, ctx, -1, r, 0),
            make_node(o, typ, 0, ps.get('cpos') or ps.get('pos') or base, ctx, ctx.next(), r, 1),
            make_node(o, typ, 2, ps.get('lpos') or base, ctx, -1, r, 0),
        ]
    elif typ in ('OLET', 'TEE'):
        center = ps.get('pos') or ps.get('cpos') or base
        out += [
            make_node(o, typ, 1, ps.get('apos') or center, ctx, -1),
            make_node(o, typ, 3, ps.get('bpos') or ps.get('lpos') or center, ctx, -1),
            make_node(o, typ, 0, center, ctx, ctx.next()),
            make_node(o, typ, 2, ps.get('lpos') or center, ctx, -1),
        ]
    elif typ == 'REDU':
        out += [
            make_node(o, typ, 1, ps.get('apos') or base, ctx, -1),
            make_node(o, typ, 0, ps.get('pos') or base, ctx, ctx.next(), alpha=reducer_angle(o)),
            make_node(o, typ, 2, ps.get('lpos') or base, ctx, -1),
        ]
    elif typ == 'ATTA':
        out.append(make_node(o, typ, 0, base, ctx, ctx.next()))
    elif ps.get('apos') and ps.get('lpos'):
        out += [
            make_node(o, typ, 1, ps['apos'], ctx, -1),
            make_node(o, typ, 0, ps.get('pos') or ps['apos'], ctx, ctx.next()),
            make_node(o, typ, 2, ps['lpos'], ctx, -1),
        ]
    else:
        out.append(make_node(o, typ, 0, base, ctx, ctx.next()))
    return out


def node_xml(n: dict) -> str:
    p = n['pos']
    lines = [
        '      <Node>',
        f"        <NodeNumber>{n['number']}</NodeNumber>",
        f"        <NodeName>{x(n['name'])}</NodeName>",
        f"        <Endpoint>{n['endpoint']}</Endpoint>",
        f"        <ComponentType>{x(n['ctype'])}</ComponentType>",
        f"        <Weight>{nfmt(n['weight'])}</Weight>",
        f"        <ComponentRefNo>{x(n['ref'])}</ComponentRefNo>",
        f"        <ConnectionType>{x(n['conn'])}</ConnectionType>",
        f"        <OutsideDiameter>{nfmt(n['od'])}</OutsideDiameter>",
        f"        <WallThickness>{nfmt(n['wall'])}</WallThickness>",
        f"        <CorrosionAllowance>{nfmt(n['corr'])}</CorrosionAllowance>",
        f"        <InsulationThickness>{nfmt(n['insu'])}</InsulationThickness>",
        f"        <Position>{p[0]:.2f} {p[1]:.2f} {p[2]:.2f}</Position>",
        f"        <BendRadius>{nfmt(n['br'])}</BendRadius>",
    ]
    if n['bt'] is not None:
        lines.append(f"        <BendType>{n['bt']}</BendType>")
    if n['alpha'] is not None:
        lines.append(f"        <AlphaAngle>{nfmt(n['alpha'])}</AlphaAngle>")
    lines.append(f"        <SIF>{n['sif']}</SIF>")
    for r in n.get('restraints') or []:
        lines += [
            '        <Restraint>',
            f"          <Type>{x(r.get('type', ''))}</Type>",
            f"          <Stiffness>{x(r.get('stiffness', ''))}</Stiffness>",
            f"          <Gap>{x(r.get('gap', ''))}</Gap>",
            f"          <Friction>{x(r.get('friction', ''))}</Friction>",
            '        </Restraint>',
        ]
    lines.append('      </Node>')
    return '\n'.join(lines)


def convert(input_path: Path, output_path: Path, opt):
    data = json.loads(input_path.read_text(encoding='utf-8-sig'))
    branches = branch_roots(data)
    if not branches:
        raise SystemExit('Staged JSON has no branch children.')
    ctx = Ctx(opt)
    project = input_path.stem
    count = skipped = restraints = 0
    bytype = {}
    lines = ['<?xml version="1.0" encoding="utf-8"?>', '<PipeStressExport xmlns="http://aveva.com/pipeStress116.xsd">']
    lines += [
        '  <DateTime></DateTime>',
        f'  <Source>{x(opt.source)}</Source>',
        '  <Version>0.0.0.0</Version>',
        '  <UserName>browser-runtime</UserName>',
        f'  <Purpose>{x(opt.purpose)}</Purpose>',
        f'  <ProjectName>{x(project)}</ProjectName>',
        f'  <MDBName>/{x(project)}</MDBName>',
        f'  <TitleLine>{x(opt.title_line)}</TitleLine>',
        '  <!-- Configuration information -->',
        '  <RestrainOpenEnds>No</RestrainOpenEnds>',
        '  <AmbientTemperature>0</AmbientTemperature>',
        '  <Pipe>',
        f'    <FullName>/{x(project)}</FullName>',
        '    <Ref></Ref>',
    ]
    for br in branches:
        ba = attrs(br)
        branch_name = br.get('name') or br.get('path') or ba.get('NAME') or 'B1'
        lines += ['    <Branch>', f'      <Branchname>{x(branch_name)}</Branchname>']
        lines.append('      <Temperature>' + ''.join(f'<Temperature{i}>-100000</Temperature{i}>' for i in range(1, 10)) + '</Temperature>')
        lines.append('      <Pressure>' + ''.join(f'<Pressure{i}>0</Pressure{i}>' for i in range(1, 10)) + '</Pressure>')
        lines += ['      <MaterialNumber>0</MaterialNumber>', '      <InsulationDensity>0</InsulationDensity>', '      <FluidDensity>0</FluidDensity>']
        for ch in iter_children(br):
            nodes = expand(ch, ctx)
            if not nodes:
                skipped += 1
                continue
            for node in nodes:
                lines.append(node_xml(node))
                count += 1
                restraints += len(node.get('restraints') or [])
                bytype[node['ctype']] = bytype.get(node['ctype'], 0) + 1
        lines.append('    </Branch>')
    lines += [
        '  </Pipe>',
        f'  <!-- StagedJSON upstream XML generated {count} Node records; support restraints {restraints}; skipped {skipped}. Counts: {bytype} -->',
        '</PipeStressExport>',
    ]
    output_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f"Wrote {output_path} with {count} XML nodes; support restraints {restraints}; preserved counts: {bytype}; skipped {skipped}.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--node-start', type=int, default=10)
    p.add_argument('--node-step', type=int, default=10)
    p.add_argument('--source', default='AVEVA PSI')
    p.add_argument('--purpose', default='RMSS staged JSON conversion')
    p.add_argument('--title-line', default='RMSS StagedJSON Output')
    p.add_argument('--default-diameter', type=float, default=100.0)
    p.add_argument('--default-wall-thickness', type=float, default=0.01)
    p.add_argument('--default-insulation-thickness', type=float, default=0.0)
    p.add_argument('--default-corrosion-allowance', type=float, default=0.0)
    p.add_argument('--support-stiffness', default='')
    p.add_argument('--support-gap', default='')
    p.add_argument('--support-friction', default='0.3')
    p.add_argument('--guide-gap', default='')
    p.add_argument('--line-stop-gap', default='')
    p.add_argument('--limit-gap', default='')
    p.add_argument('--rest-gap', default='')
    p.add_argument('--anchor-gap', default='')
    p.add_argument('--support-pipe-axis', default='X')
    p.add_argument('--vertical-axis', default='Y')
    p.add_argument('--line-stop-direction', default='')
    p.add_argument('--limit-direction', default='')
    p.add_argument('--rest-direction', default='')
    args = p.parse_args()
    convert(Path(args.input), Path(args.output), args)


if __name__ == '__main__':
    main()
