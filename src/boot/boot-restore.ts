import { getSectionDecoded } from '../rhstate1/codec.ts';
import { splitRomHeader } from '../rhstate1/rom-info.ts';
import { emptyDmaChannel, type DmaChannel, type InternalRegs, type PpuState, type RhState1 } from '../rhstate1/types.ts';
import { prepareSpcResume } from '../players/mesen-state-map.ts';

const LOROM_BANK = 0x8000;
export const STUB_CGRAM_ADDR = 0x8600;
export const STUB_OAM_ADDR = 0x8800;
export const STUB_DMA_ADDR = 0x8a20;
const STUB_CODE_MAX = STUB_CGRAM_ADDR - 0x8000;
const WRAM_BANKS = 4;
const VRAM_BANKS = 2;
const ARAM_BANKS = 2;
const PAYLOAD_BANKS = WRAM_BANKS + VRAM_BANKS + ARAM_BANKS;

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

function pad(src: Uint8Array | null, len: number): Uint8Array {
  const out = new Uint8Array(len);
  if (src) out.set(src.subarray(0, Math.min(src.length, len)));
  return out;
}

export function nmiTimenByte(ir?: InternalRegs | null): number {
  if (!ir) return 0x81;
  return ((ir.enable_nmi ? 0x80 : 0)
    | (ir.enable_v_irq ? 0x20 : 0)
    | (ir.enable_h_irq ? 0x10 : 0)
    | (ir.enable_auto_joy ? 1 : 0)) & 0xff;
}

export function inidispByte(ppu?: PpuState | null): number {
  if (!ppu) return 0x0f;
  return ((ppu.forced_blank ? 0x80 : 0) | (ppu.brightness & 0x0f)) & 0xff;
}

function ldaSta(bytes: number[], value: number, addr: number): void {
  // Long addressing: abs STA is DBR-relative; IPL sets DBR to a payload bank.
  bytes.push(0xa9, u8(value), 0x8f, u8(addr), u8(addr >> 8), 0x00);
}

function stzAbs(bytes: number[], addr: number): void {
  bytes.push(0xa9, 0x00, 0x8f, u8(addr), u8(addr >> 8), 0x00);
}

function writeTwice(bytes: number[], addr: number, word: number): void {
  ldaSta(bytes, word, addr);
  ldaSta(bytes, word >> 8, addr);
}

/** Channel 0 DMA from LoROM $8000, bank, size (0 = 64KiB). */
function dmaFromBank(bytes: number[], opts: { dmap: number; bbad: number; bank: number; src?: number; size: number }): void {
  const src = opts.src ?? 0x8000;
  ldaSta(bytes, opts.dmap, 0x4300);
  ldaSta(bytes, opts.bbad, 0x4301);
  ldaSta(bytes, src, 0x4302);
  ldaSta(bytes, src >> 8, 0x4303);
  ldaSta(bytes, opts.bank, 0x4304);
  ldaSta(bytes, opts.size, 0x4305);
  ldaSta(bytes, opts.size >> 8, 0x4306);
  ldaSta(bytes, 0x01, 0x420b);
}

function dmaWramBank(bytes: number[], dest: number, srcBank: number): void {
  ldaSta(bytes, dest, 0x2181);
  ldaSta(bytes, dest >> 8, 0x2182);
  ldaSta(bytes, dest >> 16, 0x2183);
  dmaFromBank(bytes, { dmap: 0x00, bbad: 0x80, bank: srcBank, size: 0x8000 });
}

