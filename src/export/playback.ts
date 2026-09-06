import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { decodeRhState1 } from '../rhstate1/codec.ts';
import { applyMutations } from '../rhstate1/apply.ts';
import type { SharedPlaybackFlags } from '../cli/args.ts';
import type { RhState1 } from '../rhstate1/types.ts';

export function defaultOutFromRom(rom: string, suffix: string): string {
  const stripped = rom.replace(/\.(sfc|smc)$/i, '');
  return stripped + suffix;
}

export function loadMutatedState(p: SharedPlaybackFlags): { rom: string; state: string; st: RhState1 } {
  if (!p.rom) throw new Error('--rom is required');
  if (!p.state) throw new Error('--state is required');
  if (!existsSync(p.rom)) throw new Error(`ROM not found: ${p.rom}`);
  if (!existsSync(p.state)) throw new Error(`state not found: ${p.state}`);
  const st = decodeRhState1(readFileSync(p.state));
  applyMutations(st, {
    level: p.level,
    owHave: p.owHave,
    owSubmap: p.owSubmap,
    owX: p.owX,
    owY: p.owY,
  });
  if (!st.sections.find((s) => s.id === 'wram')) throw new Error('missing wram');
  return { rom: p.rom, state: p.state, st };
}

export function refuseCrossCoreOut(kind: 'mss' | 'mercury' | 'bizhawk', outPath: string): void {
  const name = basename(outPath).toLowerCase();
  if (kind === 'mercury') {
    if (name.endsWith('.mss')) throw new Error('refusing to write a mercury BST blob as a Mesen .mss');
    if (name.includes('bizhawk')) throw new Error('refusing to emit a mercury blob with a BizHawk name');
  }
  if (kind === 'bizhawk') {
    if (name.endsWith('.mss')) throw new Error('refusing to write a BizHawk zip as a Mesen .mss');
    if (name.includes('mercury') || name.includes('bst1')) {
      throw new Error('refusing to emit a BizHawk zip with a mercury name');
    }
  }
  if (kind === 'mss') {
    if (name.includes('mercury') || name.includes('bizhawk') || name.includes('bst1')) {
      throw new Error('refusing to emit a Mesen .mss with a mercury/BizHawk name');
    }
  }
}
