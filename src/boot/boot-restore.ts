import { splitRomHeader } from '../rhstate1/rom-info.ts';
import type { Cpu5A22 } from '../rhstate1/types.ts';

const LOROM_BANK = 0x8000;

export function loromOffset(bank: number, addr: number): number {
  return (bank & 0x7f) * LOROM_BANK + (addr & 0x7fff);
}

/** SNES checksum + complement at $FFDC (LoROM bank 0). */
export function writeSnesChecksum(body: Uint8Array): void {
  const csumOff = loromOffset(0, 0xffdc);
  if (csumOff + 4 > body.length) return;
  body[csumOff] = 0xff;
  body[csumOff + 1] = 0xff;
  body[csumOff + 2] = 0x00;
  body[csumOff + 3] = 0x00;
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum = (sum + body[i]) & 0xffff;
  const complement = (sum ^ 0xffff) & 0xffff;
  body[csumOff] = complement & 0xff;
  body[csumOff + 1] = (complement >> 8) & 0xff;
  body[csumOff + 2] = sum & 0xff;
  body[csumOff + 3] = (sum >> 8) & 0xff;
}

function setSizeNibble(body: Uint8Array): void {
  const off = loromOffset(0, 0xffd7);
  if (off >= body.length) return;
  let n = 0;
  let s = 0x400;
  while (s < body.length && n < 0x0d) {
    s *= 2;
    n += 1;
  }
  body[off] = n;
}

function u8(n: number): number {
  return n & 0xff;
}

/**
 * Tiny 65816 stub: SEI, native mode, force blank, DMA 4×32KiB LoROM payload → WRAM,
 * restore a subset of CPU regs, JML captured PC.
 * Payload bank is patched at PAYLOAD_BANK_OFF (LDA #imm).
 */
export function assembleBootStub(opts: { payloadBank: number; cpu: Cpu5A22 }): Uint8Array {
  const bank = opts.payloadBank & 0xff;
  const pc = opts.cpu.pc >>> 0;
  const pb = (pc >>> 16) & 0xff;
  const pc16 = pc & 0xffff;
  const a = opts.cpu.a & 0xffff;
  const x = opts.cpu.x & 0xffff;
  const y = opts.cpu.y & 0xffff;
  const d = opts.cpu.d & 0xffff;
  const db = opts.cpu.db & 0xff;
  const sp = opts.cpu.sp & 0xffff;
  const p = opts.cpu.p & 0xff;

  // Hand-assembled; see src/asm/boot_restore.asm
  const bytes: number[] = [
    0x78, // SEI
    0x18, 0xfb, // CLC XCE
    0xc2, 0x30, // REP #$30
    0xa9, u8(d), u8(d >> 8), // LDA #D
    0x5b, // TCD
    0xa2, u8(sp), u8(sp >> 8), // LDX #SP
    0x9a, // TXS
    0xe2, 0x20, // SEP #$20
    0xa9, 0x80, 0x8d, 0x00, 0x21, // LDA #$80 STA $2100
    0xa9, 0x00, 0x8d, 0x00, 0x42, // STZ-ish $4200
  ];

  // 4 DMA copies: dest WRAM offset 0,0x8000,0x10000,0x18000 from banks bank..bank+3 at $8000
  const wramDest = [0x00000, 0x08000, 0x10000, 0x18000];
  for (let i = 0; i < 4; i += 1) {
    const dest = wramDest[i];
    const srcBank = (bank + i) & 0xff;
    bytes.push(
      0xa9, u8(dest),
      0x8d, 0x81, 0x21, // WMADDL
      0xa9, u8(dest >> 8),
      0x8d, 0x82, 0x21, // WMADDM
      0xa9, u8(dest >> 16),
      0x8d, 0x83, 0x21, // WMADDH
      0xa9, 0x00,
      0x8d, 0x00, 0x43, // DMAP0
      0xa9, 0x80,
      0x8d, 0x01, 0x43, // BBAD0 = $2180
      0xa9, 0x00,
      0x8d, 0x02, 0x43, // A1T0L
      0xa9, 0x80,
      0x8d, 0x03, 0x43, // A1T0H = $8000
      0xa9, srcBank,
      0x8d, 0x04, 0x43, // A1B0
      0xa9, 0x00,
      0x8d, 0x05, 0x43,
      0xa9, 0x80,
      0x8d, 0x06, 0x43, // DAS0 = $8000
      0xa9, 0x01,
      0x8d, 0x0b, 0x42, // MDMAEN
    );
  }

  bytes.push(
    0xc2, 0x30, // REP #$30
    0xa9, u8(a), u8(a >> 8),
    0xa2, u8(x), u8(x >> 8),
    0xa0, u8(y), u8(y >> 8),
    0xe2, 0x20, // SEP #$20
    0xa9, db,
    0x48, 0xab, // PHA PLB
    0xa9, p,
    0x48, 0x28, // PHA PLP
    0x5c, u8(pc16), u8(pc16 >> 8), pb, // JML pc
  );

  return Uint8Array.from(bytes);
}

