import { getSectionDecoded } from '../rhstate1/codec.ts';
import { obselByte } from '../rhstate1/obsel.ts';
import { splitRomHeader } from '../rhstate1/rom-info.ts';
import { emptyDmaChannel, type DmaChannel, type DspVoice, type InternalRegs, type PpuState, type RhState1 } from '../rhstate1/types.ts';
import { alignSpcFetchPc, prepareSpcResume } from '../players/mesen-state-map.ts';

export { obselByte } from '../rhstate1/obsel.ts';

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

/** Spin until $2140 equals value (no timeout). */
function emitWait2140Ack(bytes: number[], value: number): void {
  const loop = bytes.length;
  bytes.push(0xaf, 0x40, 0x21, 0x00, 0xc9, u8(value));
  const bne = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bne + 1, loop);
}
function emitWait2140(bytes: number[], value: number, jumpBrls?: number[]): void {
  bytes.push(0xa2, 0x00, 0x00); // LDX #0
  const loop = bytes.length;
  bytes.push(0xaf, 0x40, 0x21, 0x00, 0xc9, u8(value));
  const beq = bytes.length;
  bytes.push(0xf0, 0x00); // BEQ done
  bytes.push(0xca); // DEX
  const bne = bytes.length;
  bytes.push(0xd0, 0x00); // BNE loop
  if (jumpBrls) {
    jumpBrls.push(bytes.length + 1);
    bytes.push(0x82, 0x00, 0x00);
  }
  const done = bytes.length;
  patchRel8(bytes, beq + 1, done);
  patchRel8(bytes, bne + 1, loop);
}

/** A already holds the expected $2140 echo. Timeout BRLs to the trampoline jump. */
function emitWaitEcho(bytes: number[], jumpBrls?: number[]): void {
  bytes.push(0xa2, 0x00, 0x00); // LDX #0
  const loop = bytes.length;
  bytes.push(0xcf, 0x40, 0x21, 0x00); // CMP $002140
  const beq = bytes.length;
  bytes.push(0xf0, 0x00); // BEQ done
  bytes.push(0xca); // DEX
  const bne = bytes.length;
  bytes.push(0xd0, 0x00); // BNE loop
  if (jumpBrls) {
    jumpBrls.push(bytes.length + 1);
    bytes.push(0x82, 0x00, 0x00);
  }
  const done = bytes.length;
  patchRel8(bytes, beq + 1, done);
  patchRel8(bytes, bne + 1, loop);
}

function emitIplKick(bytes: number[], dest: number, kick: number, more: boolean, jumpBrls?: number[], ack = false): void {
  ldaSta(bytes, dest, 0x2142);
  ldaSta(bytes, dest >> 8, 0x2143);
  ldaSta(bytes, more ? 0x01 : 0x00, 0x2141);
  ldaSta(bytes, kick, 0x2140);
  if (ack) emitWait2140Ack(bytes, kick);
  else emitWait2140(bytes, kick, jumpBrls);
}

/**
 * Index = Y&$FF, data on $2141. Dest $0000 IPL streams 32KiB then dest-high
 * `BPL` fails. High ARAM is the same loop fed to the $02DD copier (never IPL
 * dest ≥ $8000 — that JMPs into sample RAM).
 */
function emitIplStream(bytes: number[], count: number, jumpBrls?: number[]): void {
  bytes.push(0xa0, 0x00, 0x00); // LDY #0
  const byteLoop = bytes.length;
  bytes.push(
    0xb9, 0x00, 0x80,       // LDA $8000,Y
    0x8f, 0x41, 0x21, 0x00, // STA $002141
    0x98,                   // TYA
    0x8f, 0x40, 0x21, 0x00, // STA $002140
  );
  emitWaitEcho(bytes, jumpBrls);
  bytes.push(
    0xc8,                   // INY
    0xc0, u8(count), u8(count >> 8),
  );
  const bneByte = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneByte + 1, byteLoop);
}

