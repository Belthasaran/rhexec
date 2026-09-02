import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { applyMutations } from '../src/rhstate1/apply.ts';
import { getSectionDecoded } from '../src/rhstate1/codec.ts';
import { dumpDirToState } from '../src/capture/dump-to-state.ts';
import { writeApplyScript } from '../src/capture/write-lua.ts';
import { createEmptyMss, encodeMss, mssAdd, mssAddU8, mssAddU16, mssBytes, mssGet, mssU8, mssU16, mssU64, parseMss } from '../src/players/mss-format.ts';
import { encodePortableAsMss, mssToPortable, portableToMss, portableToSetState, reconstructFillram, setStateToLua } from '../src/players/mesen-state-map.ts';
import { mesenNormalize } from '../src/players/mesen-keys.ts';
import { emptyDmaChannel } from '../src/rhstate1/types.ts';
import { makeFixtureRom, makeState } from './helpers.ts';

test('MSS parse/synth round-trips header and a few keys', () => {
  const mss = createEmptyMss('fixture.sfc');
  mssAddU16(mss, 'cpu.a', 0x1234);
  mssAddU8(mss, 'cpu.k', 0x80);
  mssAdd(mss, 'memoryManager.workRam', Uint8Array.from([1, 2, 3, 4]));
  const buf = encodeMss(mss);
  assert.equal(buf.subarray(0, 3).toString('ascii'), 'MSS');
  const back = parseMss(buf);
  assert.equal(back.romName, 'fixture.sfc');
  assert.equal(back.fmtVersion, 4);
  assert.equal(back.consoleType, 0);
  assert.equal(mssU16(back, 'cpu.a'), 0x1234);
  assert.equal(mssU8(back, 'cpu.k'), 0x80);
  assert.deepEqual(Array.from(mssGet(back, 'memoryManager.workRam')!), [1, 2, 3, 4]);
});

test('portable cpu/fillram/ppu/dma/spc/dsp_voices map to Mesen keys', () => {
  const wram = new Uint8Array(0x20000);
  wram[0] = 0x14;
  wram[0x13bf] = 0x05;
  const st = makeState(wram, {
    cpu: {
      a: 0x1111, x: 0x2222, y: 0x3333, d: 0x0100, db: 0x7e, p: 0x34,
      sp: 0x1ff, pc: 0x808123, e: 0, waiting: 1, nmi_pending: 1, irq_pending: 1,
    },
    spc: { a: 1, x: 2, y: 3, psw: 4, sp: 5, pc: 0x0200, dsp_reg: 0x4c, rom_enabled: 1 },
    ppu: {
      forced_blank: 1, brightness: 0x0f, bgmode: 1, mode1_bg3_priority: 1,
      main_screen_layers: 0x17, sub_screen_layers: 0, cgram_address: 0,
      vram_address: 0x2000, vram_increment: 1, vram_remap: 0, vram_inc_on_high: 0,
      vram_read_buffer: 0, mosaic_size: 0, mosaic_enabled: 0, oam_mode: 0,
      oam_base: 0, oam_addr: 0, oam_priority: 0, hi_res: 0, screen_interlace: 0,
      obj_interlace: 0, overscan: 0, direct_color: 0, extbg: 0,
      color_math_enabled: 0, color_math_subtract: 0, color_math_halve: 0,
      color_math_add_sub: 0, color_math_clip: 0, color_math_prevent: 0, fixed_color: 0,
      layers: [{
        tilemap_address: 0x4000, chr_address: 0x2000, hscroll: 0x12, vscroll: 0x34,
        double_width: 1, double_height: 0, large_tiles: 0,
      }],
    },
    dma: { hdma_channels: 0x80, channels: Array.from({ length: 8 }, () => emptyDmaChannel()) },
    internal: {
      enable_nmi: 1, enable_v_irq: 0, enable_h_irq: 0, enable_auto_joy: 1,
      h_timer: 0, v_timer: 0, enable_fastrom: 1, io_port: 0xff, wram_port: 0x12345,
    },
    dsp_voices: [{
      env_volume: 0x7f, prev_calculated_env: 1, interpolation_pos: 2, env_mode: 3,
      brr_address: 0x200, brr_offset: 1, voice_bit: 1, key_on_delay: 0, env_out: 10, buffer_pos: 0,
    }],
  });
  st.dma!.channels[0] = { ...emptyDmaChannel(), src_address: 0x4300, src_bank: 0x7e, dest: 0x18, transfer_mode: 1 };

  const mss = portableToMss(st, 'game.sfc');
  assert.equal(mssU16(mss, 'cpu.a'), 0x1111);
  assert.equal(mssU8(mss, 'cpu.k'), 0x80);
  assert.equal(mssU16(mss, 'cpu.pc'), 0x8123);
  assert.equal(mssU8(mss, 'cpu.stopState'), 2);
  assert.equal(mssU8(mss, 'cpu.emulationMode'), 0);
  assert.equal(mssU8(mss, 'cpu.needNmi'), 1);
  assert.equal(mssU8(mss, 'spc.a'), 1);
  assert.equal(mssU8(mss, 'ppu.forcedBlank'), 1);
  assert.equal(mssU8(mss, 'ppu.bgMode'), 1);
  assert.equal(mssU8(mss, 'dmaController.hdmaChannels'), 0x80);
  assert.equal(mssU16(mss, 'dmaController.channel[0].srcAddress'), 0x4300);
  assert.equal(mssU16(mss, 'ppu.layers[0].tilemapAddress'), 0x4000);
  assert.equal(mssU16(mss, 'ppu.layers[0].hscroll'), 0x12);
  assert.ok(mssU64(mss, 'memoryManager.masterClock') >= 1000);
  assert.equal(mssU16(mss, 'spc.dsp.voices[0].envVolume'), 0x7f);
  const wr = mssBytes(mss, 'memoryManager.workRam', 0x20000);
  assert.ok(wr);
  assert.equal(wr[0x13bf], 0x05);

  const back = mssToPortable(mss, {
    rom: st.rom,
    host: st.host,
    profile: 'in_level',
    trigger: { game_mode: 0x14, pc: st.cpu.pc, frame: 1 },
  });
  assert.equal(back.cpu.a, 0x1111);
  assert.equal(back.cpu.pc, 0x808123);
  assert.equal(back.cpu.e, 0);
  assert.equal(back.cpu.waiting, 1);
  assert.equal(back.cpu.nmi_pending, 1);
  assert.equal(back.spc?.a, 1);
  assert.equal(back.ppu?.forced_blank, 1);
  assert.equal(back.dma?.hdma_channels, 0x80);
  assert.equal(back.dma?.channels[0]?.src_address, 0x4300);
  assert.equal(back.ppu?.layers?.[0]?.tilemap_address, 0x4000);
  assert.equal(back.ppu?.layers?.[0]?.hscroll, 0x12);
  assert.equal(back.dsp_voices?.[0]?.env_volume, 0x7f);
  const fil = reconstructFillram(back);
  assert.equal(fil[0x2100] & 0x80, 0x80);
  assert.equal(fil[0x4200] & 0x80, 0x80);
  assert.equal(fil[0x420c], 0x80);
  assert.equal((back as { mss?: unknown }).mss, undefined);
  assert.ok(!back.sections.some((s) => s.id === 'mesen' || s.id === 'mss'));
});

