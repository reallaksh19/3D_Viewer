#!/usr/bin/env python3
"""Convert AVEVA/RMSS attribute TXT directly to PSI116 XML.

Upstream-only scope:
- Do not run or modify XML->CII.
- Preserve support/fitting semantics in XML so the existing downstream converter can consume them.
- Keep the same PSI116 XML shape: PipeStressExport > Pipe > Branch > Node.

This script is intentionally tolerant of common attribute formats:
- NEW ... / END blocks
- KEY := VALUE
- KEY = VALUE
- KEY VALUE
"""
from __future__ import annotations

import argparse
import json
import math
import re
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

BORE_KEYS = ('HBOR', 'TBOR', 'ABORE', 'LBORE', 'BORE', 'NBORE', 'DBOR')
SUPPORT_COORD_KEYS = (
    'SUPPORTCOORD', 'SUPPORT_COORD', 'SCOORD', 'SUPPORT_POS', 'SUPPORTPOS',
    'COORDS', 'CO_ORDS', 'CO_ORD', 'POS', 'POSITION', 'BPOS', 'BP', 'APOS', 'LPOS'
)
KEY_VALUE_RE = re.compile(r'^\s*:?(?P<key>[A-Za-z][A-Za-z0-9_\-]*)\s*(?::=|=|:)\s*(?P<value>.*?)\s*$')
PS_TAG_RE = re.compile(r'\bPS[-_\s]?[A-Z0-9][A-Z0-9._/\-]*\b', re.I)
SUPPORT_TEXT_RE = re.compile(
    r'\b(GUIDE|LINE\s*STOP|LINESTOP|LIMIT\s*STOP|LIMIT|RESTING|REST|SHOE|BP|BASE\s*PLATE|ANCHOR|FIXED|STOPPER|STOP)\b',
    re.I,
)
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
SIGNED_AXIS_RE = re.compile(r'([+-]?)\s*([XYZ])\b', re.I)


def s(value) -> str:
    return '' if value is None else str(value).strip()


def x(value) -> str:
    return escape('' if value is None else str(value), {'"': '&quot;'})


def fnum(value, default=0.0) -> float:
    try:
        n = float(value)
        return n if math.isfinite(n) else default
    except Exception:
        return default


def mm(value):
    match = re.search(r'-?\d+(?:\.\d+)?', str(value or '').replace('mm', ' ').replace('MM', ' '))
    return float(match.group(0)) if match else None


def nfmt(value, decimals=3) -> str:
    txt = f'{fnum(value):.{decimals}f}'.rstrip('0').rstrip('.')
    return txt or '0'


def parse_coord(value):
    if value is None or value == '':
        return None
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        p = tuple(fnum(value[i], float('nan')) for i in range(3))
        return p if all(math.isfinite(c) for c in p) else None
    if isinstance(value, dict):
        p = (fnum(value.get('x', value.get('X')), float('nan')), fnum(value.get('y', value.get('Y')), float('nan')), fnum(value.get('z', value.get('Z')), float('nan')))
        return p if all(math.isfinite(c) for c in p) else None
    text = str(value).strip()
    tokens = text.split()
    out = {'x': 0.0, 'y': 0.0, 'z': 0.0}
    directional = False
    for i in range(0, max(len(tokens) - 1, 0), 2):
        axis = tokens[i].upper()
        val = mm(tokens[i + 1])
        if val is None:
            continue
        if axis == 'E': out['x'] = val; directional = True
        elif axis == 'W': out['x'] = -val; directional = True
        elif axis == 'N': out['y'] = val; directional = True
        elif axis == 'S': out['y'] = -val; directional = True
        elif axis == 'U': out['z'] = val; directional = True
        elif axis == 'D': out['z'] = -val; directional = True
    if directional:
        return (out['x'], out['y'], out['z'])
    vals = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', text)]
    return tuple(vals[:3]) if len(vals) >= 3 else None


def parse_blocks(text: str) -> list[dict[str, str]]:
    blocks = []
    current = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.match(r'^NEW(\s|$)', line, re.I):
            if current:
                blocks.append(current)
            current = {'__RAW__': raw_line, '__NEW__': line[3:].strip()}
            continue
        if re.match(r'^END(\s|$)', line, re.I):
            if current:
                blocks.append(current)
                current = None
            continue
        if current is None:
            current = {'__RAW__': ''}
        current['__RAW__'] = f"{current.get('__RAW__', '')}\n{raw_line}".strip()
        m = KEY_VALUE_RE.match(line)
        if m:
            key = m.group('key').upper().replace('-', '_')
            val = m.group('value').strip().strip('"')
            current[key] = val
    if current:
        blocks.append(current)
    return blocks