function patchRel8(bytes: number[], offsetByte: number, target: number): void {
  const rel = target - (offsetByte + 1);
  if (rel < -128 || rel > 127) throw new Error(`rel8 out of range (${rel})`);
  bytes[offsetByte] = rel & 0xff;
}

function patchRel16(bytes: number[], offsetLo: number, target: number): void {
  const rel = (target - (offsetLo + 2)) & 0xffff;
  bytes[offsetLo] = rel & 0xff;
  bytes[offsetLo + 1] = (rel >> 8) & 0xff;
}

/** Below echo. Akogare has 86 zeros at $02DD. Copies $8000–$FFBF then JMP trampoline. */
export const SPC_COPIER_ADDR = 0x02dd;

/** Below echo ($6000) and IPL ROM. Akogare has 102 zeros at $0386 in the first 32KiB. */
export const SPC_TRAMPOLINE_ADDR = 0x0386;

export function spcHighCopier(trampAddr: number): Uint8Array {
  const bytes: number[] = [
    0x8f, 0x00, 0x00, // MOV $00,#$00
    0x8f, 0x80, 0x01, // MOV $01,#$80
    0x8d, 0x00,       // MOV Y,#$00
  ];
  const wait = bytes.length;
  bytes.push(0x7e, 0xf4); // CMP Y,$F4
  const bneWait = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneWait + 1, wait);
  bytes.push(
    0xe4, 0xf5, // MOV A,$F5
    0xcb, 0xf4, // MOV $F4,Y
    0xd7, 0x00, // MOV [$00]+Y,A
    0xfc,       // INC Y
  );
  const bnePage = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bnePage + 1, wait);
  bytes.push(
    0xab, 0x01, // INC $01
    0xe4, 0x01, // MOV A,$01
    0x68, 0xff, // CMP A,#$FF
  );
  const bneHi = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneHi + 1, wait);
  const waitff = bytes.length;
  bytes.push(0x7e, 0xf4);
  const bneFf = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneFf + 1, waitff);
  bytes.push(
    0xe4, 0xf5,
    0xcb, 0xf4,
    0xd7, 0x00,
    0xfc,
    0xad, 0xc0, // CMP Y,#$C0
  );
  const bneLast = bytes.length;
  bytes.push(0xd0, 0x00);
  patchRel8(bytes, bneLast + 1, waitff);
  bytes.push(0x5f, trampAddr & 0xff, (trampAddr >> 8) & 0xff);
  return Uint8Array.from(bytes);
}

export function spcTrampolineAddr(_state?: RhState1): number {
  return SPC_TRAMPOLINE_ADDR;
}