export interface BootRestoreResult {
  rom: Uint8Array;
  stubOffset: number;
  payloadOffset: number;
}

export function buildBootRestoreRom(original: Uint8Array, wram: Uint8Array, cpu: Cpu5A22): BootRestoreResult {
  const { body, headered } = splitRomHeader(original);
  const header = headered ? original.subarray(0, 512) : null;
  const wramPad = new Uint8Array(0x20000);
  wramPad.set(wram.subarray(0, Math.min(wram.length, wramPad.length)));

  const stubTmp = assembleBootStub({ payloadBank: 0, cpu });
  const stubBankBytes = new Uint8Array(LOROM_BANK);
  stubBankBytes.set(stubTmp);

  const origBanks = Math.ceil(body.length / LOROM_BANK);
  const payloadBank = origBanks + 1; // skip one bank for stub
  const stub = assembleBootStub({ payloadBank, cpu });
  stubBankBytes.fill(0);
  stubBankBytes.set(stub);

  const payload = new Uint8Array(4 * LOROM_BANK);
  payload.set(wramPad);

  const minLen = (origBanks + 1 + 4) * LOROM_BANK;
  let newLen = 0x8000;
  while (newLen < minLen) newLen *= 2;
  const expanded = new Uint8Array(newLen);
  expanded.set(body);
  const stubOff = origBanks * LOROM_BANK;
  expanded.set(stubBankBytes, stubOff);
  expanded.set(payload, (origBanks + 1) * LOROM_BANK);

  // Reset vector $00FFFC → stub at bank origBanks, $8000
  const rst = loromOffset(0, 0xfffc);
  expanded[rst] = 0x00;
  expanded[rst + 1] = 0x80;
  // Emulation reset uses bank in $00; LoROM maps bank origBanks via $FFFC only as 16-bit.
  // Put a trampoline in bank 0 only if origBanks===0; otherwise also write $00FFFE unused.
  // For LoROM, reset fetches from bank $00 $FFFC. Stub must live in bank 0 OR we need a bank-0 trampoline.
  // Place a 4-byte JML trampoline at $008000 if origBanks>0... actually bank 0 $8000 is the start of the ROM.
  // Safer: overwrite reset to JML in bank 0 unused area $FF70, trampoline JML to stub.
  const tramp = loromOffset(0, 0xff70);
  if (tramp + 4 <= expanded.length) {
    const destBank = origBanks & 0xff;
    expanded[tramp] = 0x5c; // JML
    expanded[tramp + 1] = 0x00;
    expanded[tramp + 2] = 0x80;
    expanded[tramp + 3] = destBank;
    expanded[rst] = 0x70;
    expanded[rst + 1] = 0xff;
  }

  setSizeNibble(expanded);
  writeSnesChecksum(expanded);

  if (header) {
    const out = new Uint8Array(512 + expanded.length);
    out.set(header);
    out.set(expanded, 512);
    return { rom: out, stubOffset: stubOff, payloadOffset: (origBanks + 1) * LOROM_BANK };
  }
  return { rom: expanded, stubOffset: stubOff, payloadOffset: (origBanks + 1) * LOROM_BANK };
}
