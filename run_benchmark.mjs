import fs from 'fs/promises';
import { RvmPcfExtractState } from './viewer/core/state.js';
import { mountRvmPcfLegacyMasterPanel } from './viewer/rvm-pcf-master-tabs/RvmPcfLegacyMasterPanel.js';
import { RvmValveWeightMapper } from './viewer/rvm-pcf-extract/RvmValveWeightMapper.js';
import { RvmFinal2dCsvBuilder } from './viewer/rvm-pcf-extract/RvmFinal2dCsvBuilder.js';
import { RvmPcfEmitter } from './viewer/rvm-pcf-extract/RvmPcfEmitter.js';
import { RvmExtractHardening } from './viewer/rvm-pcf-extract/RvmExtractHardening.js';
import { RvmBoreConverter } from './viewer/rvm-pcf-extract/RvmBoreConverter.js';
import { RvmPipelineRefResolver } from './viewer/rvm-pcf-extract/RvmPipelineRefResolver.js';
import { RvmPipingClassMapper } from './viewer/rvm-pcf-extract/RvmPipingClassMapper.js';
import { RvmRemainingMastersMapper } from './viewer/rvm-pcf-extract/RvmRemainingMastersMapper.js';
import { RvmTreeModel } from './viewer/rvm/RvmTreeModel.js';

// Define a minimal state stub required by functions
global.state = {
  rvmPcfExtract: {
    masters: {}
  }
};

global.updateRvmPcfExtractState = function(partialState) {
  Object.assign(global.state.rvmPcfExtract, partialState);
};

// Polyfills
global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};

async function main() {
  try {
    const rawNodes = JSON.parse(await fs.readFile('Benchmarks/Managejson to Input XML/RMSS/ATTRIBUTE_managed_stage (1).json', 'utf-8'));

    const mockIndex = { nodes: rawNodes };
    const rvmTree = new RvmTreeModel(mockIndex, { viewer: { getSelectedCanonicalIds: () => [] } });
    rvmTree.build();

    // Since we can't easily run the DOM panel logic without a heavy jsdom setup,
    // we'll mock the master loading by parsing the files. We can't use xlsx out of the box in the script
    // unless we setup the DOM/require. Let's write a small integration runner if possible.
    // Given the task, we can just run the audit via RvmExtractHardening if we can load the data.

  } catch(e) {
    console.error(e);
  }
}

main();