def read_attribute_text(path: Path) -> str:
    if path.suffix.lower() != '.zip':
        return path.read_text(encoding='utf-8', errors='replace')
    with zipfile.ZipFile(path, 'r') as zf:
        members = sorted([m for m in zf.namelist() if m.lower().endswith(('.att', '.txt'))])
        if not members:
            raise SystemExit(f'Attribute ZIP contains no .att/.txt file: {path}')
        with zf.open(members[0], 'r') as f:
            return f.read().decode('utf-8', errors='replace')


def combined_text(block: dict) -> str:
    return ' '.join(str(block.get(k, '')) for k in ('__NEW__', '__RAW__', 'TYPE', 'STYP', 'NAME', 'TAG', 'TAGNO', 'SKEY', 'SPRE', 'DTXR', 'CMPSUPTYPE', 'DESCRIPTION', 'DESC'))


def support_kind(block: dict) -> str:
    text = combined_text(block).upper()
    if re.search(r'\bLINE\s*STOP\b|\bLINESTOP\b|\bSTOPPER\b|\bSTOP\b', text):
        return 'LINESTOP'
    if re.search(r'\bLIMIT\s*STOP\b|\bLIMIT\b', text):
        return 'LIMIT'
    if re.search(r'\bGUIDE\b', text):
        return 'GUIDE'
    if re.search(r'\bRESTING\b|\bREST\b|\bSHOE\b|\bBP\b|\bBASE\s*PLATE\b', text):
        return 'REST'
    if re.search(r'\bANCHOR\b|\bFIXED\b', text):
        return 'ANCHOR'
    return ''


def component_type(block: dict) -> str:
    kind = support_kind(block)
    if kind:
        return 'ATTA'
    text = combined_text(block)
    for rx, typ in TYPE_RULES:
        if rx.search(text):
            return typ
    return 'UNKNOWN'


def support_tag(block: dict) -> str:
    for key in ('CMPSUPREFN', 'SUPPORT_TAG', 'NAME', 'TAG', 'TAGNO', 'ITEMCODE', 'PARTNO', 'REF', 'REFNO', 'DBREF', 'COMPONENTREFNO', 'CA97', 'CA98', 'SKEY', 'SPRE', '__NEW__', '__RAW__'):
        match = PS_TAG_RE.search(str(block.get(key, '')))
        if match:
            return re.sub(r'\s+', '-', match.group(0).strip())
    return s(block.get('CMPSUPREFN') or block.get('NAME') or block.get('__NEW__') or 'SUPPORT')


def point_from_block(block: dict, keys) -> tuple[float, float, float] | None:
    for key in keys:
        p = parse_coord(block.get(key))
        if p:
            return p
    return None


def points(block: dict) -> dict:
    return {
        'apos': point_from_block(block, ('APOS', 'A_POS', 'EP1', 'END1', 'START', 'START_POINT', 'POS_START')),
        'lpos': point_from_block(block, ('LPOS', 'L_POS', 'EP2', 'END2', 'END', 'END_POINT', 'POS_END')),
        'pos': point_from_block(block, ('POS', 'POSITION', 'COORDS', 'CO_ORDS', 'CO_ORD')),
        'cpos': point_from_block(block, ('CPOS', 'CP', 'CENTER', 'CENTRE', 'CENTER_POINT')),
        'bpos': point_from_block(block, ('BPOS', 'BP', 'BRANCH_POINT', 'BPOS1')),
        'support': point_from_block(block, SUPPORT_COORD_KEYS),
    }


def bore(block: dict, default: float) -> float:
    for key in BORE_KEYS:
        val = mm(block.get(key))
        if val and val > 0:
            return val
    if block.get('DTXR') and not SUPPORT_TEXT_RE.search(s(block.get('DTXR'))):
        val = mm(block.get('DTXR'))
        if val and val > 0:
            return val
    return default


