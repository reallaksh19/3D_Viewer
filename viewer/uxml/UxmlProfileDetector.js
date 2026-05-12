import { XML_PROFILES } from './UxmlConstants.js';

export function detectUxmlProfile(xmlText) {
  const text = String(xmlText || '').trim();

  if (!text) {
    return {
      profile: XML_PROFILES.UNKNOWN_XML,
      blockers: ['EMPTY_INPUT'],
      confidence: 'NONE',
    };
  }

  // Detect UXML
  if (text.includes('<UXML')) {
    return {
      profile: XML_PROFILES.UXML,
      blockers: [],
      confidence: 'HIGH',
    };
  }

  // Detect STANDARD_XML (uses Project and Component)
  if (text.includes('<Project') && (text.includes('<Component') || text.includes('<Pipe'))) {
    return {
      profile: XML_PROFILES.STANDARD_XML,
      blockers: [],
      confidence: 'HIGH',
    };
  }

  // Detect INPUT_XML (uses InputXML, Nodes, Elements)
  if (text.includes('<InputXML')) {
    return {
      profile: XML_PROFILES.INPUT_XML,
      blockers: [],
      confidence: 'HIGH',
    };
  }

  // Detect BENCHMARK_XML
  if (text.includes('<BenchmarkCase') && text.includes('<ExpectedResult')) {
    return {
      profile: XML_PROFILES.BENCHMARK_XML,
      blockers: ['BENCHMARK_ONLY'],
      confidence: 'HIGH',
    };
  }

  // Fallback to unknown XML
  if (text.startsWith('<')) {
    return {
      profile: XML_PROFILES.UNKNOWN_XML,
      blockers: ['UNKNOWN_XML_SCHEMA'],
      confidence: 'LOW',
    };
  }

  return {
    profile: XML_PROFILES.UNKNOWN_XML,
    blockers: ['NOT_XML'],
    confidence: 'NONE',
  };
}

export function assertXmlProfileBuildAllowed(profileReport) {
  if (profileReport.profile === XML_PROFILES.UNKNOWN_XML) {
    return { ok: false, message: 'Unknown XML profile.' };
  }

  if (profileReport.blockers && profileReport.blockers.length > 0 && profileReport.profile !== XML_PROFILES.BENCHMARK_XML) {
    return { ok: false, message: 'Build blocked by profile detector.' };
  }

  return { ok: true, message: 'Build allowed.' };
}

export function detectXmlProfile(xmlText) {
  const report = detectUxmlProfile(xmlText);
  return {
    ...report,
    isXml: report.profile !== XML_PROFILES.UNKNOWN_XML || !report.blockers.includes('NOT_XML'),
    isKnownProfile: report.profile !== XML_PROFILES.UNKNOWN_XML,
    shouldBlockTopologyBuild: !assertXmlProfileBuildAllowed(report).ok,
    stats: {
      profile: report.profile,
      confidence: report.confidence,
      blockerCount: report.blockers.length,
    }
  };
}
