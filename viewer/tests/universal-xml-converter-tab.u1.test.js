// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderUniversalXmlConverterTab } from '../tabs/universal-xml-converter-tab.js';

function setup() {
  document.body.innerHTML = '<div id="root"></div>';
  const container = document.getElementById('root');
  const cleanup = renderUniversalXmlConverterTab(container);
  return { container, cleanup };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

function getText(container) {
  return container.textContent.replace(/\s+/g, ' ').trim();
}

function makeFile(name, text, type = 'text/plain') {
  return new File([text], name, { type });
}

async function uploadFile(container, file) {
  const input = container.querySelector('[data-uxml-file-input]');
  expect(input).toBeTruthy();

  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });

  input.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

describe('Universal XML Converter tab — Phase U1-1 shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    global.URL.createObjectURL = vi.fn(() => 'blob:uxml-summary');
    global.URL.revokeObjectURL = vi.fn();

    document.body.innerHTML = '';
  });

  it('renders the independent Universal XML Converter tab shell', () => {
    const { container } = setup();
    const text = getText(container);

    expect(text).toContain('Universal XML Converter');
    expect(text).toContain('Phase U1');
    expect(text).toContain('Tab Shell');
    expect(text).toContain('Masters deferred');
    expect(text).toContain('Universal XML Converter tab is ready.');
  });

  it('renders all 10 planned pipeline stages', () => {
    const { container } = setup();

    const stageButtons = container.querySelectorAll('[data-uxml-panel]');
    expect(stageButtons.length).toBe(10);

    const text = getText(container);
    expect(text).toContain('1. Source Intake');
    expect(text).toContain('2. Existing Converter Output');
    expect(text).toContain('3. UXML Normalization');
    expect(text).toContain('4. UXML Validation');
    expect(text).toContain('5. Pre-Topology Face Model');
    expect(text).toContain('6. UniversalTopoGraph');
    expect(text).toContain('7. RayTopoGraph');
    expect(text).toContain('8. Topology Comparison');
    expect(text).toContain('9. Output Bridges');
    expect(text).toContain('10. Final Master Links');
  });

  it('marks masters as deferred and does not expose active master workflow in U1', () => {
    const { container } = setup();

    const mastersButton = container.querySelector('[data-uxml-panel="masters"]');
    expect(mastersButton).toBeTruthy();
    expect(mastersButton.className).toContain('is-deferred');

    mastersButton.click();

    const text = getText(container);
    expect(text).toContain('Final Master Links');
    expect(text).toContain('Deferred');
    expect(text).toContain('Line List');
    expect(text).toContain('Piping Class Master');
    expect(text).toContain('Weight Master');
  });

  it('renders source type routes expected for U1 intake', () => {
    const { container } = setup();

    const select = container.querySelector('[data-uxml-source-type]');
    expect(select).toBeTruthy();

    const values = Array.from(select.options).map(o => o.value);

    expect(values).toContain('AUTO');
    expect(values).toContain('EXISTING_XML');
    expect(values).toContain('INPUT_XML');
    expect(values).toContain('UXML');
    expect(values).toContain('PCF');
    expect(values).toContain('PDF_TO_INPUTXML');
    expect(values).toContain('REV_TO_XML');
    expect(values).toContain('JSON_TO_XML');
    expect(values).toContain('TXT_TO_XML');
  });

  it('renders blank state safely without source file', () => {
    const { container } = setup();

    const text = getText(container);
    expect(text).toContain('No source loaded.');
    expect(text).toContain('Source Preview');
  });

  it('warns when Detect Profile is clicked before loading a source file', () => {
    const { container } = setup();

    const button = container.querySelector('[data-uxml-action="detect-profile"]');
    expect(button).toBeTruthy();

    button.click();

    const text = getText(container);
    expect(text).toContain('Load a source file before detecting profile.');
  });

  it('loads an XML source file and shows preview', async () => {
    const { container } = setup();

    await uploadFile(
      container,
      makeFile('sample.xml', '<Root><Component id="C1"/></Root>', 'application/xml')
    );

    const text = getText(container);
    expect(text).toContain('Loaded sample.xml');
    expect(text).toContain('Detected source type: EXISTING_XML');
    expect(text).toContain('sample.xml');
    expect(text).toContain('<Root><Component id="C1"/></Root>');
  });

  it('detects UXML source from XML content', async () => {
    const { container } = setup();

    await uploadFile(
      container,
      makeFile('model.xml', '<UXML version="1.0"><Components/></UXML>', 'application/xml')
    );

    const text = getText(container);
    expect(text).toContain('Detected source type: UXML');
  });

  it('detects PCF source from extension', async () => {
    const { container } = setup();

    await uploadFile(
      container,
      makeFile(
        'line.pcf',
        'PIPELINE-REFERENCE /BTRM-1000-10"-P1710011-66620M0-01/B1\nPIPE\n    END-POINT 0 0 0 250',
        'text/plain'
      )
    );

    const text = getText(container);
    expect(text).toContain('Detected source type: PCF');
  });

  it('detects staged JSON source from extension', async () => {
    const { container } = setup();

    await uploadFile(
      container,
      makeFile('ATTRIBUTE_managed_stage.json', '{"rows":[{"type":"PIPE"}]}', 'application/json')
    );

    const text = getText(container);
    expect(text).toContain('Detected source type: JSON_TO_XML');
  });

  it('allows source type dropdown selection without crashing', () => {
    const { container } = setup();

    const select = container.querySelector('[data-uxml-source-type]');
    select.value = 'PCF';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const text = getText(container);
    expect(text).toContain('Source type set to PCF.');
  });

  it('switches panels without crashing', () => {
    const { container } = setup();

    const panels = [
      'existing-converter',
      'uxml',
      'validation',
      'face-model',
      'universal-topology',
      'ray-topology',
      'comparison',
      'outputs',
      'masters',
      'source',
    ];

    for (const panel of panels) {
      const button = container.querySelector(`[data-uxml-panel="${panel}"]`);
      expect(button).toBeTruthy();
      button.click();
      expect(container.querySelector('.uxml-panel')).toBeTruthy();
    }

    const text = getText(container);
    expect(text).toContain('Source Intake');
  });

  it('keeps future workflow action buttons disabled in U1', () => {
    const { container } = setup();

    const disabledActions = [
      'run-existing-converter',
      'convert-uxml',
      'validate-uxml',
    ];

    for (const action of disabledActions) {
      const button = container.querySelector(`[data-uxml-action="${action}"]`);
      expect(button).toBeTruthy();
      expect(button.disabled).toBe(true);
    }
  });

  it('exports U1 summary JSON by creating a download link', async () => {
    const { container } = setup();

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await uploadFile(
      container,
      makeFile('sample.pcf', 'PIPELINE-REFERENCE X\nPIPE\n    END-POINT 0 0 0 250')
    );

    const button = container.querySelector('[data-uxml-action="export-summary"]');
    expect(button).toBeTruthy();

    button.click();

    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();

    const text = getText(container);
    expect(text).toContain('Universal XML Converter U1 summary exported.');
  });
});
