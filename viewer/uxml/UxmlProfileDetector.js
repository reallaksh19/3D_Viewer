/**
 * UxmlProfileDetector.js
 *
 * Agent 01: XML profile detector for the Universal XML (UXML) program.
 *
 * Scope:
 * - Detect XML profile family.
 * - Return stable detection report.
 * - Block unknown / ambiguous / non-XML input.
 *
 * Out of scope:
 * - UXML normalization.
 * - Topology building.
 * - Ray logic.
 * - PCF emission.
 * - Master resolution.
 */

import {
  UXML_SCHEMA_VERSION,
  XML_PROFILES,
} from './UxmlConstants.js';

const DETECTOR_SCHEMA = 'uxml-profile-detector/v1';

const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  NONE: 'NONE',
  AMBIGUOUS: 'AMBIGUOUS',
});

function cleanText(input) {
  if (input == null) return '';
  return String(input);
}

function stripXmlPreamble(text) {
  return String(text || '')
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^\s*<!--[\s\S]*?-->/g, '')
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, '')
    .trimStart();
}

function extractRootName(xmlText) {
  const stripped = stripXmlPreamble(xmlText);
  const match = stripped.match(/^<([A-Za-z_][\w:.-]*)\b/);

  if (!match) return '';

  return match[1] || '';
}

function localName(name) {
  const text = String(name || '');
  const parts = text.split(':');
  return parts[parts.length - 1] || text;
}

function containsAny(lowerText, needles) {
  const hits = [];

  for (const needle of needles) {
    const n = String(needle || '').toLowerCase();
    if (n && lowerText.includes(n)) {
      hits.push(needle);
    }
  }

  return hits;
}

function countTagHits(lowerText, tagNames) {
  const hits = [];

  for (const tagName of tagNames) {
    const tag = String(tagName || '').toLowerCase();
    if (!tag) continue;

    const re = new RegExp(`<\\s*(?:[a-z0-9_-]+:)?${tag}\\b`, 'i');
    if (re.test(lowerText)) {
      hits.push(tagName);
    }
  }

  return hits;
}