test('dumpDirToState packs bins without an MSS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhcap-dump-'));
  const wram = new Uint8Array(64);
  wram[3] = 9;
  writeFileSync(join(dir, 'wram.bin'), wram);
  writeFileSync(join(dir, 'cpu.json'), JSON.stringify({ a: 1, x: 2, y: 3, d: 0, db: 0, p: 0, sp: 0x1ff, pc: 0x808000, e: 1 }));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ profile: 'in_level', game_mode: 0x14, pc: 0x808000, frame: 2 }));
  const st = dumpDirToState({ dumpDir: dir, romBuf: makeFixtureRom(), mode: 'manual' });
  assert.equal(st.sections[0].id, 'wram');
  assert.equal(st.sections[0].data[3], 9);
  assert.equal(st.cpu.a, 1);
  assert.equal(st.trigger.frame, 2);
});

test('dumpDirToState parses MSS then deletes the temp file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhcap-mss-'));
  const mss = createEmptyMss('x.sfc');
  const wram = new Uint8Array(0x20000);
  wram[1] = 0xaa;
  mssAdd(mss, 'memoryManager.workRam', wram);
  mssAddU16(mss, 'cpu.a', 7);
  mssAddU16(mss, 'cpu.pc', 0x8000);
  mssAddU8(mss, 'cpu.k', 0x80);
  writeFileSync(join(dir, 'mesen.mss'), encodeMss(mss));
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ game_mode: 0x14, frame: 9 }));
  const st = dumpDirToState({ dumpDir: dir, romBuf: makeFixtureRom(), mode: 'auto' });
  assert.equal(existsSync(join(dir, 'mesen.mss')), false);
  assert.equal(getSectionDecoded(st, 'wram')![1], 0xaa);
  assert.equal(st.cpu.a, 7);
  assert.equal(st.cpu.pc, 0x808000);
  assert.equal(st.host.mode, 'auto');
});

test('apply script restores in a single cpuExec with loadSavestate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhapply-'));
  const luaPath = writeApplyScript(dir, {
    mssPath: join(dir, 'mesen.mss'),
    wramPath: join(dir, 'wram.bin'),
    setStateLua: setStateToLua({ 'cpu.a': 1, 'internalRegisters.enableNmi': true }),
  });
  const lua = readFileSync(luaPath, 'utf8');
  assert.match(lua, /loadSavestate/);
  assert.match(lua, /callbackType\.exec/);
  assert.match(lua, /addMemoryCallback/);
  assert.match(lua, /setState/);
  assert.match(lua, /resetAccessCounters/);
  assert.match(lua, /\["internalRegisters.enableNmi"\] = true/);
  assert.doesNotMatch(lua, /addEventCallback/);
  const execIdx = lua.indexOf('on_exec');
  const loadIdx = lua.indexOf('loadSavestate');
  assert.ok(execIdx >= 0 && loadIdx > execIdx);
});

