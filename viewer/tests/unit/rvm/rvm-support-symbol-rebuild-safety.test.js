import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf-8');
}

function run() {
  console.log('--- rvm-support-symbol-rebuild-safety.test.js ---');

  const js = read('viewer/rvm-viewer/RvmSupportSymbols.js');

  assert.ok(
    js.includes('REBUILD_FOUND_ZERO_SUPPORTS_KEPT_EXISTING'),
    'support rebuild must preserve existing symbols if rescan finds zero supports'
  );

  assert.ok(
    js.includes('preservedExisting: true'),
    'support rebuild diagnostics must report preservedExisting=true'
  );

  assert.ok(
    js.includes('disposeObject(symbolRoot);'),
    'unused newly-built empty symbol root must be disposed'
  );

  assert.ok(
    js.includes('if (created > 0)') &&
    js.includes('viewer.scene.remove(existing)'),
    'existing support symbols should only be removed after new symbols are created'
  );

  console.log('[PASS] RVM support symbol rebuild safety passed.');
}

try {
  run();
} catch (error) {
  console.error('[FAIL] RVM support symbol rebuild safety failed.');
  console.error(error);
  process.exit(1);
}