function findAramZeroRun(aram: Uint8Array, len: number, forbidden: [number, number][]): number {
  let i = 0;
  while (i + len <= aram.length) {
    if (aram[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < aram.length && aram[j] === 0) j += 1;
    if (j - i >= len && !forbidden.some(([a, b]) => i < b && a < i + len)) return i;
    i = j;
  }
  return -1;
}

/** KON is write-triggered and reads back 0. Restart voices that still had an envelope. */
function konRestart(dsp: Uint8Array, voices?: DspVoice[]): number {
  let bits = 0;
  for (let v = 0; v < 8; v += 1) {
    const envx = dsp[v * 16 + 8] ?? 0;
    const vol = voices?.[v]?.env_volume ?? 0;
    const out = voices?.[v]?.env_out ?? 0;
    if (envx !== 0 || vol !== 0 || out !== 0) bits |= 1 << v;
  }
  return bits & 0xff;
}

export interface SpcDspPoke {
  table: number;
  kon: number;
}

/**
 * SPC bytes IPL jumps to after the ARAM copy. Restores PSW/SP/CONTROL/DP, copies
 * DSP regs (KON is 0 in a capture — write-trigger it last), then X/Y/A and JMP.
 */
export function spcResumeTrampoline(state: RhState1, dspPoke?: SpcDspPoke | null): { addr: number; bytes: Uint8Array; pc: number } {
  const aram = getSectionDecoded(state, 'spc_aram');
  const spc = state.spc;
  const pc = alignSpcFetchPc(aram, spc?.pc ?? 0);
  const addr = spcTrampolineAddr(state);
  const psw = (spc?.psw ?? 0) & 0xff;
  const sp = (spc?.sp ?? 0xef) & 0xff;
  const x = (spc?.x ?? 0) & 0xff;
  const y = (spc?.y ?? 0) & 0xff;
  const a = (spc?.a ?? 0) & 0xff;
  const f1 = aram && aram.length > 0xf1 ? aram[0xf1]! : 0;
  const dp0 = aram && aram.length > 0 ? aram[0]! : 0;
  const dp1 = aram && aram.length > 1 ? aram[1]! : 0;
  const poke = dspPoke === undefined
    ? dspPokeForState(state, pad(aram ?? new Uint8Array(0), 0x10000))
    : dspPoke;
  const out: number[] = [
    0xe8, psw,             // MOV A,#psw
    0x2d,                  // PUSH A
    0x8e,                  // POP PSW
    0xcd, sp,              // MOV X,#sp
    0xbd,                  // MOV SP,X
    0x8f, f1, 0xf1,        // MOV $F1,#f1  (unmap IPL if bit7=0)
    0x8f, dp0, 0x00,       // MOV $00,#  (undo IPL dest word)
    0x8f, dp1, 0x01,       // MOV $01,#
  ];
  if (poke) {
    out.push(0xcd, 0x00); // MOV X,#0
    const loop = out.length;
    out.push(0xf5, poke.table & 0xff, (poke.table >> 8) & 0xff); // MOV A,!table+X
    out.push(0xd8, 0xf2); // MOV $F2,X
    out.push(0xc4, 0xf3); // MOV $F3,A
    out.push(0x3d); // INC X
    const bpl = out.length;
    out.push(0x10, 0x00); // BPL loop (X=0..$7F)
    out[bpl + 1] = (loop - (bpl + 2)) & 0xff;
    out.push(0x8f, 0x4c, 0xf2); // MOV $F2,#$4C
    out.push(0x8f, poke.kon & 0xff, 0xf3); // MOV $F3,#kon
  }
  out.push(
    0xcd, x,               // MOV X,#x
    0x8d, y,               // MOV Y,#y
    0xe8, a,               // MOV A,#a
    0x5f, pc & 0xff, (pc >> 8) & 0xff, // JMP !pc
  );
  return { addr, bytes: Uint8Array.from(out), pc };
}

function dspPokeForState(state: RhState1, aram: Uint8Array): SpcDspPoke | null {
  const dsp = getSectionDecoded(state, 'dsp');
  if (!dsp || dsp.length < 0x80) return null;
  const esa = (dsp[0x6d] ?? 0) << 8;
  const edl = (dsp[0x7d] ?? 0) & 0x0f;
  const echoLen = edl === 0 ? 0 : edl * 0x800;
  const table = findAramZeroRun(aram, 0x80, [
    [0, 0x100],
    [SPC_COPIER_ADDR, SPC_COPIER_ADDR + 0x40],
    [SPC_TRAMPOLINE_ADDR, SPC_TRAMPOLINE_ADDR + 0x80],
    [esa, esa + echoLen],
    [0xffc0, 0x10000],
  ]);
  if (table < 0) return null;
  return { table, kon: konRestart(dsp, state.dsp_voices) };
}

/**
 * SPC IPL dest $0000 streams 32KiB (includes high copier at $02DD). Jump to the
 * copier (kick $80, Y=0); it copies $8000–$FFBF without dest-high IPL JMP, then
 * JMP $0386 trampoline. No-$AA skip jumps IPL to $0386.
 */
function emitSpcIplUpload(bytes: number[], aramBank: number, cpuRegs?: number[]): void {
  bytes.push(0xc2, 0x10); // REP #$10
  bytes.push(0x8b); // PHB — both success and skip PLB
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
  bytes.push(0x82, 0x00, 0x00); // BRL skip (no $AA)
  const got = bytes.length;
  patchRel8(bytes, beqGot + 1, got);
  patchRel8(bytes, bneInner + 1, inner);
  patchRel8(bytes, bneOuter + 1, outer);

  const jump32: number[] = [];
  const jumpHi: number[] = [];
  bytes.push(0xa9, u8(aramBank), 0x48, 0xab);
  emitIplKick(bytes, 0x0000, 0xcc, true, jump32);
  emitIplStream(bytes, 0x8000, jump32);
  const doJump = bytes.length;
  emitIplKick(bytes, SPC_COPIER_ADDR, 0x80, false);
  bytes.push(0xa9, u8(aramBank + 1), 0x48, 0xab);
  emitIplStream(bytes, 0x7fc0, jumpHi);
  const afterHi = bytes.length;
  const regs = cpuRegs ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) {
    ldaSta(bytes, regs[i] ?? 0, 0x2140 + i);
  }
  bytes.push(0xab); // PLB success
  const braEnd = bytes.length;
  bytes.push(0x80, 0x00); // BRA end
  const skip = bytes.length;
  // No $AA: IPL is still in BIOS. Jump ($2141=0) to the low trampoline so later
  // game APUIO cannot IPL-jump into RAM. Unuploaded ARAM is typically $FF (STOP).
  emitIplKick(bytes, SPC_TRAMPOLINE_ADDR, 0xcc, false);
  bytes.push(0xab); // PLB timeout
  const endIpl = bytes.length;
  bytes[braEnd + 1] = (endIpl - (braEnd + 2)) & 0xff;
  patchRel16(bytes, brlSkip + 1, skip);
  for (const off of jump32) patchRel16(bytes, off, doJump);
  for (const off of jumpHi) patchRel16(bytes, off, afterHi);
  bytes.push(0xe2, 0x10); // SEP #$10
}

