/**
 * Wave 4 – RvmPipelineRefResolver + RvmBoreConverter unit tests
 * Plain Node ESM, no jsdom / three.js.
 */

import { RvmPipelineRefResolver } from '../../../rvm-pcf-extract/RvmPipelineRefResolver.js';
import { RvmBoreConverter }       from '../../../rvm-pcf-extract/RvmBoreConverter.js';
import { RvmFinal2dCsvBuilder }   from '../../../rvm-pcf-extract/RvmFinal2dCsvBuilder.js';

// ─── Tiny assertion helper ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  PASS  ${message}`);
    passed++;
  } else {
    console.error(`  FAIL  ${message}  |  expected=${JSON.stringify(expected)}  actual=${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\nWave 4 – RvmPipelineRefResolver + RvmBoreConverter\n');

// ── PipelineRefResolver ──────────────────────────────────────────────────────

// T1: Node with PIPELINE_REF attribute → source=PIPELINE-REF-DIRECT
{
  const resolver = new RvmPipelineRefResolver({ nodes: [] });
  const node = { canonicalObjectId: 'N1', attributes: { PIPELINE_REF: 'LINE-100' } };
  const result = resolver.resolve(node, []);
  assertEqual(result.source, 'PIPELINE-REF-DIRECT', 'T1: source=PIPELINE-REF-DIRECT');
  assertEqual(result.pipelineRef, 'LINE-100', 'T1: pipelineRef=LINE-100');
}

// T2: Node without direct attr, parent kind=PIPE → source=PIPELINE-REF-PARENT-PIPE
{
  const parentNode = { canonicalObjectId: 'P1', name: 'MainPipe', kind: 'PIPE', attributes: {} };
  const rvmIndex = { nodes: [parentNode] };
  const resolver = new RvmPipelineRefResolver(rvmIndex);
  const node = { canonicalObjectId: 'N2', attributes: {} };
  const result = resolver.resolve(node, [parentNode]);
  assertEqual(result.source, 'PIPELINE-REF-PARENT-PIPE', 'T2: source=PIPELINE-REF-PARENT-PIPE');
  assertEqual(result.pipelineRef, 'MainPipe', 'T2: pipelineRef=MainPipe');
}

// T3: Node without any parent match → source=PIPELINE-REF-FALLBACK
{
  const resolver = new RvmPipelineRefResolver({ nodes: [] });
  const node = { canonicalObjectId: 'N3', attributes: {} };
  const result = resolver.resolve(node, []);
  assertEqual(result.source, 'PIPELINE-REF-FALLBACK', 'T3: source=PIPELINE-REF-FALLBACK');
  assertEqual(result.pipelineRef, 'RVM-EXTRACT', 'T3: pipelineRef=RVM-EXTRACT');
}

// T4: Exactly one selectedRootId matches ancestor → source=PIPELINE-REF-SELECTED-ROOT
{
  const rootNode = { canonicalObjectId: 'ROOT1', name: 'RootLine-A', kind: 'MISC', attributes: {} };
  const rvmIndex = { nodes: [rootNode] };
  const resolver = new RvmPipelineRefResolver(rvmIndex, { selectedRootIds: ['ROOT1'] });
  const node = { canonicalObjectId: 'N4', attributes: {} };
  // ancestorChain includes rootNode
  const result = resolver.resolve(node, [rootNode]);
  assertEqual(result.source, 'PIPELINE-REF-SELECTED-ROOT', 'T4: source=PIPELINE-REF-SELECTED-ROOT');
  assertEqual(result.pipelineRef, 'RootLine-A', 'T4: pipelineRef=RootLine-A');
}

// ── RvmBoreConverter ─────────────────────────────────────────────────────────

const bc = new RvmBoreConverter();

// T5: '4"' → convertedBore=100, source=NPS-INCH
{
  const r = bc.convertBore('4"');
  assertEqual(r.convertedBore, 100, 'T5: 4" → convertedBore=100');
  assertEqual(r.convertedBoreSource, 'NPS-INCH', 'T5: source=NPS-INCH');
}

// T6: '1-1/2"' → convertedBore=40, source=NPS-INCH
{
  const r = bc.convertBore('1-1/2"');
  assertEqual(r.convertedBore, 40, 'T6: 1-1/2" → convertedBore=40');
  assertEqual(r.convertedBoreSource, 'NPS-INCH', 'T6: source=NPS-INCH');
}

// T7: '1/2"' → convertedBore=15, source=NPS-INCH
{
  const r = bc.convertBore('1/2"');
  assertEqual(r.convertedBore, 15, 'T7: 1/2" → convertedBore=15');
  assertEqual(r.convertedBoreSource, 'NPS-INCH', 'T7: source=NPS-INCH');
}

// T8: 114.3 → convertedBore=100, source=OD-MM
{
  const r = bc.convertBore(114.3);
  assertEqual(r.convertedBore, 100, 'T8: 114.3 → convertedBore=100');
  assertEqual(r.convertedBoreSource, 'OD-MM', 'T8: source=OD-MM');
}

// T9: 'DN100' → convertedBore=100, source=DN-STRING
{
  const r = bc.convertBore('DN100');
  assertEqual(r.convertedBore, 100, 'T9: DN100 → convertedBore=100');
  assertEqual(r.convertedBoreSource, 'DN-STRING', 'T9: source=DN-STRING');
}

// T10: 100 (integer) → convertedBore=100, source=DN-PASSTHROUGH
{
  const r = bc.convertBore(100);
  assertEqual(r.convertedBore, 100, 'T10: 100 → convertedBore=100');
  assertEqual(r.convertedBoreSource, 'DN-PASSTHROUGH', 'T10: source=DN-PASSTHROUGH');
}

// ── Integration with builder ─────────────────────────────────────────────────

// T11: RvmFinal2dCsvBuilder row has pipelineRef and convertedBore fields
{
  const mockIndex = {
    nodes: [
      {
        canonicalObjectId: 'N1',
        parentCanonicalObjectId: null,
        name: 'Line-200',
        kind: 'PIPE',
        path: 'Root/Line-200',
        attributes: {
          APOS: [0, 0, 0],
          LPOS: [1000, 0, 0],
          PIPELINE_REF: 'L-200',
          BORE: '4"',
        },
      },
    ],
  };

  const builder = new RvmFinal2dCsvBuilder(mockIndex, {});
  const { rows } = builder.build();
  const row = rows[0];

  assert(row != null, 'T11: row exists');
  assert('pipelineRef' in row, 'T11: row has pipelineRef field');
  assert('convertedBore' in row, 'T11: row has convertedBore field');
  assertEqual(row.pipelineRef, 'L-200', 'T11: pipelineRef=L-200');
  assertEqual(row.convertedBore, 100, 'T11: convertedBore=100 (from "4")');
  assert('pipelineRefSource' in row, 'T11: row has pipelineRefSource field');
  assert('convertedBoreSource' in row, 'T11: row has convertedBoreSource field');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
