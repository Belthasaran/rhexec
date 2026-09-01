import { deflateSync, inflateSync } from 'node:zlib';

/** Mesen 2 `.mss` on-disk format (SaveStateManager + Serializer binary). */

export const MSS_MAGIC = Buffer.from('MSS', 'ascii');
export const MSS_FMT_VERSION = 4;
export const MSS_CONSOLE_SNES = 0;

export interface MssEntry {
  key: string;
  data: Uint8Array;
}

export interface MssFile {
  emuVersion: number;
  fmtVersion: number;
  consoleType: number;
  romName: string;
  entries: MssEntry[];
  index: Map<string, Uint8Array>;
}

function u32le(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24);
}

function wrU32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function parseEntries(state: Uint8Array): MssEntry[] {
  const entries: MssEntry[] = [];
  let i = 0;
  while (i < state.length) {
    const z = state.indexOf(0, i);
    if (z < 0 || z + 5 > state.length) break;
    const key = Buffer.from(state.subarray(i, z)).toString('utf8');
    const sz = u32le(state, z + 1);
    const start = z + 5;
    if (start + sz > state.length) break;
    entries.push({ key, data: state.subarray(start, start + sz) });
    i = start + sz;
  }
  return entries;
}

function encodeEntries(entries: MssEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(Buffer.from(e.key, 'utf8'));
    parts.push(Buffer.from([0]));
    parts.push(wrU32le(e.data.length));
    parts.push(Buffer.from(e.data));
  }
  return Buffer.concat(parts);
}

function tinyFramebuffer(): { rawSize: number; compressed: Buffer } {
  const raw = Buffer.alloc(4);
  return { rawSize: 4, compressed: deflateSync(raw) };
}

export function parseMss(file: Uint8Array): MssFile {
  if (file.length < 35) throw new Error('mss: too small');
  if (file[0] !== 0x4d || file[1] !== 0x53 || file[2] !== 0x53) {
    throw new Error('mss: missing MSS magic');
  }
  const emuVersion = u32le(file, 3);
  const fmtVersion = u32le(file, 7);
  const consoleType = u32le(file, 11);
  const fbCompSize = u32le(file, 31);
  let off = 35;
  if (off + fbCompSize > file.length) throw new Error('mss: framebuffer past EOF');
  off += fbCompSize;
  if (off + 4 > file.length) throw new Error('mss: rom name past EOF');
  const nameLen = u32le(file, off);
  off += 4;
  if (off + nameLen > file.length) throw new Error('mss: rom name body past EOF');
  const romName = Buffer.from(file.subarray(off, off + nameLen)).toString('utf8');
  off += nameLen;
  if (off + 9 > file.length) throw new Error('mss: state envelope past EOF');
  const isCompressed = file[off];
  off += 1;
  const decompSize = u32le(file, off);
  off += 4;
  const compSize = u32le(file, off);
  off += 4;
  if (off + compSize > file.length) throw new Error('mss: state body past EOF');
  let state: Uint8Array;
  if (isCompressed === 1) {
    const inflated = inflateSync(Buffer.from(file.subarray(off, off + compSize)));
    if (inflated.length !== decompSize) {
      throw new Error(`mss: state size mismatch ${inflated.length} != ${decompSize}`);
    }
    state = inflated;
  } else if (isCompressed === 0) {
    state = file.subarray(off, off + decompSize);
  } else {
    throw new Error(`mss: unknown compression flag ${isCompressed}`);
  }
  const entries = parseEntries(state);
  const index = new Map<string, Uint8Array>();
  for (const e of entries) index.set(e.key, e.data);
  return { emuVersion, fmtVersion, consoleType, romName, entries, index };
}

export function createEmptyMss(romName: string): MssFile {
  return {
    emuVersion: 0,
    fmtVersion: MSS_FMT_VERSION,
    consoleType: MSS_CONSOLE_SNES,
    romName,
    entries: [],
    index: new Map(),
  };
}

export function mssHas(mss: MssFile, key: string): boolean {
  return mss.index.has(key);
}

export function mssGet(mss: MssFile, key: string): Uint8Array | null {
  return mss.index.get(key) ?? null;
}

export function mssAdd(mss: MssFile, key: string, data: Uint8Array): void {
  const copy = new Uint8Array(data);
  const existing = mss.entries.findIndex((e) => e.key === key);
  if (existing >= 0) {
    mss.entries[existing] = { key, data: copy };
  } else {
    mss.entries.push({ key, data: copy });
  }
  mss.index.set(key, copy);
}

export function mssAddU8(mss: MssFile, key: string, v: number): void {
  mssAdd(mss, key, Uint8Array.of(v & 0xff));
}

export function mssAddBool(mss: MssFile, key: string, v: boolean | number): void {
  mssAddU8(mss, key, v ? 1 : 0);
}

export function mssAddU16(mss: MssFile, key: string, v: number): void {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v & 0xffff, 0);
  mssAdd(mss, key, b);
}

export function mssAddS16(mss: MssFile, key: string, v: number): void {
  const b = Buffer.alloc(2);
  b.writeInt16LE(v, 0);
  mssAdd(mss, key, b);
}

export function mssAddU32(mss: MssFile, key: string, v: number): void {
  mssAdd(mss, key, wrU32le(v));
}

export function mssU8(mss: MssFile, key: string, fallback = 0): number {
  const d = mss.index.get(key);
  return d && d.length >= 1 ? d[0]! : fallback;
}

export function mssU16(mss: MssFile, key: string, fallback = 0): number {
  const d = mss.index.get(key);
  if (!d || d.length < 2) return fallback;
  return d[0]! | (d[1]! << 8);
}

export function mssS16(mss: MssFile, key: string, fallback = 0): number {
  const d = mss.index.get(key);
  if (!d || d.length < 2) return fallback;
  const u = d[0]! | (d[1]! << 8);
  return u > 32767 ? u - 65536 : u;
}

export function mssU32(mss: MssFile, key: string, fallback = 0): number {
  const d = mss.index.get(key);
  if (!d || d.length < 4) return fallback;
  return u32le(d, 0);
}

export function mssBytes(mss: MssFile, key: string, want: number): Uint8Array | null {
  const d = mss.index.get(key);
  if (!d) return null;
  if (d.length === want) return d;
  const out = new Uint8Array(want);
  out.set(d.subarray(0, Math.min(d.length, want)));
  return out;
}

export function encodeMss(mss: MssFile): Buffer {
  const state = encodeEntries(mss.entries);
  const compressed = deflateSync(state);
  const { rawSize, compressed: fb } = tinyFramebuffer();
  const name = Buffer.from(mss.romName, 'utf8');
  return Buffer.concat([
    MSS_MAGIC,
    wrU32le(mss.emuVersion),
    wrU32le(mss.fmtVersion),
    wrU32le(mss.consoleType),
    wrU32le(rawSize),
    wrU32le(1),
    wrU32le(1),
    wrU32le(100),
    wrU32le(fb.length),
    fb,
    wrU32le(name.length),
    name,
    Buffer.from([1]),
    wrU32le(state.length),
    wrU32le(compressed.length),
    compressed,
  ]);
}
