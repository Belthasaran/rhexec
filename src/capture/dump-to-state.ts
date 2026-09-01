import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Cpu5A22, RhState1, RhState1Section, CaptureMode, CaptureProfile } from '../rhstate1/types.ts';
import { inspectRom } from '../rhstate1/rom-info.ts';
import { normalizeCpu, RHSTATE1_VERSION } from '../rhstate1/types.ts';
import { parseMss } from '../players/mss-format.ts';
import { applyMesenScalarKeys, mssToPortable } from '../players/mesen-state-map.ts';

export interface DumpMeta {
  game_mode?: number;
  pc?: number;
  frame?: number;
  profile?: CaptureProfile;
  scanline?: number;
  hclock?: number;
  region?: string;
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
  { file: 'fillram.bin', id: 'fillram', bus: 0x0000 },
  { file: 'sa1_iram.bin', id: 'sa1_iram', bus: 0x0000 },
  { file: 'gsu_wram.bin', id: 'gsu_wram', bus: 0x0000 },
  { file: 'cx4_data.bin', id: 'cx4_data', bus: 0x0000 },
  { file: 'dsp_data.bin', id: 'dsp_data', bus: 0x0000 },
  { file: 'st018_wram.bin', id: 'st018_wram', bus: 0x0000 },
  { file: 'obc1_ram.bin', id: 'obc1_ram', bus: 0x0000 },
];

function overlayMissingBins(state: RhState1, dumpDir: string): void {
  const have = new Set(state.sections.map((s) => s.id));
  for (const spec of SECTION_FILES) {
    if (have.has(spec.id)) continue;
    const data = loadBin(dumpDir, spec.file);
    if (data) {
      state.sections.push({ id: spec.id, bus: spec.bus, encoding: 'raw', data });
      have.add(spec.id);
    }
  }
}

function loadMeta(dumpDir: string): DumpMeta {
  const metaPath = join(dumpDir, 'meta.json');
  return existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8')) as DumpMeta
    : {};
}

function loadCpuJson(dumpDir: string): Cpu5A22 | null {
  const cpuPath = join(dumpDir, 'cpu.json');
  if (!existsSync(cpuPath)) return null;
  return normalizeCpu(JSON.parse(readFileSync(cpuPath, 'utf8')) as Partial<Cpu5A22>);
}

function fromBins(opts: { dumpDir: string; romBuf: Uint8Array; mode: CaptureMode }): RhState1 {
  const meta = loadMeta(opts.dumpDir);
  const sections: RhState1Section[] = [];
  for (const spec of SECTION_FILES) {
    const data = loadBin(opts.dumpDir, spec.file);
    if (data) sections.push({ id: spec.id, bus: spec.bus, encoding: 'raw', data });
  }
  const state: RhState1 = {
    v: RHSTATE1_VERSION,
    profile: meta.profile || 'in_level',
    rom: inspectRom(opts.romBuf),
    host: { emulator: 'mesen2', mode: opts.mode },
    cpu: normalizeCpu(null),
    trigger: {
      game_mode: Number(meta.game_mode) || 0x14,
      pc: Number(meta.pc) || 0,
      frame: Number(meta.frame) || 0,
      scanline: meta.scanline,
      hclock: meta.hclock,
      region: meta.region,
    },
    sections,
  };
  const chipsPath = join(opts.dumpDir, 'chips.json');
  if (existsSync(chipsPath)) {
    applyMesenScalarKeys(state, JSON.parse(readFileSync(chipsPath, 'utf8')) as Record<string, number>);
  }
  const cpuJson = loadCpuJson(opts.dumpDir);
  if (cpuJson) state.cpu = cpuJson;
  if (!state.trigger.pc) state.trigger.pc = state.cpu.pc;
  return state;
}

export function dumpDirToState(opts: {
  dumpDir: string;
  romBuf: Uint8Array;
  mode: CaptureMode;
}): RhState1 {
  const mssPath = join(opts.dumpDir, 'mesen.mss');
  let state: RhState1;
  if (existsSync(mssPath)) {
    const mss = parseMss(readFileSync(mssPath));
    const meta = loadMeta(opts.dumpDir);
    const cpuJson = loadCpuJson(opts.dumpDir);
    state = mssToPortable(mss, {
      rom: inspectRom(opts.romBuf),
      host: { emulator: 'mesen2', mode: opts.mode },
      profile: meta.profile || 'in_level',
      trigger: {
        game_mode: Number(meta.game_mode) || 0x14,
        pc: Number(meta.pc) || cpuJson?.pc,
        frame: Number(meta.frame) || 0,
        scanline: meta.scanline,
        hclock: meta.hclock,
        region: meta.region,
      },
    });
    overlayMissingBins(state, opts.dumpDir);
    try { unlinkSync(mssPath); } catch { /* ignore */ }
  } else {
    state = fromBins(opts);
  }
  if (!state.sections.some((s) => s.id === 'wram')) {
    throw new Error(`capture dump missing wram.bin / MSS workRam in ${opts.dumpDir}`);
  }
  return state;
}
