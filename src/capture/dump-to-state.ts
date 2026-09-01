import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Cpu5A22, RhState1, RhState1Section, CaptureMode, CaptureProfile } from '../rhstate1/types.ts';
import { inspectRom } from '../rhstate1/rom-info.ts';
import { RHSTATE1_VERSION } from '../rhstate1/types.ts';

export interface DumpMeta {
  game_mode?: number;
  pc?: number;
  frame?: number;
  profile?: CaptureProfile;
}

function loadBin(dir: string, name: string): Uint8Array | null {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  return new Uint8Array(readFileSync(p));
}

const SECTION_FILES: { file: string; id: RhState1Section['id']; bus: number }[] = [
  { file: 'wram.bin', id: 'wram', bus: 0x7e0000 },
  { file: 'vram.bin', id: 'vram', bus: 0x0000 },
  { file: 'cgram.bin', id: 'cgram', bus: 0x0000 },
  { file: 'oam.bin', id: 'oam', bus: 0x0000 },
  { file: 'sram.bin', id: 'sram', bus: 0x0000 },
  { file: 'spc_aram.bin', id: 'spc_aram', bus: 0x0000 },
  { file: 'dsp.bin', id: 'dsp', bus: 0x0000 },
];

export function dumpDirToState(opts: {
  dumpDir: string;
  romBuf: Uint8Array;
  mode: CaptureMode;
}): RhState1 {
  const metaPath = join(opts.dumpDir, 'meta.json');
  const cpuPath = join(opts.dumpDir, 'cpu.json');
  const meta: DumpMeta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8')) as DumpMeta
    : {};
  const cpuRaw = existsSync(cpuPath)
    ? JSON.parse(readFileSync(cpuPath, 'utf8')) as Partial<Cpu5A22>
    : {};
  const cpu: Cpu5A22 = {
    a: Number(cpuRaw.a) || 0,
    x: Number(cpuRaw.x) || 0,
    y: Number(cpuRaw.y) || 0,
    d: Number(cpuRaw.d) || 0,
    db: Number(cpuRaw.db) || 0,
    p: Number(cpuRaw.p) || 0,
    sp: Number(cpuRaw.sp) || 0,
    pc: Number(cpuRaw.pc) || 0,
    e: Number(cpuRaw.e) || 1,
  };
  const sections: RhState1Section[] = [];
  for (const spec of SECTION_FILES) {
    const data = loadBin(opts.dumpDir, spec.file);
    if (data) sections.push({ id: spec.id, bus: spec.bus, encoding: 'raw', data });
  }
  if (!sections.some((s) => s.id === 'wram')) {
    throw new Error(`capture dump missing wram.bin in ${opts.dumpDir}`);
  }
  return {
    v: RHSTATE1_VERSION,
    profile: meta.profile || 'in_level',
    rom: inspectRom(opts.romBuf),
    host: { emulator: 'mesen2', mode: opts.mode },
    cpu,
    trigger: {
      game_mode: Number(meta.game_mode) || 0x14,
      pc: Number(meta.pc) || cpu.pc,
      frame: Number(meta.frame) || 0,
    },
    sections,
  };
}
