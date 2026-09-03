import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBootRestoreRom, inidispByte, loromOffset, nmiTimenByte, obselByte } from '../src/boot/boot-restore.ts';
import { reconstructFillram } from '../src/players/mesen-state-map.ts';
import { emptyCpu, makeFixtureRom, makeState } from './helpers.ts';
import type { InternalRegs, PpuLayer, PpuState } from '../src/rhstate1/types.ts';

function bodyOf(rom: Uint8Array): Uint8Array {
  return rom.length % 1024 === 512 ? rom.subarray(512) : rom;
}

function findSeq(hay: Uint8Array, needle: number[], from = 0): number {
  outer: for (let i = from; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function layer(partial: Partial<PpuLayer>): PpuLayer {
  return {
    tilemap_address: 0,
    chr_address: 0,
    hscroll: 0,
    vscroll: 0,
    double_width: 0,
    double_height: 0,
    large_tiles: 0,
    ...partial,
  };
}

function akogareLikeState() {
  const wram = new Uint8Array(0x20000);
  wram[0x10] = 0;
  wram[0x100] = 0x14;
  const vram = new Uint8Array(0x10000);
  vram[0] = 0x11;
  vram[1] = 0x22;
  const cgram = new Uint8Array(0x200);
  cgram[0] = 0x33;
  const oam = new Uint8Array(0x220);
  oam[0] = 0x44;
  const aram = new Uint8Array(0x10000);
  aram[0x11b0] = 0xf4;
  aram[0x11b1] = 0x81;
  const ppu: PpuState = {
    forced_blank: 0,
    brightness: 14,
    bgmode: 1,
    mode1_bg3_priority: 1,
    main_screen_layers: 21,
    sub_screen_layers: 2,
    cgram_address: 0,
    vram_address: 0,
    vram_increment: 1,
    vram_remap: 0,
    vram_inc_on_high: 1,
    vram_read_buffer: 0,
    mosaic_size: 0,
    mosaic_enabled: 0,
    oam_mode: 0,
    oam_base: 24576,
    oam_addr: 0,
    oam_priority: 1,
    oam_address_offset: 4096,
    hi_res: 0,
    screen_interlace: 0,
    obj_interlace: 0,
    overscan: 0,
    direct_color: 0,
    extbg: 0,
    color_math_enabled: 32,
    color_math_subtract: 0,
    color_math_halve: 0,
    color_math_add_sub: 0,
    color_math_clip: 0,
    color_math_prevent: 0,
    fixed_color: 0,
    layers: [
      layer({ tilemap_address: 12288, double_width: 1, vscroll: 0xc0 }),
      layer({ tilemap_address: 14336, double_width: 1, vscroll: 0xc0 }),
      layer({ tilemap_address: 20480, chr_address: 16384, double_width: 1, double_height: 1 }),
      layer({}),
    ],
  };
  const internal: InternalRegs = {
    enable_nmi: 1,
    enable_v_irq: 1,
    enable_h_irq: 0,
    enable_auto_joy: 1,
    h_timer: 511,
    v_timer: 36,
    enable_fastrom: 0,
    io_port: 255,
    wram_port: 0,
  };
  return makeState(wram, {
    cpu: { ...emptyCpu(), pc: 0x95feec, e: 0, p: 0x33 },
    ppu,
    internal,
    spc: { a: 0, x: 2, y: 20, psw: 2, sp: 0xcd, pc: 0x11b1, cpu_regs: [0x11, 0x22, 0x33, 0x44] },
    dma: { hdma_channels: 0, channels: [] },
    sections: [
      { id: 'wram', bus: 0x7e0000, encoding: 'raw', data: wram },
      { id: 'vram', bus: 0, encoding: 'raw', data: vram },
      { id: 'cgram', bus: 0, encoding: 'raw', data: cgram },
      { id: 'oam', bus: 0, encoding: 'raw', data: oam },
      { id: 'spc_aram', bus: 0, encoding: 'raw', data: aram },
    ],
  });
}

test('rhboot1-sfc leaves $05D89B loader bytes unchanged and retargets reset', () => {
  const rom = makeFixtureRom();
  const loader = loromOffset(0x05, 0xd89b);
  const before = Buffer.from(rom.subarray(loader, loader + 4));
  const wram = new Uint8Array(0x20000);
  const st = makeState(wram, { cpu: { ...emptyCpu(), pc: 0x808123 } });
  const { rom: out } = buildBootRestoreRom(rom, st);
  const body = bodyOf(out);
  const after = Buffer.from(body.subarray(loader, loader + 4));
  assert.deepEqual(after, before);
  const rst = loromOffset(0, 0xfffc);
  const origRst = Buffer.from(rom.subarray(rst, rst + 2));
  const newRst = Buffer.from(body.subarray(rst, rst + 2));
  assert.notDeepEqual(newRst, origRst);
  assert.ok(body.length > rom.length);
});

test('boot-restore does not write $05DCDD either', () => {
  const rom = makeFixtureRom();
  const off = loromOffset(0x05, 0xdcdd);
  rom[off] = 0xab;
  rom[off + 1] = 0xcd;
  const { rom: out } = buildBootRestoreRom(rom, makeState(new Uint8Array(0x20000)));
  const body = bodyOf(out);
  assert.equal(body[off], 0xab);
  assert.equal(body[off + 1], 0xcd);
});

test('boot-restore embeds VRAM/CGRAM/OAM/ARAM and pokes NMI + INIDISP before JML', () => {
  const st = akogareLikeState();
  const { rom: out, payloadOffset, vramOffset, aramOffset, cgramOffset, oamOffset, stubOffset } = buildBootRestoreRom(makeFixtureRom(), st);
  const body = bodyOf(out);
  assert.equal(body[vramOffset], 0x11);
  assert.equal(body[vramOffset + 1], 0x22);
  assert.equal(body[cgramOffset], 0x33);
  assert.equal(body[oamOffset], 0x44);
  assert.equal(body[aramOffset + 0x11b0], 0xf4);
  assert.equal(body[payloadOffset], 0); // $7E0010
  assert.equal(body[payloadOffset + 0x100], 0x14);

  const stub = body.subarray(stubOffset, stubOffset + 0x600);
  const nmi = nmiTimenByte(st.internal);
  const disp = inidispByte(st.ppu);
  assert.equal(nmi, 0xa1);
  assert.equal(disp, 0x0e);
  const staNmi = findSeq(stub, [0xa9, nmi, 0x8f, 0x00, 0x42, 0x00]);
  const staDisp = findSeq(stub, [0xa9, disp, 0x8f, 0x00, 0x21, 0x00]);
  const jml = findSeq(stub, [0x5c, 0xec, 0xfe, 0x95]);
  assert.ok(staNmi >= 0, 'STA $4200 with captured NMITIMEN');
  assert.ok(staDisp >= 0, 'STA $2100 with captured INIDISP');
  assert.ok(jml >= 0, 'JML $95FEEC');
  assert.ok(staDisp < staNmi, 'INIDISP before $4200');
  assert.ok(staNmi < jml, '$4200 before JML');
  const plp = findSeq(stub, [0x48, 0x28]);
  assert.ok(plp >= 0 && plp < staNmi, 'PLP before enabling NMI');
  const vscroll = findSeq(stub, [0xa9, 0xc0, 0x8f, 0x0e, 0x21, 0x00, 0xa9, 0x00, 0x8f, 0x0e, 0x21, 0x00]);
  assert.ok(vscroll >= 0, 'BG1 vscroll $00C0 write-twice to $210E');
  const obsel = findSeq(stub, [0xa9, 0x03, 0x8f, 0x01, 0x21, 0x00]);
  assert.ok(obsel >= 0, 'STA $2101 with packed OBSEL $03');
  assert.ok(findSeq(stub, [0xc9, 0xaa]) >= 0, 'IPL waits for $AA');
  assert.ok(findSeq(stub, [0x8f, 0x42, 0x21, 0x00]) >= 0, 'IPL writes dest $2142');
  assert.equal(findSeq(stub, [0xcf, 0x40, 0x21, 0x00, 0xd0, 0xfa]), -1, 'IPL byte wait is timed (not BNE -6)');
  const waitCmp = findSeq(stub, [0xcf, 0x40, 0x21, 0x00, 0xf0]);
  assert.ok(waitCmp >= 0, 'IPL byte wait CMP then BEQ');
  assert.equal(stub[waitCmp + 6], 0xca, 'DEX after failed echo');
  assert.ok(findSeq(stub, [0xa9, 0x11, 0x8f, 0x40, 0x21, 0x00]) >= 0, 'restore APUIO $2140 from cpu_regs');
  assert.ok(findSeq(stub, [0xa9, 0x22, 0x8f, 0x41, 0x21, 0x00]) >= 0, 'restore APUIO $2141 from cpu_regs');
});

test('obselByte packs Mesen OamMode/base/offset into $2101', () => {
  assert.equal(obselByte({ oam_mode: 0, oam_base: 24576, oam_address_offset: 4096 }), 0x03);
  assert.equal(obselByte({ oam_mode: 3, oam_base: 0x4000, oam_address_offset: 0x3000 }), 0x72);
  assert.equal(obselByte({ oam_mode: 0, oam_base: 0 }), 0x00);
});

test('reconstructFillram writes packed OBSEL to $2101', () => {
  const st = akogareLikeState();
  const fil = reconstructFillram(st);
  assert.equal(fil[0x2101], 0x03);
});

test('nmiTimen / inidisp helpers match the akogare capture bits', () => {
  assert.equal(nmiTimenByte({
    enable_nmi: 1, enable_v_irq: 1, enable_h_irq: 0, enable_auto_joy: 1,
    h_timer: 0, v_timer: 0, enable_fastrom: 0, io_port: 0xff, wram_port: 0,
  }), 0xa1);
  assert.equal(inidispByte({
    forced_blank: 0, brightness: 14, bgmode: 1, mode1_bg3_priority: 0,
    main_screen_layers: 0, sub_screen_layers: 0, cgram_address: 0, vram_address: 0,
    vram_increment: 1, vram_remap: 0, vram_inc_on_high: 0, vram_read_buffer: 0,
    mosaic_size: 0, mosaic_enabled: 0, oam_mode: 0, oam_base: 0, oam_addr: 0,
    oam_priority: 0, hi_res: 0, screen_interlace: 0, obj_interlace: 0, overscan: 0,
    direct_color: 0, extbg: 0, color_math_enabled: 0, color_math_subtract: 0,
    color_math_halve: 0, color_math_add_sub: 0, color_math_clip: 0, color_math_prevent: 0,
    fixed_color: 0,
  }), 0x0e);
});
