import fs from 'fs';
import { describe, expect, it } from 'vitest';

describe('Agent 19 - Real InputXML Audit', () => {
  it('Parses the 1001-P file and exports the summary', () => {
    const rawXml = fs.readFileSync('Benchmarks/INPUT XML to CII 2019/1001/1001-P - COPY_INPUT.XML', 'utf8');

    const elements = [...rawXml.matchAll(/<([a-zA-Z0-9_:-]+)/g)].map(m => m[1]);
    const counts = {};
    for (const el of elements) {
      counts[el] = (counts[el] || 0) + 1;
    }

    const attrs = {};
    for (const tag of Object.keys(counts)) {
      const tagRegex = new RegExp(`<${tag}[\\s>][\\s\\S]*?>`, 'g');
      const tagMatches = [...rawXml.matchAll(tagRegex)];
      attrs[tag] = {};

      for (const match of tagMatches) {
        const attrMatch = [...match[0].matchAll(/([a-zA-Z0-9_:-]+)=["']/g)];
        for (const attr of attrMatch) {
          attrs[tag][attr[1]] = (attrs[tag][attr[1]] || 0) + 1;
        }
      }
    }

    const report = {
      rootTags: elements.filter((v, i, a) => a.indexOf(v) === i).slice(0, 5),
      topTagFrequency: counts,
      attributeCatalog: attrs,
    };

    fs.writeFileSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-audit.json', JSON.stringify(report, null, 2));

    const md = `# Schema Audit: 1001-P COPY_INPUT.XML

## Root Tag and Namespace Report
- Root tag: \`<CAESARII>\`
- No namespaces are defined in the document.

## Top Tag Frequency
` + Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join('\n') + `

## Attribute Catalog by Tag
` + Object.entries(attrs).filter(([tag, obj]) => Object.keys(obj).length > 0).map(([tag, obj]) => {
  return `### ${tag}\n` + Object.entries(obj).map(([attr, count]) => `- ${attr}: ${count}`).join('\n');
}).join('\n\n') + `

## Candidate Tags

### Pipeline/Line Tags
- PIPINGMODEL (acts as the overall container, has NAME attribute)

### Component Tags
- PIPINGELEMENT (acts as pipe and fitting container)
- RIGID (contains TYPE="Valve" or TYPE="Flange Pair")

### Coordinate/Node Tags
- No distinct Node list.
- Embedded in PIPINGELEMENT via FROM_NODE, TO_NODE, DELTA_X, DELTA_Y, DELTA_Z.

### Support Tags
- HANGER
- RESTRAINT

### Branch/Tee/Olet Tags
- SIF (contains TYPE="Tee", TYPE="Weldolet")
- BEND

### Bore/Size/Rating/Class/Ref/Seq Fields
- Bores: DIAMETER, WALL_THICK
- Ref: NAME
- Rating/Class: MATERIAL_NAME, MATERIAL_NUM

## Source-field -> UXML-field mapping table
| Source Field | UXML Field |
| :--- | :--- |
| PIPINGMODEL | Pipeline |
| PIPINGELEMENT | Component |
| RIGID TYPE="Valve" | Valve Component |
| RIGID TYPE="Flange Pair" | Flange Component |
| FROM_NODE | Anchor EP1 |
| TO_NODE | Anchor EP2 |
| DELTA_X | Relative X |
| DELTA_Y | Relative Y |
| DELTA_Z | Relative Z |

## Expected extraction counts
- Pipelines: 1
- Components: ~15
- Anchors: ~30
- Ports: ~30
- Segments: ~15
- Supports: 0

## Gaps/Ambiguities Requiring Fallback Logic
Unlike standard AVEVA InputXML which uses \`<Element type="PIPE">\` with \`<Node>\` lists, this file uses a CAESAR II specific format:
- Root is \`<CAESARII>\` -> \`<PIPINGMODEL>\`
- Elements are \`<PIPINGELEMENT>\`
- No explicit \`<Node>\` coordinate dictionary. Instead, it uses \`FROM_NODE\`, \`TO_NODE\`, and \`DELTA_X/Y/Z\`. This requires calculating absolute coordinates incrementally or using the relative delta values if an origin is established.
- Components like Valves and Flanges are declared via \`<RIGID TYPE="Valve">\` children inside a \`<PIPINGELEMENT>\`.
- SIF tags are used for Tees.

This requires a completely custom mapper (Agent 20), as the Agent 18 adaptive mapper will not find any coordinates or traditional component structures.
`;

    fs.writeFileSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-mapping-plan.md', md);

    expect(counts['PIPINGELEMENT']).toBeGreaterThan(0);
  });
});
