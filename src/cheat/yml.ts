import { translevelBytes, owPixels } from '../rhstate1/mutate.ts';
import type { MutateParams } from '../rhstate1/types.ts';

const MAX_RAM_PATCHES = 26;
const LOADER_ROM_LO = 0x05d800;
const LOADER_ROM_HI = 0x05de00;

function par(addr24: number, value: number): string {
  const a = addr24 & 0xffffff;
  const v = value & 0xff;
  return `${a.toString(16).toUpperCase().padStart(6, '0')}${v.toString(16).toUpperCase().padStart(2, '0')}`;
}

function add16(codes: string[], bus: number, value: number): void {
  codes.push(par(bus, value & 0xff));
  codes.push(par(bus + 1, (value >> 8) & 0xff));
}

export function buildParCodes(params: MutateParams, opts?: { includeLuigi?: boolean; autoEnter?: boolean }): string[] {
  const codes: string[] = [];
  if (params.level != null) {
    const { anumber, high } = translevelBytes(params.level);
    codes.push(par(0x7e13bf, anumber));
    if (high) codes.push(par(0x7e000f, 1));
  }
  if (params.owHave) {
    const sub = (params.owSubmap ?? 0) & 0xff;
    const x = (params.owX ?? 0) & 0x1f;
    const y = (params.owY ?? 0) & 0x1f;
    const includeLuigi = opts?.includeLuigi !== false;
    codes.push(par(0x7e1f11, sub));
    if (includeLuigi) codes.push(par(0x7e1f12, sub));
    codes.push(par(0x7e13c3, sub));
    add16(codes, 0x7e1f1f, x);
    add16(codes, 0x7e1f21, y);
    add16(codes, 0x7e1f17, owPixels(x));
    add16(codes, 0x7e1f19, owPixels(y));
    if (includeLuigi) {
      add16(codes, 0x7e1f23, x);
      add16(codes, 0x7e1f25, y);
      add16(codes, 0x7e1f1b, owPixels(x));
      add16(codes, 0x7e1f1d, owPixels(y));
    }
  }
  if (opts?.autoEnter) {
    codes.push(par(0x7e0100, 0x0f));
  }
  if (codes.length > MAX_RAM_PATCHES) {
    throw new Error(`PAR code count ${codes.length} exceeds sd2snes RAM limit ${MAX_RAM_PATCHES}`);
  }
  return codes;
}

export function assertNoLoaderGg(codes: string[]): void {
  for (const c of codes) {
    if (!/^[0-9A-Fa-f]{8}$/.test(c)) {
      throw new Error(`Not a PAR8 code (refusing Game Genie): ${c}`);
    }
    const addr = Number.parseInt(c.slice(0, 6), 16);
    if (addr >= LOADER_ROM_LO && addr < LOADER_ROM_HI) {
      throw new Error(`Refusing loader-region patch $${c}`);
    }
    // ROM PAR typically 8xxxxx / 9xxxxx / 00–3F mapped; 7E/7F is WRAM
    if (addr < 0x7e0000 || addr > 0x7fffff) {
      if (addr >= LOADER_ROM_LO && addr < LOADER_ROM_HI) {
        throw new Error(`Refusing loader-region patch $${c}`);
      }
    }
  }
}

export function formatSd2snesYml(name: string, codes: string[], enabled = true): string {
  assertNoLoaderGg(codes);
  const codeLines = codes.map((c) => `    - "${c}"`).join('\n');
  return `---
- Name: ${JSON.stringify(name).slice(1, -1)}
  Code:
${codeLines}
  Enabled: ${enabled ? 'True' : 'False'}
`;
}
