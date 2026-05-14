import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf-8');
}

function run() {
  console.log('--- rvm-master-resolution-datasheet-ui.test.js ---');

  const file = 'viewer/rvm-pcf-extract/RvmMasterResolutionWorkflow.js';
  const js = read(file);

  const requiredMarkers = [
    'RATING_REGEX_STORAGE_KEY',
    'extractRatingFromPipelineRef',
    'renderRegexHeader',
    'Pipeline Reference Extraction',
    'Piping Class Extraction Regex',
    'Rating Extraction Regex (Optional)',
    'Save Regex',
    'renderGroupedDataSheet',
    'rvm-master-sheet-table',
    'masterResolutionGroupKey',
    'requestBoreLabel',
    'Converted Bore is not required as manual input',
    'derivedPipingClass',
    'derivedRating',
    'boreMm',
    'showRvmMasterResolutionDialog',
    'Master Resolution Data Sheet',
    'Apply to all matching rows in this group',
  ];

  for (const marker of requiredMarkers) {
    assert.ok(
      js.includes(marker),
      `RvmMasterResolutionWorkflow.js missing marker: ${marker}`
    );
  }

  assert.ok(
    !js.includes('name="manualConvertedBore"'),
    'manual converted bore input must not be present'
  );

  assert.ok(
    js.includes('localStorage.setItem(PIPING_CLASS_REGEX_STORAGE_KEY') &&
    js.includes('localStorage.setItem(RATING_REGEX_STORAGE_KEY'),
    'regex settings must be persisted'
  );

  assert.ok(
    js.includes('row.ratingDerived = derivedRating') ||
    js.includes('row.rating = derivedRating'),
    'derived rating must be applied to row'
  );

  assert.ok(
    js.includes('row.pipingClassDerived = derived') ||
    js.includes('row.pipingClass = derived'),
    'derived piping class must be applied to row'
  );

  console.log('[PASS] RVM master resolution data-sheet UI smoke passed.');
}

try {
  run();
} catch (error) {
  console.error('[FAIL] RVM master resolution data-sheet UI smoke failed.');
  console.error(error);
  process.exit(1);
}
