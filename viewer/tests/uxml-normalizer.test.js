import { describe, expect, it } from 'vitest';

import {
  ANCHOR_ROLES,
  COMPONENT_TYPES,
  PORT_ROLES,
  SEGMENT_TYPES,
  UXML_PROFILES,
  XML_PROFILES,
} from '../uxml/UxmlConstants.js';

import {
  normalizeToUxml,
  normalizeXmlToUxml,
} from '../uxml/UxmlNormalizer.js';

describe('UxmlNormalizer Agent 02 skeleton', () => {
  it('blocks non-XML input and returns UXML-shaped diagnostic document', () => {
    const result = normalizeXmlToUxml('PIPELINE-REFERENCE X\nPIPE');

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.profileReport.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(result.uxml.sources.length).toBe(1);
    expect(result.uxml.diagnostics[0].severity).toBe('ERROR');
    expect(result.uxml.lossContract[0].severity).toBe('ERROR');
  });

  it('preserves already-UXML input as source with pass-through diagnostic', () => {
    const result = normalizeXmlToUxml(`
      <UXML version="1.0" profile="UXML-TOPOLOGY-FULL">
        <Components/>
      </UXML>
    `);

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.profileReport.profile).toBe(XML_PROFILES.UXML);
    expect(result.uxml.profile).toBe(UXML_PROFILES.TOPOLOGY_FULL);
    expect(result.uxml.sources.length).toBe(1);
    expect(result.uxml.diagnostics.some(d => d.code === 'UXML-PASSTHROUGH-PROFILE-DETECTED')).toBe(true);
  });

  it('normalizes STANDARD_XML pipe component into component, anchors, ports and segment', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component
          id="PIPE-001"
          type="PIPE"
          pipelineRef="/BTRM-1000-10-P1710011-66620M0-01/B1"
          lineNo="BTRM-1000-10-P1710011"
          refNo="REF-PIPE-001"
          seqNo="10"
          bore="250"
          ep1="0,0,0"
          ep2="1000,0,0"
          skey="PIPE"
        />
      </Project>
    `);

    expect(result.ok).toBe(true);
    expect(result.profileReport.profile).toBe(XML_PROFILES.STANDARD_XML);

    expect(result.uxml.components.length).toBe(1);
    expect(result.uxml.anchors.length).toBe(2);
    expect(result.uxml.ports.length).toBe(2);
    expect(result.uxml.segments.length).toBe(1);
    expect(result.uxml.pipelines.length).toBe(1);

    const component = result.uxml.components[0];
    expect(component.id).toBe('PIPE-001');
    expect(component.normalizedType).toBe(COMPONENT_TYPES.PIPE);
    expect(component.refNo).toBe('REF-PIPE-001');
    expect(component.seqNo).toBe('10');
    expect(component.bore).toBe(250);
    expect(component.anchorIds.length).toBe(2);
    expect(component.portIds.length).toBe(2);
    expect(component.segmentIds.length).toBe(1);

    expect(result.uxml.anchors.map(a => a.role)).toEqual([
      ANCHOR_ROLES.EP1,
      ANCHOR_ROLES.EP2,
    ]);

    expect(result.uxml.ports.map(p => p.role)).toEqual([
      PORT_ROLES.PIPE_END_1,
      PORT_ROLES.PIPE_END_2,
    ]);

    expect(result.uxml.segments[0].type).toBe(SEGMENT_TYPES.PIPE_RUN);
  });

  it('normalizes STANDARD_XML tee with branch point', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component
          id="TEE-001"
          type="TEE"
          pipelineRef="/P1"
          bore="250"
          branchBore="100"
          ep1="0,0,0"
          ep2="1000,0,0"
          cp="500,0,0"
          bp="500,300,0"
        />
      </Project>
    `);

    expect(result.ok).toBe(true);

    const component = result.uxml.components[0];
    expect(component.normalizedType).toBe(COMPONENT_TYPES.TEE);
    expect(component.branchBore).toBe(100);

    expect(result.uxml.anchors.map(a => a.role)).toContain(ANCHOR_ROLES.BP);
    expect(result.uxml.anchors.map(a => a.role)).toContain(ANCHOR_ROLES.CP);
    expect(result.uxml.ports.map(p => p.role)).toContain(PORT_ROLES.TEE_BRANCH);
  });

  it('normalizes STANDARD_XML olet with CP/BP and creates OLET ports', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component
          id="OLET-001"
          type="OLET"
          pipelineRef="/P1"
          bore="250"
          branchBore="100"
          cp="500,0,0"
          bp="500,250,0"
        />
      </Project>
    `);

    expect(result.ok).toBe(true);

    const component = result.uxml.components[0];
    expect(component.normalizedType).toBe(COMPONENT_TYPES.OLET);
    expect(result.uxml.anchors.map(a => a.role)).toContain(ANCHOR_ROLES.CP);
    expect(result.uxml.anchors.map(a => a.role)).toContain(ANCHOR_ROLES.BP);
    expect(result.uxml.ports.map(p => p.role)).toContain(PORT_ROLES.OLET_HEADER_TAP);
    expect(result.uxml.ports.map(p => p.role)).toContain(PORT_ROLES.OLET_BRANCH);
  });

  it('adds loss for STANDARD_XML tee missing BP', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component id="TEE-002" type="TEE" pipelineRef="/P1" ep1="0,0,0" ep2="1000,0,0" />
      </Project>
    `);

    expect(result.ok).toBe(true);
    expect(result.uxml.lossContract.some(l => l.code === 'UXML-TEE-BP-MISSING')).toBe(true);
  });

  it('adds loss for STANDARD_XML olet missing CP/BP pair', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component id="OLET-002" type="OLET" pipelineRef="/P1" bp="500,250,0" />
      </Project>
    `);

    expect(result.ok).toBe(true);
    expect(result.uxml.lossContract.some(l => l.code === 'UXML-OLET-CP-BP-INCOMPLETE')).toBe(true);
  });

  it('normalizes INPUT_XML nodes/elements into component anchors ports and segment', () => {
    const result = normalizeXmlToUxml(`
      <InputXML>
        <Nodes>
          <Node id="N1" x="0" y="0" z="0"/>
          <Node id="N2" x="1000" y="0" z="0"/>
        </Nodes>
        <Elements>
          <Element
            id="E1"
            type="PIPE"
            startNode="N1"
            endNode="N2"
            pipelineRef="/P1"
            bore="250"
          />
        </Elements>
      </InputXML>
    `);

    expect(result.ok).toBe(true);
    expect(result.profileReport.profile).toBe(XML_PROFILES.INPUT_XML);
    expect(result.uxml.components.length).toBe(1);
    expect(result.uxml.anchors.length).toBe(2);
    expect(result.uxml.ports.length).toBe(2);
    expect(result.uxml.segments.length).toBe(1);

    const component = result.uxml.components[0];
    expect(component.id).toBe('E1');
    expect(component.normalizedType).toBe(COMPONENT_TYPES.PIPE);
    expect(component.rawAttributes.startNode).toBe('N1');
    expect(component.rawAttributes.endNode).toBe('N2');

    expect(result.uxml.diagnostics.some(d => d.code === 'UXML-NORMALIZER-INPUTXML-NODES-READ')).toBe(true);
  });

  it('adds loss when INPUT_XML element endpoint nodes are incomplete', () => {
    const result = normalizeXmlToUxml(`
      <InputXML>
        <Nodes>
          <Node id="N1" x="0" y="0" z="0"/>
        </Nodes>
        <Elements>
          <Element id="E2" type="PIPE" startNode="N1" endNode="N404" />
        </Elements>
      </InputXML>
    `);

    expect(result.ok).toBe(true);
    expect(result.uxml.components.length).toBe(1);
    expect(result.uxml.lossContract.some(l => l.code === 'UXML-INPUTXML-ELEMENT-ENDPOINT-INCOMPLETE')).toBe(true);
  });

  it('preserves BENCHMARK_XML as source only and does not invent topology', () => {
    const result = normalizeXmlToUxml(`
      <BenchmarkCase>
        <ExpectedResult>
          <Assertion code="COMPONENT-COUNT"/>
        </ExpectedResult>
      </BenchmarkCase>
    `);

    expect(result.ok).toBe(true);
    expect(result.profileReport.profile).toBe(XML_PROFILES.BENCHMARK_XML);
    expect(result.uxml.components.length).toBe(0);
    expect(result.uxml.anchors.length).toBe(0);
    expect(result.uxml.lossContract.some(l => l.code === 'UXML-BENCHMARK-NOT-TOPOLOGY-SOURCE')).toBe(true);
  });

  it('provides normalizeToUxml alias', () => {
    const result = normalizeToUxml(`
      <Project>
        <Component id="PIPE-A" type="PIPE" ep1="0,0,0" ep2="1,0,0"/>
      </Project>
    `);

    expect(result.ok).toBe(true);
    expect(result.uxml.components[0].id).toBe('PIPE-A');
  });

  it('returns stable stats for normalizer output', () => {
    const result = normalizeXmlToUxml(`
      <Project>
        <Component id="PIPE-STATS" type="PIPE" pipelineRef="/P1" ep1="0,0,0" ep2="100,0,0"/>
      </Project>
    `);

    expect(result.stats).toEqual({
      sourceCount: 1,
      mappingCount: 5,
      pipelineCount: 1,
      componentCount: 1,
      anchorCount: 2,
      portCount: 2,
      segmentCount: 1,
      supportCount: 0,
      lossCount: 0,
      diagnosticCount: 2,
    });
  });
});