/**
 * UXML certification gate.
 *
 * Purpose:
 * - Provide a deterministic required-file certification before Vitest runs.
 * - Fail GitHub Actions if any required Agent 00–07 file is missing.
 *
 * This script intentionally does not mutate files.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const REQUIRED_BENCHMARKS = Object.freeze([
  'Benchmarks/RVM JSON to PCF UXML Topology/README.md',
  'Benchmarks/RVM JSON to PCF UXML Topology/broken-topology-50-rows.json',
  'Benchmarks/RVM JSON to PCF UXML Topology/expected-uxml-topology-outcome.json',
]);

const REQUIRED_MODULES = Object.freeze([
  'viewer/uxml/UxmlConstants.js',
  'viewer/uxml/UxmlTypes.js',
  'viewer/uxml/UxmlProfileDetector.js',
  'viewer/uxml/UxmlNormalizer.js',
  'viewer/uxml/UxmlValidationGate.js',
  'viewer/uxml/UxmlFaceModelBuilder.js',
  'viewer/uxml/UxmlUniversalTopoGraphBuilder.js',
  'viewer/uxml/UxmlRayTopoGraphBuilder.js',
    'viewer/uxml/UxmlTopoGraphComparator.js',
  'viewer/rvm-pcf-extract/RvmPcfTopologyModes.js',
  'viewer/rvm-pcf-extract/RvmRowsToUxmlAdapter.js',
  'viewer/rvm-pcf-extract/RvmUxmlTopologyBridge.js',
  'viewer/uxml/UxmlTopologyDecisionGate.js',
  'viewer/rvm-pcf-extract/RvmUxmlTopologyDiagnosticsPanel.js',
]);

const REQUIRED_TESTS = Object.freeze([
  'viewer/tests/uxml-contracts.test.js',
  'viewer/tests/uxml-profile-detector.test.js',
  'viewer/tests/uxml-normalizer.test.js',
  'viewer/tests/uxml-validation-gate.test.js',
  'viewer/tests/uxml-face-model-builder.test.js',
  'viewer/tests/uxml-universal-topo-graph-builder.test.js',
  'viewer/tests/uxml-ray-topo-graph-builder.test.js',
    'viewer/tests/uxml-topo-graph-comparator.test.js',
  'viewer/tests/universal-xml-converter-tab.test.js',
  'viewer/tests/rvm-pcf-uxml-topology-bridge.test.js',
  'viewer/tests/uxml-topology-decision-gate.test.js',
  'viewer/tests/rvm-pcf-uxml-topology-diagnostics-panel.test.js',
  'viewer/tests/rvm-pcf-uxml-topology-benchmark.test.js',
]);

const REQUIRED_EXPORT_MARKERS = Object.freeze([
  {
    file: 'viewer/uxml/UxmlProfileDetector.js',
    markers: ['detectUxmlProfile', 'detectXmlProfile'],
  },
  {
    file: 'viewer/uxml/UxmlNormalizer.js',
    markers: ['normalizeXmlToUxml', 'normalizeToUxml'],
  },
  {
    file: 'viewer/uxml/UxmlValidationGate.js',
    markers: ['validateUxmlDocument', 'runUxmlValidationGate'],
  },
  {
    file: 'viewer/uxml/UxmlFaceModelBuilder.js',
    markers: ['buildUxmlFaceModel', 'createUxmlFaceModel'],
  },
  {
    file: 'viewer/uxml/UxmlUniversalTopoGraphBuilder.js',
    markers: ['buildUxmlUniversalTopoGraph', 'createUxmlUniversalTopoGraph'],
  },
  {
    file: 'viewer/uxml/UxmlRayTopoGraphBuilder.js',
    markers: ['buildUxmlRayTopoGraph', 'createUxmlRayTopoGraph'],
  },
  {
    file: 'viewer/uxml/UxmlTopoGraphComparator.js',
    markers: [
      'compareUxmlTopoGraphs',
      'compareUxmlTopologyGraphs',
      'buildUxmlTopoGraphComparison',
    ],
  },
  {
    file: 'viewer/rvm-pcf-extract/RvmPcfTopologyModes.js',
    markers: [
      'RVM_PCF_TOPOLOGY_MODES',
      'normalizeRvmPcfTopologyMode',
      'isUxmlTopologyMode',
    ],
  },
  {
    file: 'viewer/rvm-pcf-extract/RvmRowsToUxmlAdapter.js',
    markers: [
      'adaptRvmRowsToUxml',
      'convertRvmRowsToUxml',
    ],
  },
  {
    file: 'viewer/rvm-pcf-extract/RvmUxmlTopologyBridge.js',
    markers: [
      'runUxmlTopologyForRvmRows',
      'pushUxmlTopologyBackToLegacyRows',
      'buildRvmPcfUxmlTopology',
    ],
  },
  {
    file: 'viewer/uxml/UxmlTopologyDecisionGate.js',
    markers: [
      'decideUxmlTopologyAcceptance',
      'runUxmlTopologyDecisionGate',
      'buildUxmlAcceptedTopology',
    ],
  },
  {
    file: 'viewer/rvm-pcf-extract/RvmUxmlTopologyDiagnosticsPanel.js',
    markers: [
      'buildRvmUxmlTopologyDiagnosticsViewModel',
      'renderRvmUxmlTopologyDiagnosticsHtml',
      'createRvmUxmlTopologyDiagnosticsViewModel',
    ],
  },
]);

function repoPath(relativePath) {
  return path.join(ROOT, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(repoPath(relativePath));
}

function read(relativePath) {
  return fs.readFileSync(repoPath(relativePath), 'utf8');
}

function checkFiles(label, files) {
  const missing = [];

  for (const file of files) {
    if (!exists(file)) {
      missing.push(file);
    }
  }

  return {
    label,
    total: files.length,
    passed: files.length - missing.length,
    missing,
  };
}

function checkExportMarkers() {
  const failures = [];

  for (const item of REQUIRED_EXPORT_MARKERS) {
    if (!exists(item.file)) {
      failures.push({
        file: item.file,
        missingMarkers: item.markers,
        reason: 'file-missing',
      });
      continue;
    }

    const content = read(item.file);
    const missingMarkers = item.markers.filter(marker => !content.includes(marker));

    if (missingMarkers.length) {
      failures.push({
        file: item.file,
        missingMarkers,
        reason: 'marker-missing',
      });
    }
  }

  return failures;
}

function printResult(result) {
  const icon = result.missing.length ? '❌' : '✅';

  console.log(`${icon} ${result.label}: ${result.passed} / ${result.total}`);

  for (const file of result.missing) {
    console.log(`  - missing: ${file}`);
  }
}

function main() {
  console.log('UXML Certification');
  console.log('==================');

  const moduleCheck = checkFiles('Required modules', REQUIRED_MODULES);
  const testCheck = checkFiles('Required tests', REQUIRED_TESTS);
  const benchmarkCheck = checkFiles('Required benchmarks', REQUIRED_BENCHMARKS);
  const markerFailures = checkExportMarkers();

  printResult(moduleCheck);
  printResult(testCheck);
  printResult(benchmarkCheck);

  if (markerFailures.length) {
    console.log('❌ Required export markers: FAIL');

    for (const failure of markerFailures) {
      console.log(`  - ${failure.file}`);
      console.log(`    reason: ${failure.reason}`);
      console.log(`    missing markers: ${failure.missingMarkers.join(', ')}`);
    }
  } else {
    console.log(`✅ Required export markers: ${REQUIRED_EXPORT_MARKERS.length} / ${REQUIRED_EXPORT_MARKERS.length}`);
  }

  const failed =
    moduleCheck.missing.length > 0 ||
    testCheck.missing.length > 0 ||
    benchmarkCheck.missing.length > 0 ||
    markerFailures.length > 0;

  console.log('');
  console.log('Summary');
  console.log(failed ? 'Certification: ❌ FAIL' : 'Certification: ✅ PASS');
  console.log(`Required modules: ${moduleCheck.missing.length ? '❌' : '✅'} ${moduleCheck.passed} / ${moduleCheck.total}`);
  console.log(`Required tests: ${testCheck.missing.length ? '❌' : '✅'} ${testCheck.passed} / ${testCheck.total}`);
  console.log(`Required benchmarks: ${benchmarkCheck.missing.length ? '❌' : '✅'} ${benchmarkCheck.passed} / ${benchmarkCheck.total}`);
  console.log(`Required export markers: ${markerFailures.length ? '❌' : '✅'} ${REQUIRED_EXPORT_MARKERS.length - markerFailures.length} / ${REQUIRED_EXPORT_MARKERS.length}`);

  if (failed) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = 0;
}

main();