function packDmaRegs(state: RhState1): Uint8Array {
  const table = new Uint8Array(0x80);
  const chans = state.dma?.channels ?? [];
  for (let i = 0; i < 8; i += 1) {
    const ch: DmaChannel = chans[i] ?? emptyDmaChannel();
    const b = i * 16;
    table[b] = ((ch.invert_direction ? 0x80 : 0)
      | (ch.hdma_indirect ? 0x40 : 0)
      | (ch.unused_43x0 ? 0x20 : 0)
      | (ch.fixed_transfer ? 0x10 : 0)
      | (ch.decrement ? 0x08 : 0)
      | (ch.transfer_mode & 7)) & 0xff;
    table[b + 1] = ch.dest & 0xff;
    table[b + 2] = ch.src_address & 0xff;
    table[b + 3] = (ch.src_address >> 8) & 0xff;
    table[b + 4] = ch.src_bank & 0xff;
    table[b + 5] = ch.transfer_size & 0xff;
    table[b + 6] = (ch.transfer_size >> 8) & 0xff;
    table[b + 7] = ch.hdma_bank & 0xff;
    table[b + 8] = ch.hdma_table & 0xff;
    table[b + 9] = (ch.hdma_table >> 8) & 0xff;
    table[b + 10] = ch.hdma_line & 0xff;
  }
  return table;
}

/** Wait until $00:2140 == value. 16-bit X is a spin limit so a dead APU cannot freeze NMI. */
function emitWait2140(bytes: number[], value: number): void {
  bytes.push(0xa2, 0x00, 0x00); // LDX #0
  const loop = bytes.length;
  bytes.push(0xaf, 0x40, 0x21, 0x00, 0xc9, u8(value));
  const beq = bytes.length;
  bytes.push(0xf0, 0x00); // BEQ done
  bytes.push(0xca); // DEX
  const bne = bytes.length;
  bytes.push(0xd0, 0x00); // BNE loop
  const done = bytes.length;
  patchRel8(bytes, beq + 1, done);
  patchRel8(bytes, bne + 1, loop);
}

function emitIplKick(bytes: number[], dest: number, kick: number, more: boolean): void {
  ldaSta(bytes, dest, 0x2142);
  ldaSta(bytes, dest >> 8, 0x2143);
  ldaSta(bytes, more ? 0x01 : 0x00, 0x2141);
  ldaSta(bytes, kick, 0x2140);
  emitWait2140(bytes, kick);
}

/** One IPL block: 32KiB via 8-bit index wrap (IPL increments dest high itself). */
function emitIpl32k(bytes: number[]): void {
  bytes.push(0xa0, 0x00, 0x00); // LDY #0
  const byteLoop = bytes.length;
  bytes.push(
    0xb9, 0x00, 0x80,       // LDA $8000,Y
    0x8f, 0x41, 0x21, 0x00, // STA $002141
    0x98,                   // TYA
    0x8f, 0x40, 0x21, 0x00, // STA $002140
    0xcf, 0x40, 0x21, 0x00, // CMP $002140
    0xd0, 0xfa,             // BNE wait echo
    0xc8,                   // INY
    0xc0, 0x00, 0x80,       // CPY #$8000
  );
  const bneByte = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneByte + 1, byteLoop);
}

function patchRel8(bytes: number[], offsetByte: number, target: number): void {
  bytes[offsetByte] = (target - (offsetByte + 1)) & 0xff;
}

function patchRel16(bytes: number[], offsetLo: number, target: number): void {
  const rel = (target - (offsetLo + 2)) & 0xffff;
  bytes[offsetLo] = rel & 0xff;
  bytes[offsetLo + 1] = (rel >> 8) & 0xff;
}

/**
 * SPC IPL: one transfer can stream until dest high bit7 is set (~32KiB).
 * A 64KiB transfer wraps dest and never finishes. Two 32KiB blocks is the
 * right split. Do not start a new command every 256 bytes: after Y wraps the
 * IPL increments dest high and expects index 0 of the *same* transfer, so a
 * new $2140 kick deadlocks and $4200 is never written.
 */