test('mutations are applied to WRAM before MSS synth', () => {
  const wram = new Uint8Array(0x20000);
  const st = makeState(wram);
  applyMutations(st, { level: 0x105 });
  const raw = getSectionDecoded(st, 'wram')!;
  assert.equal(raw[0x13bf], (0x105 - 0xdc) & 0xff);
  const mss = portableToMss(st, 'akogare.sfc');
  const wr = mssBytes(mss, 'memoryManager.workRam', 0x20000)!;
  assert.equal(wr[0x13bf], raw[0x13bf]);
  const packed = encodePortableAsMss(st, 'akogare.sfc');
  assert.equal(packed.subarray(0, 3).toString('ascii'), 'MSS');
});

test('Mesen NormalizeName matches Serializer.cpp', () => {
  assert.equal(mesenNormalize('_state.A'), 'a');
  assert.equal(mesenNormalize('_state.CycleCount'), 'cycleCount');
  assert.equal(mesenNormalize('_state.Layers[i].TilemapAddress', 0), 'layers[0].tilemapAddress');
  assert.equal(mesenNormalize('_state.Layers[i].HScroll', 1), 'layers[1].hscroll');
  assert.equal(mesenNormalize('_state.Channel[i].SrcAddress', 0), 'channel[0].srcAddress');
  assert.equal(mesenNormalize('_state.Mode7.Matrix[i]', 2), 'mode7.matrix[2]');
  assert.equal(mesenNormalize('_state.Mode7.CenterX'), 'mode7.centerX');
  assert.equal(mesenNormalize('_masterClock'), 'masterClock');
  assert.equal(mesenNormalize('_waiOver'), 'waiOver');
  assert.equal(mesenNormalize('_horizontalLocation'), 'horizontalLocation');
  assert.equal(mesenNormalize('_state.HdmaChannels'), 'hdmaChannels');
  assert.equal(mesenNormalize('_state.Window[i].Left', 0), 'window[0].left');
});

test('setState uses Mesen bools and clock keys', () => {
  const wram = new Uint8Array(0x20000);
  const st = makeState(wram, {
    cpu: { a: 1, x: 0, y: 0, d: 0, db: 0, p: 0, sp: 0x1ff, pc: 0x808000, e: 0, nmi_pending: 1 },
    internal: {
      enable_nmi: 1, enable_v_irq: 0, enable_h_irq: 0, enable_auto_joy: 1,
      h_timer: 0, v_timer: 0, enable_fastrom: 1, io_port: 0xff, wram_port: 0,
      master_clock: 123456,
    },
    ppu: {
      forced_blank: 0, brightness: 0xf, bgmode: 1, mode1_bg3_priority: 1,
      main_screen_layers: 0x17, sub_screen_layers: 0, cgram_address: 0,
      vram_address: 0, vram_increment: 1, vram_remap: 0, vram_inc_on_high: 0,
      vram_read_buffer: 0, mosaic_size: 0, mosaic_enabled: 0, oam_mode: 0,
      oam_base: 0, oam_addr: 0, oam_priority: 0, hi_res: 0, screen_interlace: 0,
      obj_interlace: 0, overscan: 0, direct_color: 0, extbg: 0,
      color_math_enabled: 0, color_math_subtract: 0, color_math_halve: 0,
      color_math_add_sub: 0, color_math_clip: 0, color_math_prevent: 0, fixed_color: 0,
      layers: [{
        tilemap_address: 0x800, chr_address: 0, hscroll: 3, vscroll: 0,
        double_width: 0, double_height: 0, large_tiles: 0,
      }],
    },
  });
  const map = portableToSetState(st);
  assert.equal(map['cpu.emulationMode'], false);
  assert.equal(map['cpu.needNmi'], true);
  assert.equal(map['internalRegisters.enableNmi'], true);
  assert.equal(map['memoryManager.masterClock'], 123456);
  assert.equal(map['ppu.layers[0].tilemapAddress'], 0x800);
  assert.equal(map['ppu.forcedBlank'], false);
  const lua = setStateToLua(map);
  assert.match(lua, /\["cpu.emulationMode"\] = false/);
  assert.match(lua, /\["internalRegisters.enableNmi"\] = true/);
});

test('rhlaunch1-mesen rejects --out (use rhboot1-sfc)', () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'rhlaunch1-mesen.ts');
  const r = spawnSync(process.execPath, ['--import', 'tsx', cli, '--rom', 'a.sfc', '--state', 'b.rhstate1', '--out', 'test.sfc'], {
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /rhboot1-sfc/);
});
