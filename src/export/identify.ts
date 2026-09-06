/** Detect core-native savestate blobs. Do not treat mercury BST and BizHawk zip as interchangeable. */

export type NativeStateKind = 'mss' | 'mercury' | 'bizhawk' | 'unknown';

const BST1 = Buffer.from('BST1', 'ascii');
const MSS = Buffer.from('MSS', 'ascii');
const PK = Buffer.from('PK\x03\x04');

function u16le(buf: Uint8Array, off: number): number {
  return buf[off]! | (buf[off + 1]! << 8);
}

function u32le(buf: Uint8Array, off: number): number {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

function cstring(buf: Uint8Array): string {
  let end = buf.indexOf(0);
  if (end < 0) end = buf.length;
  return Buffer.from(buf.subarray(0, end)).toString('ascii');
}

export function isPkZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

export function isMssMagic(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === MSS[0] && buf[1] === MSS[1] && buf[2] === MSS[2];
}

export function isMercuryBst(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === BST1[0] && buf[1] === BST1[1] && buf[2] === BST1[2] && buf[3] === BST1[3];
}

/** ZIP local-file names (best-effort; data-descriptor members still yield a name). */
export function zipLocalNames(buf: Uint8Array): string[] {
  const names: string[] = [];
  const hay = Buffer.from(buf);
  let from = 0;
  while (from + 30 <= hay.length) {
    const at = hay.indexOf(PK, from);
    if (at < 0 || at + 30 > hay.length) break;
    const nameLen = u16le(hay, at + 26);
    const extraLen = u16le(hay, at + 28);
    const flags = u16le(hay, at + 6);
    const compSize = u32le(hay, at + 18);
    if (at + 30 + nameLen > hay.length) break;
    names.push(hay.subarray(at + 30, at + 30 + nameLen).toString('utf8'));
    if (flags & 0x8) {
      from = at + 30 + nameLen + extraLen;
    } else {
      from = at + 30 + nameLen + extraLen + compSize;
    }
    if (from <= at) from = at + 1;
  }
  return names;
}

const MERCURY_PROFILES = new Set(['balanced', 'accuracy', 'performance']);

function normalizeProfile(s: string): string {
  return s.trim().toLowerCase();
}

export function parseMercuryHeader(buf: Uint8Array): { version: number; profile: string } {
  if (!isMercuryBst(buf)) throw new Error('not a mercury BST1 blob (missing BST1 magic)');
  if (isPkZip(buf)) throw new Error('file is a ZIP, not a mercury BST1 blob');
  if (buf.length < 28) throw new Error('mercury blob too small');
  const version = u32le(buf, 4);
  const profile094 = normalizeProfile(cstring(buf.subarray(12, 28)));
  if (MERCURY_PROFILES.has(profile094)) return { version, profile: profile094 };
  if (buf.length >= 600) {
    // higan/mercury: signature, version, sha256 hex[64], description[512], profile[16]
    const later = normalizeProfile(cstring(buf.subarray(584, 600)));
    if (MERCURY_PROFILES.has(later)) return { version, profile: later };
  }
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 1024))).toString('latin1');
  const m = head.match(/balanced|accuracy|performance/i);
  if (m) return { version, profile: normalizeProfile(m[0]!) };
  throw new Error('mercury BST1 header has no recognizable profile string');
}

/** v094-style header (signature, version, crc32, profile[16], description[512]). */
export function fakeMercuryHeader(profile = 'balanced', version = 15): Buffer {
  const buf = Buffer.alloc(12 + 16 + 512);
  BST1.copy(buf, 0);
  buf.writeUInt32LE(version >>> 0, 4);
  buf.writeUInt32LE(0, 8);
  buf.write(profile, 12, 'ascii');
  return buf;
}

export function identifyNativeState(buf: Uint8Array): NativeStateKind {
  if (isMssMagic(buf)) return 'mss';
  if (isPkZip(buf)) {
    const names = zipLocalNames(buf);
    if (names.includes('BizState 1.0')) return 'bizhawk';
    return 'unknown';
  }
  if (isMercuryBst(buf)) return 'mercury';
  return 'unknown';
}

export function assertMercuryCoreBlob(buf: Uint8Array): { version: number; profile: string } {
  if (isPkZip(buf)) {
    throw new Error('refusing a BizHawk ZIP as a mercury savestate (BSNES-v115 Core ≠ BST1)');
  }
  const hdr = parseMercuryHeader(buf);
  if (hdr.profile !== 'balanced') {
    throw new Error(`mercury profile must be balanced, got ${hdr.profile}`);
  }
  return hdr;
}

export function assertBizhawkStateZip(buf: Uint8Array): string[] {
  if (isMercuryBst(buf) && !isPkZip(buf)) {
    throw new Error('refusing a raw mercury BST1 blob as a BizHawk .state zip');
  }
  if (!isPkZip(buf)) throw new Error('BizHawk savestate must be a ZIP (BizState 1.0)');
  const names = zipLocalNames(buf);
  if (!names.includes('BizState 1.0')) {
    throw new Error('BizHawk zip is missing the BizState 1.0 lump');
  }
  if (!names.includes('Core')) {
    throw new Error('BizHawk zip is missing the Core lump');
  }
  return names;
}

export function assertMssFile(buf: Uint8Array): void {
  if (!isMssMagic(buf)) throw new Error('not a Mesen .mss (missing MSS magic)');
}