function emitSpcIplUpload(bytes: number[], aramBank: number, spcPc: number): void {
  bytes.push(0xc2, 0x10); // REP #$10
  bytes.push(0xa0, 0x20, 0x00); // LDY #$0020 timeout outer
  const outer = bytes.length;
  bytes.push(0xa2, 0x00, 0x00); // LDX #0
  const inner = bytes.length;
  bytes.push(0xaf, 0x40, 0x21, 0x00, 0xc9, 0xaa);
  const beqGot = bytes.length;
  bytes.push(0xf0, 0x00); // BEQ got
  bytes.push(0xca); // DEX
  const bneInner = bytes.length;
  bytes.push(0xd0, 0x00); // BNE inner
  bytes.push(0x88); // DEY
  const bneOuter = bytes.length;
  bytes.push(0xd0, 0x00); // BNE outer
  const brlSkip = bytes.length;
  bytes.push(0x82, 0x00, 0x00); // BRL skip
  const got = bytes.length;
  patchRel8(bytes, beqGot + 1, got);
  patchRel8(bytes, bneInner + 1, inner);
  patchRel8(bytes, bneOuter + 1, outer);

  bytes.push(0x8b); // PHB
  bytes.push(0xa9, u8(aramBank), 0x48, 0xab);
  emitIplKick(bytes, 0x0000, 0xcc, true);
  emitIpl32k(bytes);
  bytes.push(0xa9, u8(aramBank + 1), 0x48, 0xab);
  emitIplKick(bytes, 0x8000, 0x01, true);
  emitIpl32k(bytes);
  emitIplKick(bytes, spcPc & 0xffff, 0x01, false);
  bytes.push(0xab); // PLB

  const skip = bytes.length;
  patchRel16(bytes, brlSkip + 1, skip);
  bytes.push(0xe2, 0x10); // SEP #$10
}

