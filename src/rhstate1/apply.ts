import { getSectionDecoded, setSectionRaw } from './codec.ts';
import { mutateWram, setGameMode } from './mutate.ts';
import type { MutateParams, RhState1, SectionEncoding } from './types.ts';

export function applyMutations(state: RhState1, params: MutateParams, zeros: SectionEncoding = 'raw'): Uint8Array {
  const wram = getSectionDecoded(state, 'wram');
  if (!wram) throw new Error('rhstate1: missing wram section');
  const copy = new Uint8Array(wram);
  mutateWram(copy, params);
  if (state.profile === 'ow_ready' && params.level != null) {
    setGameMode(copy, 0x0f);
  }
  setSectionRaw(state, 'wram', 0x7e0000, copy, zeros);
  return copy;
}