def axis_name(value: str) -> str:
    text = s(value).upper()
    if text in ('+X', '-X', 'X', '+Y', '-Y', 'Y', '+Z', '-Z', 'Z'):
        return text
    m = SIGNED_AXIS_RE.search(text)
    if m:
        return f"{m.group(1)}{m.group(2).upper()}" if m.group(1) else m.group(2).upper()
    return ''


def unsigned(axis: str) -> str:
    return axis_name(axis).replace('+', '').replace('-', '')


def dominant_axis(a, b) -> str:
    if not a or not b:
        return ''
    d = [abs(b[i] - a[i]) for i in range(3)]
    return ('X', 'Y', 'Z')[d.index(max(d))] if max(d) > 1e-9 else ''


def pipe_axis(block: dict, ps: dict, opt) -> str:
    for key in ('RESTRAINT_DIRECTION', 'RESTRAINTDIR', 'DIRECTION', 'DIR', 'AXIS', 'PIPE_AXIS', 'ROUTE_AXIS'):
        val = axis_name(block.get(key, ''))
        if val:
            return unsigned(val)
    return dominant_axis(ps.get('apos'), ps.get('lpos')) or unsigned(opt.support_pipe_axis) or 'X'


def restraint_entry(rtype: str, gap: str, opt) -> dict:
    return {'type': rtype, 'stiffness': s(opt.support_stiffness), 'gap': s(gap), 'friction': s(opt.support_friction)}


def restraints(block: dict, ps: dict, opt) -> list[dict]:
    kind = support_kind(block)
    if not kind:
        return []
    vertical = unsigned(opt.vertical_axis) or 'Y'
    axial = pipe_axis(block, ps, opt)
    if kind == 'GUIDE':
        gap = s(opt.guide_gap) or s(opt.support_gap)
        return [restraint_entry(a, gap, opt) for a in ('X', 'Y', 'Z') if a != axial]
    if kind == 'LINESTOP':
        return [restraint_entry(axis_name(opt.line_stop_direction) or axial, s(opt.line_stop_gap) or s(opt.support_gap), opt)]
    if kind == 'LIMIT':
        return [restraint_entry(axis_name(opt.limit_direction) or axial, s(opt.limit_gap) or s(opt.support_gap), opt)]
    if kind == 'REST':
        return [restraint_entry(axis_name(opt.rest_direction) or vertical, s(opt.rest_gap) or s(opt.support_gap), opt)]
    if kind == 'ANCHOR':
        return [restraint_entry('A', s(opt.anchor_gap) or s(opt.support_gap), opt)]
    return []


class Ctx:
    def __init__(self, opt):
        self.opt = opt
        self.node = max(1, int(fnum(opt.node_start, 10)))
        self.step = max(1, int(fnum(opt.node_step, 10)))
        self.default_diameter = max(0.001, fnum(opt.default_diameter, 100))
        self.default_wall = max(0.0, fnum(opt.default_wall_thickness, 0.01))
        self.default_corr = max(0.0, fnum(opt.default_corrosion_allowance, 0))
        self.default_insu = max(0.0, fnum(opt.default_insulation_thickness, 0))
        self.auto_ref = 1
    def next(self):
        n = self.node; self.node += self.step; return n
    def ref(self):
        r = f'AUTO-{self.auto_ref}'; self.auto_ref += 1; return r


def dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3))) if a and b else 0.0


def bend_radius(block, ps):
    val = mm(block.get('BENDRADIUS') or block.get('BEND_RADIUS') or block.get('BRAD') or block.get('RADIUS'))
    if val and val > 0:
        return val
    c = ps.get('cpos') or ps.get('pos')
    return min(dist(c, ps.get('apos')), dist(c, ps.get('lpos'))) if c and ps.get('apos') and ps.get('lpos') else 0.0