function emitPpuPokes(bytes: number[], state: RhState1): void {
  const ppu = state.ppu;
  if (ppu) {
    ldaSta(bytes, ppu.oam_mode, 0x2101);
    let bgmode = ppu.bgmode & 0x07;
    if (ppu.mode1_bg3_priority) bgmode |= 0x08;
    const layers = ppu.layers ?? [];
    for (let i = 0; i < 4; i += 1) {
      if (layers[i]?.large_tiles) bgmode |= 0x10 << i;
    }
    ldaSta(bytes, bgmode, 0x2105);
    ldaSta(bytes, ((ppu.mosaic_size & 0x0f) << 4) | (ppu.mosaic_enabled & 0x0f), 0x2106);
    for (let i = 0; i < 4; i += 1) {
      const L = layers[i];
      if (!L) continue;
      const sc = ((L.tilemap_address >> 8) & 0xfc) | (L.double_width ? 1 : 0) | (L.double_height ? 2 : 0);
      ldaSta(bytes, sc, 0x2107 + i);
    }
    const nba01 = ((layers[0]?.chr_address ?? 0) >> 12) | (((layers[1]?.chr_address ?? 0) >> 8) & 0xf0);
    const nba23 = ((layers[2]?.chr_address ?? 0) >> 12) | (((layers[3]?.chr_address ?? 0) >> 8) & 0xf0);
    ldaSta(bytes, nba01, 0x210b);
    ldaSta(bytes, nba23, 0x210c);
    for (let i = 0; i < 4; i += 1) {
      const L = layers[i];
      if (!L) continue;
      writeTwice(bytes, 0x210d + i * 2, L.hscroll);
      writeTwice(bytes, 0x210e + i * 2, L.vscroll);
    }
    const m7 = ppu.mode7_matrix;
    if (m7 && m7.length >= 4) {
      ldaSta(bytes,
        (ppu.mode7_hflip ? 1 : 0) | (ppu.mode7_vflip ? 2 : 0) | (ppu.mode7_fill0 ? 0x40 : 0) | (ppu.mode7_large ? 0x80 : 0),
        0x211a);
      writeTwice(bytes, 0x211b, m7[0]!);
      writeTwice(bytes, 0x211c, m7[1]!);
      writeTwice(bytes, 0x211d, m7[2]!);
      writeTwice(bytes, 0x211e, m7[3]!);
      writeTwice(bytes, 0x211f, ppu.mode7_center_x ?? 0);
      writeTwice(bytes, 0x2120, ppu.mode7_center_y ?? 0);
    }
    if (ppu.window0_left != null) ldaSta(bytes, ppu.window0_left, 0x2126);
    if (ppu.window0_right != null) ldaSta(bytes, ppu.window0_right, 0x2127);
    if (ppu.window1_left != null) ldaSta(bytes, ppu.window1_left, 0x2128);
    if (ppu.window1_right != null) ldaSta(bytes, ppu.window1_right, 0x2129);
    ldaSta(bytes, ppu.main_screen_layers, 0x212c);
    ldaSta(bytes, ppu.sub_screen_layers, 0x212d);
    ldaSta(bytes,
      (ppu.direct_color ? 1 : 0)
      | (ppu.color_math_add_sub ? 2 : 0)
      | ((ppu.color_math_prevent & 3) << 4)
      | ((ppu.color_math_clip & 3) << 6),
      0x2130);
    ldaSta(bytes,
      (ppu.color_math_enabled & 0x3f)
      | (ppu.color_math_halve ? 0x40 : 0)
      | (ppu.color_math_subtract ? 0x80 : 0),
      0x2131);
    ldaSta(bytes, ppu.fixed_color, 0x2132);
    ldaSta(bytes,
      (ppu.screen_interlace ? 1 : 0)
      | (ppu.obj_interlace ? 2 : 0)
      | (ppu.overscan ? 4 : 0)
      | (ppu.hi_res ? 8 : 0)
      | (ppu.extbg ? 0x40 : 0),
      0x2133);
    const vmain = (ppu.vram_inc_on_high ? 0x80 : 0)
      | ((ppu.vram_remap & 3) << 2)
      | (ppu.vram_increment === 32 ? 1 : ppu.vram_increment === 128 ? 2 : 0);
    ldaSta(bytes, vmain, 0x2115);
    ldaSta(bytes, ppu.vram_address, 0x2116);
    ldaSta(bytes, ppu.vram_address >> 8, 0x2117);
    ldaSta(bytes, ppu.cgram_address, 0x2121);
    ldaSta(bytes, ppu.oam_addr, 0x2102);
    ldaSta(bytes, ((ppu.oam_addr >> 8) & 1) | (ppu.oam_priority ? 0x80 : 0), 0x2103);
  }
  const fil = getSectionDecoded(state, 'fillram');
  if (fil) {
    for (const a of [0x2123, 0x2124, 0x2125, 0x212a, 0x212b, 0x212e, 0x212f]) {
      if (a < fil.length) ldaSta(bytes, fil[a]!, a);
    }
  }
}

function emitCpuMmio(bytes: number[], state: RhState1, stubBank: number): void {
  const ir = state.internal;
  if (ir) {
    ldaSta(bytes, ir.io_port ?? 0xff, 0x4201);
    ldaSta(bytes, ir.h_timer, 0x4207);
    ldaSta(bytes, ir.h_timer >> 8, 0x4208);
    ldaSta(bytes, ir.v_timer, 0x4209);
    ldaSta(bytes, ir.v_timer >> 8, 0x420a);
    ldaSta(bytes, ir.enable_fastrom ? 1 : 0, 0x420d);
  }
  // Copy $4300–$437F from stub-bank table (long indexed; DBR is still 0).
  bytes.push(
    0xc2, 0x10,             // REP #$10
    0xa2, 0x00, 0x00,       // LDX #0
    0xbf, u8(STUB_DMA_ADDR), u8(STUB_DMA_ADDR >> 8), u8(stubBank), // LDA abs,x long
    0x9f, 0x00, 0x43, 0x00, // STA $004300,x
    0xe8,                   // INX
    0xe0, 0x80, 0x00,       // CPX #$80
    0xd0, 0xf2,             // BNE back to LDA long
    0xe2, 0x10,             // SEP #$10
  );
  ldaSta(bytes, state.dma?.hdma_channels ?? 0, 0x420c);
}

