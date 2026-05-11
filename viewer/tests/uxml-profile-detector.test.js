import { describe, expect, it } from 'vitest';

import {
  UXML_SCHEMA_VERSION,
  XML_PROFILES,
} from '../uxml/UxmlConstants.js';

import {
  assertXmlProfileBuildAllowed,
  detectUxmlProfile,
  detectXmlProfile,
  UXML_PROFILE_CONFIDENCE,
} from '../uxml/UxmlProfileDetector.js';

function expectStableReportShape(report) {
  expect(report).toHaveProperty('schema');
  expect(report).toHaveProperty('profile');
  expect(report).toHaveProperty('confidence');
  expect(report).toHaveProperty('reasons');
  expect(report).toHaveProperty('warnings');
  expect(report).toHaveProperty('blockers');
  expect(report).toHaveProperty('isXml');
  expect(report).toHaveProperty('isKnownProfile');
  expect(report).toHaveProperty('shouldBlockTopologyBuild');
  expect(report).toHaveProperty('stats');

  expect(Array.isArray(report.reasons)).toBe(true);
  expect(Array.isArray(report.warnings)).toBe(true);
  expect(Array.isArray(report.blockers)).toBe(true);

  expect(report.stats).toHaveProperty('characterCount');
  expect(report.stats).toHaveProperty('rootName');
  expect(report.stats).toHaveProperty('localRootName');
  expect(report.stats).toHaveProperty('markerHits');
  expect(report.stats).toHaveProperty('profileScores');
  expect(report.stats).toHaveProperty('ambiguousProfiles');
}

