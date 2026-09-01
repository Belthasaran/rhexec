import type { MutateParams } from './types.ts';

/** 4lvno translevel: $13BF gets !anumber; $0F high bit when level >= $100. */
export function translevelBytes(level: number): { anumber: number; high: number } {
  const val = level & 0x1ff;
  const anumber = val >= 0x25 ? (val - 0xdc) & 0xff : val & 0xff;
  const high = val >= 0x100 ? 1 : 0;
  return { anumber, high };
}

export function owPixels(tile: number): number {
  return ((tile & 0x1f) * 0x10 + 0x08) & 0xffff;
}

function write8(wram: Uint8Array, addr: number, value: number): void {
  if (addr < 0 || addr >= wram.length) {
    throw new Error(`WRAM write out of range: $${addr.toString(16)}`);
  }
  wram[addr] = value & 0xff;
}

function write16(wram: Uint8Array, addr: number, value: number): void {
  write8(wram, addr, value & 0xff);
  write8(wram, addr + 1, (value >> 8) & 0xff);
}

/**
 * Mutate a $7E/$7F WRAM image in place (offsets = 24-bit bus minus $7E0000).
 * Mirrors extrapatches/4lvno.asm RelocateOW + $13BF / $0F.
 */
export function mutateWram(wram: Uint8Array, params: MutateParams): void {
  if (params.level != null && params.level !== undefined) {
    const { anumber, high } = translevelBytes(params.level);
    write8(wram, 0x13bf, anumber);
    if (high) write8(wram, 0x000f, 1);
  }
  if (params.owHave) {
    const sub = (params.owSubmap ?? 0) & 0xff;
    const x = (params.owX ?? 0) & 0x1f;
    const y = (params.owY ?? 0) & 0x1f;
    const xpx = owPixels(x);
    const ypx = owPixels(y);
    write8(wram, 0x1f11, sub);
    write8(wram, 0x1f12, sub);
    write8(wram, 0x13c3, sub);
    write16(wram, 0x1f1f, x);
    write16(wram, 0x1f23, x);
    write16(wram, 0x1f21, y);
    write16(wram, 0x1f25, y);
    write16(wram, 0x1f17, xpx);
    write16(wram, 0x1f1b, xpx);
    write16(wram, 0x1f19, ypx);
    write16(wram, 0x1f1d, ypx);
  }
}

/** After ow_ready capture, request fade-to-level like 4lvno OWMainHook. */
export function setGameMode(wram: Uint8Array, mode: number): void {
  write8(wram, 0x0100, mode & 0xff);
}