function emitPpuPokes(bytes: number[], state: RhState1): void {
  const ppu = state.ppu;
  if (ppu) {
    ldaSta(bytes, obselByte(ppu), 0x2101);
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

  const aramBank = (bank + WRAM_BANKS + VRAM_BANKS) & 0xff;
  emitSpcIplUpload(bytes, aramBank, state.spc?.cpu_regs);

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
  // #region agent log
  {
    const has = (n: number[]) => {
      outer: for (let i = 0; i + n.length <= stub.length; i += 1) {
        for (let j = 0; j < n.length; j += 1) if (stub[i + j] !== n[j]) continue outer;
        return true;
      }
      return false;
    };
    fetch('http://localhost:7700/ingest/a16a51ec-9c44-41df-b5a8-3a0cdb17c431', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c4b0c8' }, body: JSON.stringify({ sessionId: 'c4b0c8', hypothesisId: 'A', location: 'boot-restore.ts:buildBootRestoreRom', message: 'stub assembled', data: { stubLen: stub.length, stubMax: STUB_CODE_MAX, stubBank, hasLdx1: has([0xa2, 0x01, 0x00]), hasCpx7f: has([0xe0, 0x7f, 0x00]), hasJumpC1: has([0xa9, 0xc1, 0x8f, 0x40, 0x21, 0x00]), hasCpy8000: has([0xc0, 0x00, 0x80]), hasCpy7fc0: has([0xc0, 0xc0, 0x7f]), hasKick80: has([0xa9, 0x80, 0x8f, 0x40, 0x21, 0x00]), hasCopierDest: has([0xa9, 0xdd, 0x8f, 0x42, 0x21, 0x00]), hasCopierHi: has([0xa9, 0x02, 0x8f, 0x43, 0x21, 0x00]) }, timestamp: Date.now(), runId: 'post-fix-026' }) }).catch(() => {});
  }
  // #endregion

  const stubBankBytes = new Uint8Array(LOROM_BANK);
  stubBankBytes.set(stub);
  stubBankBytes.set(pad(getSectionDecoded(work, 'cgram'), 0x200), STUB_CGRAM_ADDR - 0x8000);
  stubBankBytes.set(pad(getSectionDecoded(work, 'oam'), 0x220), STUB_OAM_ADDR - 0x8000);
  stubBankBytes.set(packDmaRegs(work), STUB_DMA_ADDR - 0x8000);

  const payload = new Uint8Array(PAYLOAD_BANKS * LOROM_BANK);
  payload.set(pad(wram, 0x20000), 0);
  payload.set(pad(getSectionDecoded(work, 'vram'), 0x10000), WRAM_BANKS * LOROM_BANK);
  const aramPayload = pad(getSectionDecoded(work, 'spc_aram'), 0x10000);
  const dspPoke = dspPokeForState(work, aramPayload);
  const spcTramp = spcResumeTrampoline(work, dspPoke);
  const copier = spcHighCopier(spcTramp.addr);
  if (SPC_COPIER_ADDR + copier.length <= aramPayload.length) {
    aramPayload.set(copier, SPC_COPIER_ADDR);
  }
  if (dspPoke) {
    const dsp = getSectionDecoded(work, 'dsp');
    if (dsp && dsp.length >= 0x80) {
      const table = pad(dsp.subarray(0, 0x80), 0x80);
      table[0x4c] = 0; // KON mid-loop is a no-op; trampoline write-triggers after
      aramPayload.set(table, dspPoke.table);
    }
  }
  if (spcTramp.addr < aramPayload.length) {
    aramPayload[spcTramp.addr] = 0xff; // STOP if IPL jumps here without overlay
  }
  if (spcTramp.addr + spcTramp.bytes.length <= aramPayload.length) {
    aramPayload.set(spcTramp.bytes, spcTramp.addr);
  }
  // #region agent log
  fetch('http://localhost:7700/ingest/a16a51ec-9c44-41df-b5a8-3a0cdb17c431', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'c4b0c8' }, body: JSON.stringify({ sessionId: 'c4b0c8', hypothesisId: 'E', location: 'boot-restore.ts:aramOverlay', message: 'aram overlay', data: { copierAddr: SPC_COPIER_ADDR, copierLen: copier.length, trampAddr: spcTramp.addr, trampLen: spcTramp.bytes.length, copierHead: [aramPayload[SPC_COPIER_ADDR], aramPayload[SPC_COPIER_ADDR + 1], aramPayload[SPC_COPIER_ADDR + 2]], copierJmp: [aramPayload[SPC_COPIER_ADDR + copier.length - 3], aramPayload[SPC_COPIER_ADDR + copier.length - 2], aramPayload[SPC_COPIER_ADDR + copier.length - 1]], trampJmp: [aramPayload[spcTramp.addr + spcTramp.bytes.length - 3], aramPayload[spcTramp.addr + spcTramp.bytes.length - 2], aramPayload[spcTramp.addr + spcTramp.bytes.length - 1]] }, timestamp: Date.now(), runId: 'post-fix-026' }) }).catch(() => {});
  // #endregion
  payload.set(aramPayload, (WRAM_BANKS + VRAM_BANKS) * LOROM_BANK);

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
  const rstTramp = loromOffset(0, 0xff70);
  if (rstTramp + 4 <= expanded.length) {
    const destBank = origBanks & 0xff;
    expanded[rstTramp] = 0x5c;
    expanded[rstTramp + 1] = 0x00;
    expanded[rstTramp + 2] = 0x80;
    expanded[rstTramp + 3] = destBank;
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
