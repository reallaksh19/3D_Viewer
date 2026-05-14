import { describe, expect, it } from 'vitest';

import {
  XML_PROFILES,
} from '../uxml/UxmlConstants.js';

import {
  createUxmlDocument,
  createUxmlSource,
} from '../uxml/UxmlTypes.js';

import {
  mapInputXmlToUxml,
  mapInputXmlSchemaToUxml,
} from '../uxml/UxmlInputXmlSchemaMapper.js';

import {
  normalizeXmlToUxml,
} from '../uxml/UxmlNormalizer.js';

const INPUT_XML_VARIANT = `
<?xml version="1.0"?>
<PlantModel>
  <Pipeline name="L-1001" pipelineRef="/P1">
    <Node id="N1" x="0" y="0" z="0"/>
    <Node id="N2" x="1000" y="0" z="0"/>
    <Node id="N3" x="1200" y="0" z="0"/>
    <Node id="N4" x="2200" y="0" z="0"/>

    <Element id="PIPE-1" type="PIPE" pipelineRef="/P1" lineNo="L-1001" bore="250" startNode="N1" endNode="N2" refNo="REF-P1" seqNo="10"/>
    <Element id="VALVE-1" type="VALVE" pipelineRef="/P1" lineNo="L-1001" bore="250" startNode="N2" endNode="N3" refNo="REF-V1" seqNo="20"/>
    <Pipe id="PIPE-2" pipelineRef="/P1" lineNo="L-1001" bore="250" ep1="1200,0,0" ep2="2200,0,0" refNo="REF-P2" seqNo="30"/>
  </Pipeline>
</PlantModel>
`;

const BRANCH_XML_VARIANT = `
<?xml version="1.0"?>
<PlantModel>
  <Pipe id="HEADER-1" pipelineRef="/P2" lineNo="L-2001" bore="300" ep1="0,0,0" ep2="2000,0,0" refNo="REF-H" seqNo="10"/>
  <Tee id="TEE-1" pipelineRef="/P2" lineNo="L-2001" bore="300" branchBore="100" ep1="2000,0,0" ep2="2200,0,0" cp="2100,0,0" bp="2100,200,0" refNo="REF-T" seqNo="20"/>
  <Olet id="OLET-1" pipelineRef="/P2" lineNo="L-2001" bore="300" branchBore="80" cp="1000,0,0" bp="1000,250,0" refNo="REF-O" seqNo="30"/>
  <Support id="SUP-1" type="PS-GUIDE" pipelineRef="/P2" lineNo="L-2001" supportCoord="500,0,-250" refNo="REF-S" seqNo="40"/>
</PlantModel>
`;

function freshDoc() {
  const doc = createUxmlDocument();
  doc.sources.push(createUxmlSource({
    id: 'SRC-1',
    format: XML_PROFILES.INPUT_XML,
    name: 'test-input.xml',
    role: 'PRIMARY',
  }));
  return doc;
}

describe('UxmlInputXmlSchemaMapper Agent 18', () => {
  it('maps node-referenced InputXML elements into UXML components and anchors', () => {
    const doc = freshDoc();

    const result = mapInputXmlToUxml(INPUT_XML_VARIANT, doc, 'SRC-1', {
      fileName: '1001-P - COPY_INPUT.XML',
    });

    expect(result.schema).toBe('uxml-inputxml-schema-mapper/v1');
    expect(result.ok).toBe(true);
    expect(doc.components).toHaveLength(3);
    expect(doc.anchors.length).toBeGreaterThanOrEqual(6);
    expect(doc.ports.length).toBeGreaterThanOrEqual(6);
    expect(doc.segments).toHaveLength(3);

    const pipe = doc.components.find(c => c.id === 'PIPE-1');
    expect(pipe).toBeTruthy();
    expect(pipe.normalizedType).toBe('PIPE');
    expect(pipe.pipelineRef).toBe('/P1');
    expect(pipe.lineKey).toBe('L-1001');
    expect(pipe.refNo).toBe('REF-P1');
    expect(pipe.seqNo).toBe('10');
  });

  it('maps branch components and supports with CP/BP/support anchors', () => {
    const doc = freshDoc();

    const result = mapInputXmlToUxml(BRANCH_XML_VARIANT, doc, 'SRC-1', {
      fileName: 'branch_INPUT.XML',
    });

    expect(result.ok).toBe(true);

    const tee = doc.components.find(c => c.id === 'TEE-1');
    const olet = doc.components.find(c => c.id === 'OLET-1');
    const support = doc.components.find(c => c.id === 'SUP-1');

    expect(tee).toBeTruthy();
    expect(olet).toBeTruthy();
    expect(support).toBeTruthy();

    expect(tee.anchorIds.some(id => id.includes('BP'))).toBe(true);
    expect(olet.anchorIds.some(id => id.includes('CP'))).toBe(true);
    expect(olet.anchorIds.some(id => id.includes('BP'))).toBe(true);

    expect(doc.supports).toHaveLength(1);
    expect(doc.supports[0].componentId).toBe('SUP-1');
  });

  it('does not mutate source XML and records diagnostics/loss for partial schemas', () => {
    const xml = '<PlantModel><UnknownThing id="X1"/></PlantModel>';
    const before = String(xml);
    const doc = freshDoc();

    const result = mapInputXmlToUxml(xml, doc, 'SRC-1', {
      fileName: 'unknown_INPUT.XML',
    });

    expect(xml).toBe(before);
    expect(result.ok).toBe(false);
    expect(doc.components).toHaveLength(0);
    expect(doc.lossContract.some(l => l.code === 'UXML-INPUTXML-MAPPER-NO-COMPONENT-TAGS')).toBe(true);
    expect(doc.diagnostics.some(d => d.code === 'UXML-INPUTXML-MAPPER-ZERO-COMPONENTS')).toBe(true);
  });

  it('normalizer uses adaptive mapper for filename-hinted InputXML variants', () => {
    const result = normalizeXmlToUxml(INPUT_XML_VARIANT, {
      fileName: '1001-P - COPY_INPUT.XML',
      selectedSourceType: 'INPUT_XML',
      profileReport: {
        profile: XML_PROFILES.INPUT_XML,
        blockers: [],
        confidence: 'MEDIUM',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.uxml.components.length).toBe(3);
    expect(result.uxml.anchors.length).toBeGreaterThanOrEqual(6);
    expect(result.uxml.segments.length).toBe(3);
    expect(result.diagnostics.some(d => d.code === 'UXML-NORMALIZER-INPUTXML-MAPPER-OK')).toBe(true);
  });

  it('provides alias export', () => {
    const doc = freshDoc();

    const result = mapInputXmlSchemaToUxml(INPUT_XML_VARIANT, doc, 'SRC-1', {
      fileName: 'alias_INPUT.XML',
    });

    expect(result.schema).toBe('uxml-inputxml-schema-mapper/v1');
    expect(result.ok).toBe(true);
  });
});