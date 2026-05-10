import { state } from '../../core/state.js';

export function getRvmPcfLegacyConfig() {
  const masters = state.rvmPcfExtract?.masters || {};

  return {
    supportMapping: masters.supportMapping || {
      guidPrefix: 'UCI:',
      fallbackName: 'CA150',
      blocks: [
        { id: 1, frictionMatch: ['', '0.3'], gapCondition: 'empty', name: 'CA150', desc: 'Rest / Anchor' },
        { id: 2, frictionMatch: ['0.15'], gapCondition: 'any', name: 'CA100', desc: 'Guide' },
        { id: 3, frictionMatch: ['0.3'], gapCondition: '>0', name: 'CA150', desc: 'Rest with Gap' },
      ]
    }
  };
}
