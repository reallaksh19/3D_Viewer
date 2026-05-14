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

## Top Tag Frequency
` + Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join('\n') + `

## Candidate Tags

- Pipeline/Line: PIPINGMODEL (has NAME)
- Components: PIPINGELEMENT (acts as pipe and fitting container)
- Supports: SUPPORT (child of PIPINGELEMENT)
- Coordinates: FROM_NODE, TO_NODE, DELTA_X, DELTA_Y, DELTA_Z on PIPINGELEMENT
- Bores/Sizes: DIAMETER, WALL_THICK

## Observations
Unlike standard AVEVA InputXML which uses \`<Element type="PIPE">\` with \`<Node>\` lists, this file uses a CAESAR II specific format:
- Root is \`<CAESARII>\` -> \`<PIPINGMODEL>\`
- Elements are \`<PIPINGELEMENT>\`
- No explicit \`<Node>\` coordinate dictionary. Instead, it uses \`FROM_NODE\`, \`TO_NODE\`, and \`DELTA_X/Y/Z\`.
- Components like Valves and Flanges are declared via \`<RIGID TYPE="Valve">\` children inside a \`<PIPINGELEMENT>\`.

This requires a completely custom mapper (Agent 20), as the Agent 18 adaptive mapper will not find any coordinates.
`;

    fs.writeFileSync('Benchmarks/InputXML Schema Audit/1001-P-COPY-inputxml-mapping-plan.md', md);

    expect(counts['PIPINGELEMENT']).toBeGreaterThan(0);
  });
});
