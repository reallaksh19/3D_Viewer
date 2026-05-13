import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';

function read(file) {
  return fs.readFileSync(path.resolve(file), 'utf-8');
}

function run() {
  console.log('--- rvm-viewer-toolbar-ui.test.js ---');

  const js = read('viewer/tabs/viewer3d-rvm-tab.js');
  const css = read('viewer/tabs/viewer3d-rvm-tab.css');

  const iconOnlyActions = [
    'NAV_PLAN_X',
    'NAV_ROTATE_Y',
    'NAV_ROTATE_Z',
    'SNAP_ISO_NW',
    'SNAP_ISO_NE',
    'SNAP_ISO_SW',
    'SNAP_ISO_SE',
  ];

  for (const action of iconOnlyActions) {
    assert.ok(js.includes(action), `missing action ${action}`);
  }

  assert.ok(
    js.includes('ICON_ONLY_ACTIONS'),
    'viewer3d-rvm-tab.js must define ICON_ONLY_ACTIONS'
  );

  assert.ok(
    js.includes('_renderToolButton(id, icon)'),
    'viewer3d-rvm-tab.js must render tool buttons through _renderToolButton'
  );

  assert.ok(
    js.includes('aria-label="${escapeHtml(label)}"'),
    'icon-only buttons must keep aria-label'
  );

  assert.ok(
    js.includes('title="${escapeHtml(label)}"'),
    'icon-only buttons must keep tooltip title'
  );

  assert.ok(
    js.includes('_bindToolbarClickedState(container)'),
    'toolbar clicked-state binder must be called'
  );

  assert.ok(
    js.includes("window.addEventListener('keydown', _shortcutHandler, true)"),
    'ESC shortcut must be capture-phase universal listener'
  );

  assert.ok(
    js.includes("_viewer?.setNavMode?.('orbit')"),
    'ESC must reset viewer to orbit mode'
  );

  assert.ok(
    css.includes('.rvm-tool-btn.is-icon-only'),
    'CSS must include icon-only tool button styling'
  );

  assert.ok(
    css.includes('.rvm-tool-btn.is-active'),
    'CSS must include active toolbar button styling'
  );

  assert.ok(
    css.includes('background: var(--geo-accent, #4a9eff) !important'),
    'active/clicked state must use consistent blue'
  );

  console.log('[PASS] RVM viewer toolbar icon-only / active-state / ESC smoke passed.');
}

try {
  run();
} catch (error) {
  console.error('[FAIL] RVM viewer toolbar UI smoke failed.');
  console.error(error);
  process.exit(1);
}