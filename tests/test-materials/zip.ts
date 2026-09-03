import { inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipFile {
  name: string;
  data: Buffer;
}

/** Store-method zip (no compression). Used by tests; real SMWC zips are read via extractZip. */
export function makeStoreZip(files: ZipFile[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const localFull = Buffer.concat([local, name, f.data]);
    locals.push(localFull);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    offset += localFull.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  throw new Error('zip: EOCD not found');
}

function listEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    out.push({ name, method, compSize, uncompSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function inflateEntry(buf: Buffer, e: ZipEntry): Buffer {
  if (buf.readUInt32LE(e.localOffset) !== 0x04034b50) throw new Error(`zip: bad local header for ${e.name}`);
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const dataOff = e.localOffset + 30 + nameLen + extraLen;
  const comp = buf.subarray(dataOff, dataOff + e.compSize);
  if (e.method === 0) return Buffer.from(comp);
  if (e.method === 8) return Buffer.from(inflateRawSync(comp));
  throw new Error(`zip: unsupported method ${e.method} for ${e.name}`);
}

function isJunkName(name: string): boolean {
  const base = name.split(/[/\\]/).pop() || name;
  if (name.includes('__MACOSX')) return true;
  if (base.startsWith('.') || base.startsWith('._')) return true;
  return false;
}

/** Extract a .bps from a zip buffer. `bpsName` selects among several; otherwise require exactly one. */
export function extractBpsFromZip(zipBuf: Buffer, bpsName?: string): { name: string; data: Buffer } {
  const entries = listEntries(zipBuf).filter((e) => e.name.toLowerCase().endsWith('.bps') && !isJunkName(e.name));
  if (entries.length === 0) throw new Error('zip: no .bps members');
  let chosen = entries;
  if (bpsName) {
    chosen = entries.filter((e) => e.name === bpsName || e.name.endsWith('/' + bpsName) || e.name.split(/[/\\]/).pop() === bpsName);
    if (chosen.length === 0) {
      throw new Error(`zip: BPS ${bpsName} not found (have ${entries.map((e) => e.name).join(', ')})`);
    }
  } else if (entries.length > 1) {
    throw new Error(`zip: multiple .bps members, pass bpsName (${entries.map((e) => e.name).join(', ')})`);
  }
  const e = chosen[0];
  return { name: e.name.split(/[/\\]/).pop() || e.name, data: inflateEntry(zipBuf, e) };
}