def make_node(block, typ, ep, pos, ctx: Ctx, number=-1, bend_radius_value=0, bend_type=None, alpha=None):
    kind = support_kind(block) if typ == 'ATTA' else ''
    tag = support_tag(block) if typ == 'ATTA' else ''
    name = tag or s(block.get('NAME') or block.get('TAG') or block.get('__NEW__'))
    ref = tag or s(block.get('COMPONENTREFNO') or block.get('REFNO') or block.get('REF') or block.get('DBREF')) or ctx.ref()
    conn = kind or s(block.get('CONNECTIONTYPE') or block.get('CONN') or block.get('CONNECTION') or block.get('CREF') or block.get('CTYP'))
    ps = points(block)
    return {
        'number': number, 'name': name, 'endpoint': ep, 'ctype': typ, 'ref': ref, 'conn': conn,
        'od': bore(block, ctx.default_diameter),
        'wall': mm(block.get('WTHK') or block.get('WALLTHK') or block.get('WALL_THICKNESS')) or ctx.default_wall,
        'corr': mm(block.get('CORA') or block.get('CORROSIONALLOWANCE')) or ctx.default_corr,
        'insu': mm(block.get('INSU') or block.get('INSULATIONTHICKNESS')) or ctx.default_insu,
        'pos': pos, 'br': bend_radius_value, 'bt': bend_type, 'alpha': alpha,
        'sif': fnum(block.get('SIF'), 0), 'weight': fnum(block.get('WEIG') or block.get('WEIGHT'), 0),
        'restraints': restraints(block, ps, ctx.opt) if typ == 'ATTA' else [],
    }


def expand(block, ctx: Ctx):
    typ = component_type(block)
    ps = points(block)
    base = ps.get('support') or ps.get('pos') or ps.get('cpos') or ps.get('apos') or ps.get('lpos') or ps.get('bpos')
    if typ == 'UNKNOWN' or not base:
        return []
    if typ == 'ELBO':
        r = bend_radius(block, ps)
        return [make_node(block, typ, 1, ps.get('apos') or base, ctx, -1, r, 0), make_node(block, typ, 0, ps.get('cpos') or ps.get('pos') or base, ctx, ctx.next(), r, 1), make_node(block, typ, 2, ps.get('lpos') or base, ctx, -1, r, 0)]
    if typ in ('TEE', 'OLET'):
        center = ps.get('pos') or ps.get('cpos') or base
        return [make_node(block, typ, 1, ps.get('apos') or center, ctx), make_node(block, typ, 3, ps.get('bpos') or ps.get('lpos') or center, ctx), make_node(block, typ, 0, center, ctx, ctx.next()), make_node(block, typ, 2, ps.get('lpos') or center, ctx)]
    if typ == 'REDU':
        alpha = mm(block.get('ALPHAANGLE') or block.get('ALPHA_ANGLE') or block.get('ANGLE')) or 1.0
        return [make_node(block, typ, 1, ps.get('apos') or base, ctx), make_node(block, typ, 0, ps.get('pos') or base, ctx, ctx.next(), alpha=alpha), make_node(block, typ, 2, ps.get('lpos') or base, ctx)]
    if typ == 'ATTA':
        return [make_node(block, typ, 0, base, ctx, ctx.next())]
    if ps.get('apos') and ps.get('lpos'):
        return [make_node(block, typ, 1, ps['apos'], ctx), make_node(block, typ, 0, ps.get('pos') or ps['apos'], ctx, ctx.next()), make_node(block, typ, 2, ps['lpos'], ctx)]
    return [make_node(block, typ, 0, base, ctx, ctx.next())]


def node_xml(n: dict) -> str:
    p = n['pos']
    lines = [
        '      <Node>', f"        <NodeNumber>{n['number']}</NodeNumber>", f"        <NodeName>{x(n['name'])}</NodeName>", f"        <Endpoint>{n['endpoint']}</Endpoint>",
        f"        <ComponentType>{x(n['ctype'])}</ComponentType>", f"        <Weight>{nfmt(n['weight'])}</Weight>", f"        <ComponentRefNo>{x(n['ref'])}</ComponentRefNo>",
        f"        <ConnectionType>{x(n['conn'])}</ConnectionType>", f"        <OutsideDiameter>{nfmt(n['od'])}</OutsideDiameter>", f"        <WallThickness>{nfmt(n['wall'])}</WallThickness>",
        f"        <CorrosionAllowance>{nfmt(n['corr'])}</CorrosionAllowance>", f"        <InsulationThickness>{nfmt(n['insu'])}</InsulationThickness>",
        f"        <Position>{p[0]:.2f} {p[1]:.2f} {p[2]:.2f}</Position>", f"        <BendRadius>{nfmt(n['br'])}</BendRadius>",
    ]
    if n['bt'] is not None: lines.append(f"        <BendType>{n['bt']}</BendType>")
    if n['alpha'] is not None: lines.append(f"        <AlphaAngle>{nfmt(n['alpha'])}</AlphaAngle>")
    lines.append(f"        <SIF>{n['sif']}</SIF>")
    for r in n.get('restraints') or []:
        lines += ['        <Restraint>', f"          <Type>{x(r['type'])}</Type>", f"          <Stiffness>{x(r['stiffness'])}</Stiffness>", f"          <Gap>{x(r['gap'])}</Gap>", f"          <Friction>{x(r['friction'])}</Friction>", '        </Restraint>']
    lines.append('      </Node>')
    return '\n'.join(lines)