describe('UxmlProfileDetector', () => {
  it('returns stable report shape for empty input', () => {
    const report = detectUxmlProfile('');

    expectStableReportShape(report);
    expect(report.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(report.isXml).toBe(false);
    expect(report.shouldBlockTopologyBuild).toBe(true);
    expect(report.blockers).toContain('XML-PROFILE-EMPTY-INPUT');
  });

  it('handles null input safely', () => {
    const report = detectUxmlProfile(null);

    expectStableReportShape(report);
    expect(report.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(report.isXml).toBe(false);
    expect(report.shouldBlockTopologyBuild).toBe(true);
    expect(report.blockers).toContain('XML-PROFILE-EMPTY-INPUT');
  });

  it('blocks non-XML text', () => {
    const report = detectUxmlProfile('PIPELINE-REFERENCE /A/B\nPIPE\nEND-POINT 0 0 0');

    expect(report.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(report.isXml).toBe(false);
    expect(report.isKnownProfile).toBe(false);
    expect(report.shouldBlockTopologyBuild).toBe(true);
    expect(report.blockers).toContain('XML-PROFILE-NOT-XML');
  });

  it('detects UXML by root element', () => {
    const report = detectUxmlProfile(`
      <?xml version="1.0"?>
      <UXML version="1.0" profile="UXML-TOPOLOGY-FULL">
        <Components/>
      </UXML>
    `);

    expect(report.profile).toBe(XML_PROFILES.UXML);
    expect(report.confidence).toBe(UXML_PROFILE_CONFIDENCE.HIGH);
    expect(report.isXml).toBe(true);
    expect(report.isKnownProfile).toBe(true);
    expect(report.shouldBlockTopologyBuild).toBe(false);
    expect(report.stats.localRootName).toBe('uxml');
  });

  it('detects UXML by schema version even when root is generic', () => {
    const report = detectUxmlProfile(`
      <Document schemaVersion="${UXML_SCHEMA_VERSION}">
        <Header/>
      </Document>
    `);

    expect(report.profile).toBe(XML_PROFILES.UXML);
    expect(report.confidence).toBe(UXML_PROFILE_CONFIDENCE.HIGH);
    expect(report.shouldBlockTopologyBuild).toBe(false);
    expect(report.reasons.join(' ')).toContain(UXML_SCHEMA_VERSION);
  });

  it('detects INPUT_XML markers', () => {
    const report = detectUxmlProfile(`
      <InputXML>
        <Nodes>
          <Node number="10"/>
        </Nodes>
        <Elements>
          <Element number="20"/>
        </Elements>
        <Restraints>
          <Restraint node="10"/>
        </Restraints>
        <LoadCases/>
      </InputXML>
    `);

    expect(report.profile).toBe(XML_PROFILES.INPUT_XML);
    expect(report.isKnownProfile).toBe(true);
    expect(report.shouldBlockTopologyBuild).toBe(false);
    expect(report.stats.markerHits.inputXml.length).toBeGreaterThan(0);
  });

  it('detects STANDARD_XML markers', () => {
    const report = detectUxmlProfile(`
      <Project>
        <Pipelines>
          <Pipeline pipelineRef="/BTRM-1000-10-P1710011-66620M0-01/B1">
            <Components>
              <Component type="PIPE" skey="PIPE">
                <EndPoint id="ep1"/>
                <EndPoint id="ep2"/>
              </Component>
            </Components>
          </Pipeline>
        </Pipelines>
      </Project>
    `);

    expect(report.profile).toBe(XML_PROFILES.STANDARD_XML);
    expect(report.isKnownProfile).toBe(true);
    expect(report.shouldBlockTopologyBuild).toBe(false);
    expect(report.stats.markerHits.standardXml.length).toBeGreaterThan(0);
  });

  it('detects BENCHMARK_XML markers', () => {
    const report = detectUxmlProfile(`
      <BenchmarkCase>
        <ExpectedResult>
          <Assertion code="COMPONENT-COUNT"/>
          <Golden/>
          <Baseline/>
        </ExpectedResult>
      </BenchmarkCase>
    `);

    expect(report.profile).toBe(XML_PROFILES.BENCHMARK_XML);
    expect(report.isKnownProfile).toBe(true);
    expect(report.shouldBlockTopologyBuild).toBe(false);
    expect(report.stats.markerHits.benchmarkXml.length).toBeGreaterThan(0);
  });

  it('blocks unknown XML', () => {
    const report = detectUxmlProfile(`
      <RandomDocument>
        <Foo>Bar</Foo>
      </RandomDocument>
    `);

    expect(report.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(report.confidence).toBe(UXML_PROFILE_CONFIDENCE.NONE);
    expect(report.isXml).toBe(true);
    expect(report.isKnownProfile).toBe(false);
    expect(report.shouldBlockTopologyBuild).toBe(true);
    expect(report.blockers).toContain('XML-PROFILE-UNKNOWN');
  });

  it('blocks ambiguous XML profile markers', () => {
    const report = detectUxmlProfile(`
      <Mixed>
        <InputXML/>
        <Project/>
      </Mixed>
    `);

    expect(report.profile).toBe(XML_PROFILES.UNKNOWN_XML);
    expect(report.confidence).toBe(UXML_PROFILE_CONFIDENCE.AMBIGUOUS);
    expect(report.isXml).toBe(true);
    expect(report.isKnownProfile).toBe(false);
    expect(report.shouldBlockTopologyBuild).toBe(true);
    expect(report.blockers).toContain('XML-PROFILE-AMBIGUOUS');
    expect(report.stats.ambiguousProfiles).toContain(XML_PROFILES.INPUT_XML);
    expect(report.stats.ambiguousProfiles).toContain(XML_PROFILES.STANDARD_XML);
  });

  it('provides detectXmlProfile alias', () => {
    const report = detectXmlProfile('<UXML/>');

    expect(report.profile).toBe(XML_PROFILES.UXML);
    expect(report.shouldBlockTopologyBuild).toBe(false);
  });

  it('asserts build allowed only for non-blocked known profiles', () => {
    const good = detectUxmlProfile('<UXML/>');
    const bad = detectUxmlProfile('<Unknown/>');

    expect(assertXmlProfileBuildAllowed(good)).toEqual({
      ok: true,
      blockers: [],
    });

    expect(assertXmlProfileBuildAllowed(bad).ok).toBe(false);
    expect(assertXmlProfileBuildAllowed(bad).blockers).toContain('XML-PROFILE-UNKNOWN');
  });
});