import { createHash } from 'node:crypto';
import type { RomInfo } from './types.ts';

const HEADER_SIZE = 512;

export function splitRomHeader(buf: Uint8Array): { body: Uint8Array; headered: boolean } {
  if (buf.length % 1024 === HEADER_SIZE) {
    return { body: buf.subarray(HEADER_SIZE), headered: true };
  }
  return { body: buf, headered: false };
}

function headerByte(body: Uint8Array, snesAddr: number): number {
  // LoROM bank 0 $FFxx at file offset (addr - 0x8000)
  const off = snesAddr - 0x8000;
  if (off < 0 || off >= body.length) return 0;
  return body[off];
}

export function inspectRom(buf: Uint8Array): RomInfo {
  const { body, headered } = splitRomHeader(buf);
  const map = headerByte(body, 0xffd5);
  const sa1 = map === 0x23;
  let mapping = 'lorom';
  if (sa1) mapping = 'sa1';
  else if ((map & 0x0f) === 0x01 || (map & 0x0f) === 0x05) mapping = 'hirom';
  const sha1 = createHash('sha1').update(buf).digest('hex');
  return {
    sha1,
    size: body.length,
    headered,
    mapping,
    sa1,
  };
}

export function rhstate1OutPath(romPath: string): string {
  return romPath.replace(/\.(sfc|smc)$/i, '') + '.rhstate1';
}