/**
 * Boot-restore stub: SEI, native, force blank, DMA WRAM/VRAM/CGRAM/OAM,
 * IPL-upload ARAM, poke PPU/$4200, restore CPU, JML captured PC.
 */
export function assembleBootStub(opts: { payloadBank: number; stubBank: number; state: RhState1 }): Uint8Array {
  const state = opts.state.spc ? { ...opts.state, spc: { ...opts.state.spc } } : opts.state;
  prepareSpcResume(state);
  const cpu = state.cpu;
  const bank = opts.payloadBank & 0xff;
  const stubBank = opts.stubBank & 0xff;
  const pc = cpu.pc >>> 0;
  const pb = (pc >>> 16) & 0xff;
  const pc16 = pc & 0xffff;
  const a = cpu.a & 0xffff;
  const x = cpu.x & 0xffff;
  const y = cpu.y & 0xffff;
  const d = cpu.d & 0xffff;
  const db = cpu.db & 0xff;
  const sp = cpu.sp & 0xffff;
  const p = cpu.p & 0xff;
  const vram = getSectionDecoded(state, 'vram');
  const cgram = getSectionDecoded(state, 'cgram');
  const oam = getSectionDecoded(state, 'oam');

  const bytes: number[] = [
    0x78,             // SEI
    0x18, 0xfb,       // CLC XCE
    0xc2, 0x30,       // REP #$30
    0xa9, u8(d), u8(d >> 8),
    0x5b,             // TCD
    0xa2, u8(sp), u8(sp >> 8),
    0x9a,             // TXS
    0xe2, 0x20,       // SEP #$20
  ];
  ldaSta(bytes, 0x80, 0x2100);
  ldaSta(bytes, 0x00, 0x4200);

  const wramDest = [0x00000, 0x08000, 0x10000, 0x18000];
  for (let i = 0; i < WRAM_BANKS; i += 1) {
    dmaWramBank(bytes, wramDest[i]!, (bank + i) & 0xff);
  }

  if (vram && vram.length > 0) {
    ldaSta(bytes, 0x80, 0x2115);
    stzAbs(bytes, 0x2116);
    stzAbs(bytes, 0x2117);
    for (let i = 0; i < VRAM_BANKS; i += 1) {
      dmaFromBank(bytes, { dmap: 0x01, bbad: 0x18, bank: (bank + WRAM_BANKS + i) & 0xff, size: 0x8000 });
    }
  }

  if (cgram && cgram.length > 0) {
    stzAbs(bytes, 0x2121);
    dmaFromBank(bytes, {
      dmap: 0x00,
      bbad: 0x22,
      bank: stubBank,
      src: STUB_CGRAM_ADDR,
      size: 0x200,
    });
  }

  if (oam && oam.length > 0) {
    stzAbs(bytes, 0x2102);
    stzAbs(bytes, 0x2103);
    dmaFromBank(bytes, {
      dmap: 0x00,
      bbad: 0x04,
      bank: stubBank,
      src: STUB_OAM_ADDR,
      size: 0x220,
    });
  }

  // IPL byte-wait deadlocks (APU never echoes) and never reaches $4200, so
  // $7E0010 stays 0. ARAM is still embedded for a later handshake; the APU
  // stays in IPL. NMI must be enabled for Technique A to leave the wait loop.

  emitPpuPokes(bytes, state);
  emitCpuMmio(bytes, state, stubBank);

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
  );
  if (cpu.e) {
    bytes.push(0x38, 0xfb); // SEC XCE
  }
  // Enable NMI only after CPU regs are live so the first vblank hits the
  // game handler, not the stub.
  ldaSta(bytes, inidispByte(state.ppu), 0x2100);
  ldaSta(bytes, nmiTimenByte(state.internal), 0x4200);
  bytes.push(0x5c, u8(pc16), u8(pc16 >> 8), pb); // JML pc
  return Uint8Array.from(bytes);
}