def convert(input_path: Path, output_path: Path, opt):
    text = read_attribute_text(input_path)
    blocks = parse_blocks(text)
    ctx = Ctx(opt)
    project = input_path.stem
    count = skipped = restraint_count = 0
    bytype = {}
    lines = ['<?xml version="1.0" encoding="utf-8"?>', '<PipeStressExport xmlns="http://aveva.com/pipeStress116.xsd">']
    lines += ['  <DateTime></DateTime>', f'  <Source>{x(opt.source)}</Source>', '  <Version>0.0.0.0</Version>', '  <UserName>browser-runtime</UserName>', f'  <Purpose>{x(opt.purpose)}</Purpose>', f'  <ProjectName>{x(project)}</ProjectName>', f'  <MDBName>/{x(project)}</MDBName>', f'  <TitleLine>{x(opt.title_line)}</TitleLine>', '  <!-- Configuration information -->', '  <RestrainOpenEnds>No</RestrainOpenEnds>', '  <AmbientTemperature>0</AmbientTemperature>', '  <Pipe>', f'    <FullName>/{x(project)}</FullName>', '    <Ref></Ref>', '    <Branch>', f'      <Branchname>{x(project)}</Branchname>']
    lines.append('      <Temperature>' + ''.join(f'<Temperature{i}>-100000</Temperature{i}>' for i in range(1, 10)) + '</Temperature>')
    lines.append('      <Pressure>' + ''.join(f'<Pressure{i}>0</Pressure{i}>' for i in range(1, 10)) + '</Pressure>')
    lines += ['      <MaterialNumber>0</MaterialNumber>', '      <InsulationDensity>0</InsulationDensity>', '      <FluidDensity>0</FluidDensity>']
    for block in blocks:
        nodes = expand(block, ctx)
        if not nodes:
            skipped += 1
            continue
        for node in nodes:
            lines.append(node_xml(node))
            count += 1
            restraint_count += len(node.get('restraints') or [])
            bytype[node['ctype']] = bytype.get(node['ctype'], 0) + 1
    lines += ['    </Branch>', '  </Pipe>', f'  <!-- Attribute TXT upstream XML generated {count} Node records; support restraints {restraint_count}; skipped {skipped}. Counts: {bytype} -->', '</PipeStressExport>']
    output_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f"Wrote {output_path} with {count} XML nodes; support restraints {restraint_count}; preserved counts: {bytype}; skipped {skipped}.")


def main():
    parser = argparse.ArgumentParser(description='Convert AVEVA/RMSS attribute TXT to PSI116 XML.')
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--node-start', type=int, default=10)
    parser.add_argument('--node-step', type=int, default=10)
    parser.add_argument('--source', default='AVEVA PSI')
    parser.add_argument('--purpose', default='RMSS attribute TXT conversion')
    parser.add_argument('--title-line', default='RMSS Attribute TXT Output')
    parser.add_argument('--default-diameter', type=float, default=100.0)
    parser.add_argument('--default-wall-thickness', type=float, default=0.01)
    parser.add_argument('--default-insulation-thickness', type=float, default=0.0)
    parser.add_argument('--default-corrosion-allowance', type=float, default=0.0)
    parser.add_argument('--support-stiffness', default='')
    parser.add_argument('--support-gap', default='')
    parser.add_argument('--support-friction', default='0.3')
    parser.add_argument('--guide-gap', default='')
    parser.add_argument('--line-stop-gap', default='')
    parser.add_argument('--limit-gap', default='')
    parser.add_argument('--rest-gap', default='')
    parser.add_argument('--anchor-gap', default='')
    parser.add_argument('--support-pipe-axis', default='X')
    parser.add_argument('--vertical-axis', default='Y')
    parser.add_argument('--line-stop-direction', default='')
    parser.add_argument('--limit-direction', default='')
    parser.add_argument('--rest-direction', default='')
    args = parser.parse_args()
    convert(args.input, args.output, args)


if __name__ == '__main__':
    main()