function unique(values) {
  const seen = new Set();
  return values.filter(Boolean).filter(v => {
    const key = String(v).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeEmptyReport(inputText = '') {
  return {
    schema: DETECTOR_SCHEMA,
    profile: XML_PROFILES.UNKNOWN_XML,
    confidence: CONFIDENCE.NONE,
    reasons: [],
    warnings: [],
    blockers: [],
    isXml: false,
    isKnownProfile: false,
    shouldBlockTopologyBuild: true,
    stats: {
      characterCount: inputText.length,
      rootName: '',
      localRootName: '',
      markerHits: {
        uxml: [],
        inputXml: [],
        standardXml: [],
        benchmarkXml: [],
      },
      profileScores: {
        [XML_PROFILES.UXML]: 0,
        [XML_PROFILES.INPUT_XML]: 0,
        [XML_PROFILES.STANDARD_XML]: 0,
        [XML_PROFILES.BENCHMARK_XML]: 0,
      },
      ambiguousProfiles: [],
    },
  };
}

function scoreUxml({ lowerText, rootLocal }) {
  const hits = [];

  if (rootLocal === 'uxml') hits.push('root:UXML');
  if (rootLocal === 'universalxml') hits.push('root:UniversalXML');
  if (lowerText.includes(UXML_SCHEMA_VERSION.toLowerCase())) {
    hits.push(`schemaVersion:${UXML_SCHEMA_VERSION}`);
  }
  if (lowerText.includes('uxml-topology')) hits.push('marker:uxml-topology');
  if (lowerText.includes('uxml-topology-full')) hits.push('profile:UXML-TOPOLOGY-FULL');

  return {
    score: hits.length ? 100 + hits.length : 0,
    hits,
  };
}

function scoreInputXml({ lowerText, rootLocal }) {
  const rootHits = [];

  if (rootLocal === 'inputxml') rootHits.push('root:InputXML');
  if (rootLocal === 'input-xml') rootHits.push('root:Input-XML');
  if (rootLocal === 'ciiinputxml') rootHits.push('root:CiiInputXml');

  const markerHits = containsAny(lowerText, [
    'inputxml',
    'input xml',
    'cii',
    'caesar',
    'stress',
    'loadcase',
    'restraint',
    'node number',
    'element number',
  ]);

  const tagHits = countTagHits(lowerText, [
    'InputXML',
    'CiiInputXml',
    'Node',
    'Nodes',
    'Element',
    'Elements',
    'Restraint',
    'Restraints',
    'LoadCase',
    'LoadCases',
  ]);

  const hits = unique([...rootHits, ...markerHits, ...tagHits]);

  return {
    score: rootHits.length ? 20 + hits.length : hits.length,
    hits,
  };
}

function scoreStandardXml({ lowerText, rootLocal }) {
  const rootHits = [];

  if (rootLocal === 'project') rootHits.push('root:Project');
  if (rootLocal === 'model') rootHits.push('root:Model');
  if (rootLocal === 'pipingmodel') rootHits.push('root:PipingModel');
  if (rootLocal === 'components') rootHits.push('root:Components');

  const markerHits = containsAny(lowerText, [
    'pipeline',
    'pipelineRef',
    'pipeline-ref',
    'component',
    'components',
    'fitting',
    'pipe',
    'skey',
    'ep1',
    'ep2',
    'centre-point',
    'center-point',
    'branch-point',
  ]);

  const tagHits = countTagHits(lowerText, [
    'Project',
    'Model',
    'PipingModel',
    'Pipeline',
    'Pipelines',
    'Component',
    'Components',
    'Pipe',
    'Fitting',
    'Support',
    'EndPoint',
    'CentrePoint',
    'CenterPoint',
    'BranchPoint',
  ]);

  const hits = unique([...rootHits, ...markerHits, ...tagHits]);

  return {
    score: rootHits.length ? 20 + hits.length : hits.length,
    hits,
  };
}

function scoreBenchmarkXml({ lowerText, rootLocal }) {
  const rootHits = [];

  if (rootLocal === 'benchmark') rootHits.push('root:Benchmark');
  if (rootLocal === 'benchmarkcase') rootHits.push('root:BenchmarkCase');
  if (rootLocal === 'expectedresult') rootHits.push('root:ExpectedResult');

  const markerHits = containsAny(lowerText, [
    'benchmark',
    'expected',
    'expected-output',
    'expected_result',
    'assertion',
    'golden',
    'baseline',
    'testcase',
    'test-case',
  ]);

  const tagHits = countTagHits(lowerText, [
    'Benchmark',
    'BenchmarkCase',
    'Expected',
    'ExpectedResult',
    'Assertion',
    'Golden',
    'Baseline',
    'TestCase',
  ]);

  const hits = unique([...rootHits, ...markerHits, ...tagHits]);

  return {
    score: rootHits.length ? 20 + hits.length : hits.length,
    hits,
  };
}

function profileConfidence(score, profile) {
  if (profile === XML_PROFILES.UNKNOWN_XML) return CONFIDENCE.NONE;
  if (profile === XML_PROFILES.UXML) return CONFIDENCE.HIGH;
  if (score >= 20) return CONFIDENCE.HIGH;
  if (score >= 3) return CONFIDENCE.MEDIUM;
  if (score > 0) return CONFIDENCE.LOW;
  return CONFIDENCE.NONE;
}

/**
 * Detects the XML profile family from raw text.
 *
 * @param {string} input Raw XML/text.
 * @returns {{
 *   schema: string,
 *   profile: string,
 *   confidence: string,
 *   reasons: string[],
 *   warnings: string[],
 *   blockers: string[],
 *   isXml: boolean,
 *   isKnownProfile: boolean,
 *   shouldBlockTopologyBuild: boolean,
 *   stats: object
 * }}
 */
export function detectUxmlProfile(input) {
  const text = cleanText(input);
  const report = makeEmptyReport(text);
  const trimmed = text.trim();

  if (!trimmed) {
    report.blockers.push('XML-PROFILE-EMPTY-INPUT');
    report.reasons.push('Input is empty.');
    return report;
  }

  const rootName = extractRootName(trimmed);
  const rootLocal = localName(rootName).toLowerCase();
  const lowerText = trimmed.toLowerCase();

  report.stats.rootName = rootName;
  report.stats.localRootName = rootLocal;
  report.isXml = trimmed.startsWith('<') && !!rootName;

  if (!report.isXml) {
    report.blockers.push('XML-PROFILE-NOT-XML');
    report.reasons.push('Input does not look like XML.');
    return report;
  }

  const uxml = scoreUxml({ lowerText, rootLocal });
  const inputXml = scoreInputXml({ lowerText, rootLocal });
  const standardXml = scoreStandardXml({ lowerText, rootLocal });
  const benchmarkXml = scoreBenchmarkXml({ lowerText, rootLocal });

  report.stats.markerHits.uxml = uxml.hits;
  report.stats.markerHits.inputXml = inputXml.hits;
  report.stats.markerHits.standardXml = standardXml.hits;
  report.stats.markerHits.benchmarkXml = benchmarkXml.hits;

  report.stats.profileScores = {
    [XML_PROFILES.UXML]: uxml.score,
    [XML_PROFILES.INPUT_XML]: inputXml.score,
    [XML_PROFILES.STANDARD_XML]: standardXml.score,
    [XML_PROFILES.BENCHMARK_XML]: benchmarkXml.score,
  };

  if (uxml.score > 0) {
    report.profile = XML_PROFILES.UXML;
    report.confidence = CONFIDENCE.HIGH;
    report.isKnownProfile = true;
    report.shouldBlockTopologyBuild = false;
    report.reasons.push(`Detected UXML profile using markers: ${uxml.hits.join(', ')}`);
    return report;
  }

  const scored = [
    { profile: XML_PROFILES.INPUT_XML, score: inputXml.score, hits: inputXml.hits },
    { profile: XML_PROFILES.STANDARD_XML, score: standardXml.score, hits: standardXml.hits },
    { profile: XML_PROFILES.BENCHMARK_XML, score: benchmarkXml.score, hits: benchmarkXml.hits },
  ].filter(item => item.score > 0);

  if (!scored.length) {
    report.profile = XML_PROFILES.UNKNOWN_XML;
    report.confidence = CONFIDENCE.NONE;
    report.isKnownProfile = false;
    report.shouldBlockTopologyBuild = true;
    report.blockers.push('XML-PROFILE-UNKNOWN');
    report.reasons.push('XML is well-formed-looking, but no known UXML gateway profile markers were found.');
    return report;
  }

  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;
  const topProfiles = scored.filter(item => item.score === topScore);

  if (topProfiles.length > 1) {
    report.profile = XML_PROFILES.UNKNOWN_XML;
    report.confidence = CONFIDENCE.AMBIGUOUS;
    report.isKnownProfile = false;
    report.shouldBlockTopologyBuild = true;
    report.stats.ambiguousProfiles = topProfiles.map(item => item.profile);
    report.blockers.push('XML-PROFILE-AMBIGUOUS');
    report.reasons.push(
      `Ambiguous XML profile markers: ${topProfiles.map(item => item.profile).join(', ')}`
    );
    return report;
  }

  const winner = scored[0];

  report.profile = winner.profile;
  report.confidence = profileConfidence(winner.score, winner.profile);
  report.isKnownProfile = true;
  report.shouldBlockTopologyBuild = false;
  report.reasons.push(`Detected ${winner.profile} using markers: ${winner.hits.join(', ')}`);

  if (report.confidence === CONFIDENCE.LOW) {
    report.warnings.push('XML-PROFILE-LOW-CONFIDENCE');
  }

  return report;
}

export const detectXmlProfile = detectUxmlProfile;

export function assertXmlProfileBuildAllowed(report) {
  if (!report || report.shouldBlockTopologyBuild) {
    return {
      ok: false,
      blockers: report?.blockers?.length
        ? report.blockers
        : ['XML-PROFILE-BLOCKED'],
    };
  }

  return {
    ok: true,
    blockers: [],
  };
}

export { CONFIDENCE as UXML_PROFILE_CONFIDENCE };