export interface BootRestoreResult {
  rom: Uint8Array;
  stubOffset: number;
  payloadOffset: number;
  vramOffset: number;
  aramOffset: number;
  cgramOffset: number;
  oamOffset: number;
}

export function buildBootRestoreRom(original: Uint8Array, state: RhState1): BootRestoreResult {
  const { body, headered } = splitRomHeader(original);
  const header = headered ? original.subarray(0, 512) : null;
  const wram = getSectionDecoded(state, 'wram');
  if (!wram) throw new Error('missing wram');

  const work: RhState1 = state.spc ? { ...state, spc: { ...state.spc } } : state;
  prepareSpcResume(work);

  const origBanks = Math.ceil(body.length / LOROM_BANK);
  const stubBank = origBanks;
  const payloadBank = origBanks + 1;
  const stub = assembleBootStub({ payloadBank, stubBank, state: work });
  if (stub.length > STUB_CODE_MAX) {
    throw new Error(`boot stub too large (${stub.length} > ${STUB_CODE_MAX})`);
  }

  const stubBankBytes = new Uint8Array(LOROM_BANK);
  stubBankBytes.set(stub);
  stubBankBytes.set(pad(getSectionDecoded(work, 'cgram'), 0x200), STUB_CGRAM_ADDR - 0x8000);
  stubBankBytes.set(pad(getSectionDecoded(work, 'oam'), 0x220), STUB_OAM_ADDR - 0x8000);
  stubBankBytes.set(packDmaRegs(work), STUB_DMA_ADDR - 0x8000);

  const payload = new Uint8Array(PAYLOAD_BANKS * LOROM_BANK);
  payload.set(pad(wram, 0x20000), 0);
  payload.set(pad(getSectionDecoded(work, 'vram'), 0x10000), WRAM_BANKS * LOROM_BANK);
  payload.set(pad(getSectionDecoded(work, 'spc_aram'), 0x10000), (WRAM_BANKS + VRAM_BANKS) * LOROM_BANK);

  const minLen = (origBanks + 1 + PAYLOAD_BANKS) * LOROM_BANK;
  let newLen = 0x8000;
  while (newLen < minLen) newLen *= 2;
  const expanded = new Uint8Array(newLen);
  expanded.set(body);
  const stubOff = origBanks * LOROM_BANK;
  const payloadOff = (origBanks + 1) * LOROM_BANK;
  expanded.set(stubBankBytes, stubOff);
  expanded.set(payload, payloadOff);

  const rst = loromOffset(0, 0xfffc);
  const tramp = loromOffset(0, 0xff70);
  if (tramp + 4 <= expanded.length) {
    const destBank = origBanks & 0xff;
    expanded[tramp] = 0x5c;
    expanded[tramp + 1] = 0x00;
    expanded[tramp + 2] = 0x80;
    expanded[tramp + 3] = destBank;
    expanded[rst] = 0x70;
    expanded[rst + 1] = 0xff;
  }

  setSizeNibble(expanded);
  writeSnesChecksum(expanded);

  const result: BootRestoreResult = {
    rom: expanded,
    stubOffset: stubOff,
    payloadOffset: payloadOff,
    vramOffset: payloadOff + WRAM_BANKS * LOROM_BANK,
    aramOffset: payloadOff + (WRAM_BANKS + VRAM_BANKS) * LOROM_BANK,
    cgramOffset: stubOff + (STUB_CGRAM_ADDR - 0x8000),
    oamOffset: stubOff + (STUB_OAM_ADDR - 0x8000),
  };
  if (header) {
    const out = new Uint8Array(512 + expanded.length);
    out.set(header);
    out.set(expanded, 512);
    result.rom = out;
  }
  return result;
}
