import {
  createEmptyMss,
  encodeMss,
  mssAdd,
  mssAddBool,
  mssAddS16,
  mssAddU8,
  mssAddU16,
  mssAddU32,
  mssBytes,
  mssGet,
  mssU8,
  mssU16,
  mssU32,
  type MssFile,
} from './mss-format.ts';
import { getSectionDecoded } from '../rhstate1/codec.ts';
import {
  emptyDmaChannel,
  normalizeCpu,
  RHSTATE1_VERSION,
  type Cpu5A22,
  type DmaChannel,
  type DmaState,
  type DspVoice,
  type InternalRegs,
  type PpuLayer,
  type PpuState,
  type RhState1,
  type RhState1Section,
  type Spc700,
} from '../rhstate1/types.ts';

const WRAM = 0x20000;
const VRAM = 0x10000;
const CGRAM = 512;
const OAM = 544;
const ARAM = 0x10000;
const DSP = 128;
const FILLRAM = 0x8000;
const SA1_IRAM = 0x800;
const STOP_WAIT = 2;

function pushSec(sections: RhState1Section[], id: RhState1Section['id'], bus: number, data: Uint8Array | null, want?: number): void {
  if (!data) return;
  const copy = want && data.length !== want ? pad(data, want) : data;
  sections.push({ id, bus, encoding: 'raw', data: copy });
}

function pad(src: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n);
  out.set(src.subarray(0, Math.min(src.length, n)));
  return out;
}

function first(mss: MssFile, keys: string[]): Uint8Array | null {
  for (const k of keys) {
    const d = mssGet(mss, k);
    if (d) return d;
  }
  return null;
}

function u8keys(mss: MssFile, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const d = mssGet(mss, k);
    if (d && d.length >= 1) return d[0]!;
  }
  return fallback;
}

function u16keys(mss: MssFile, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const d = mssGet(mss, k);
    if (d && d.length >= 2) return d[0]! | (d[1]! << 8);
  }
  return fallback;
}

function readCpu(mss: MssFile, prefix: string): Cpu5A22 {
  const pc16 = u16keys(mss, [`${prefix}pc`]);
  const k = u8keys(mss, [`${prefix}k`]);
  const stop = u8keys(mss, [`${prefix}stopState`]);
  return normalizeCpu({
    a: u16keys(mss, [`${prefix}a`]),
    x: u16keys(mss, [`${prefix}x`]),
    y: u16keys(mss, [`${prefix}y`]),
    d: u16keys(mss, [`${prefix}d`]),
    db: u8keys(mss, [`${prefix}dbr`, `${prefix}db`]),
    p: u8keys(mss, [`${prefix}ps`, `${prefix}p`]),
    sp: u16keys(mss, [`${prefix}sp`]),
    pc: ((k & 0xff) << 16) | pc16,
    e: u8keys(mss, [`${prefix}emulationMode`, `${prefix}e`], 1),
    waiting: stop === STOP_WAIT ? 1 : 0,
    nmi_pending: u8keys(mss, [`${prefix}needNmi`]),
    irq_pending: u8keys(mss, [`${prefix}irqSource`]) ? 1 : 0,
  });
}

function writeCpu(mss: MssFile, prefix: string, cpu: Cpu5A22): void {
  mssAddU16(mss, `${prefix}a`, cpu.a);
  mssAddU16(mss, `${prefix}x`, cpu.x);
  mssAddU16(mss, `${prefix}y`, cpu.y);
  mssAddU16(mss, `${prefix}d`, cpu.d);
  mssAddU8(mss, `${prefix}dbr`, cpu.db);
  mssAddU8(mss, `${prefix}ps`, cpu.p);
  mssAddU16(mss, `${prefix}sp`, cpu.sp);
  mssAddU16(mss, `${prefix}pc`, cpu.pc & 0xffff);
  mssAddU8(mss, `${prefix}k`, (cpu.pc >>> 16) & 0xff);
  mssAddBool(mss, `${prefix}emulationMode`, cpu.e);
  mssAddU8(mss, `${prefix}stopState`, cpu.waiting ? STOP_WAIT : 0);
  mssAddBool(mss, `${prefix}needNmi`, cpu.nmi_pending ?? 0);
  mssAddU8(mss, `${prefix}irqSource`, cpu.irq_pending ? 1 : 0);
}

function readPpu(mss: MssFile): PpuState {
  const layers: PpuLayer[] = [];
  for (let i = 0; i < 4; i += 1) {
    layers.push({
      tilemap_address: mssU16(mss, `ppu.layers[${i}].TilemapAddress`),
      chr_address: mssU16(mss, `ppu.layers[${i}].ChrAddress`),
      hscroll: mssU16(mss, `ppu.layers[${i}].HScroll`),
      vscroll: mssU16(mss, `ppu.layers[${i}].VScroll`),
      double_width: mssU8(mss, `ppu.layers[${i}].DoubleWidth`),
      double_height: mssU8(mss, `ppu.layers[${i}].DoubleHeight`),
      large_tiles: mssU8(mss, `ppu.layers[${i}].LargeTiles`),
    });
  }
  const matrix = [
    mssU16(mss, 'ppu.mode7.Matrix[0]'),
    mssU16(mss, 'ppu.mode7.Matrix[1]'),
    mssU16(mss, 'ppu.mode7.Matrix[2]'),
    mssU16(mss, 'ppu.mode7.Matrix[3]'),
  ];
  return {
    forced_blank: mssU8(mss, 'ppu.forcedBlank'),
    brightness: mssU8(mss, 'ppu.screenBrightness'),
    bgmode: mssU8(mss, 'ppu.bgMode'),
    mode1_bg3_priority: mssU8(mss, 'ppu.mode1Bg3Priority'),
    main_screen_layers: mssU8(mss, 'ppu.mainScreenLayers'),
    sub_screen_layers: mssU8(mss, 'ppu.subScreenLayers'),
    cgram_address: mssU16(mss, 'ppu.cgramAddress'),
    vram_address: mssU16(mss, 'ppu.vramAddress'),
    vram_increment: mssU8(mss, 'ppu.vramIncrementValue'),
    vram_remap: mssU8(mss, 'ppu.vramAddressRemapping'),
    vram_inc_on_high: mssU8(mss, 'ppu.vramAddrIncrementOnSecondReg'),
    vram_read_buffer: mssU16(mss, 'ppu.vramReadBuffer'),
    mosaic_size: mssU8(mss, 'ppu.mosaicSize'),
    mosaic_enabled: mssU8(mss, 'ppu.mosaicEnabled'),
    oam_mode: mssU8(mss, 'ppu.oamMode'),
    oam_base: mssU16(mss, 'ppu.oamBaseAddress'),
    oam_addr: mssU16(mss, 'ppu.oamRamAddress'),
    oam_priority: mssU8(mss, 'ppu.enableOamPriority'),
    hi_res: mssU8(mss, 'ppu.hiResMode'),
    screen_interlace: mssU8(mss, 'ppu.screenInterlace'),
    obj_interlace: mssU8(mss, 'ppu.objInterlace'),
    overscan: mssU8(mss, 'ppu.overscanMode'),
    direct_color: mssU8(mss, 'ppu.directColorMode'),
    extbg: mssU8(mss, 'ppu.extBgEnabled'),
    color_math_enabled: mssU8(mss, 'ppu.colorMathEnabled'),
    color_math_subtract: mssU8(mss, 'ppu.colorMathSubtractMode'),
    color_math_halve: mssU8(mss, 'ppu.colorMathHalveResult'),
    color_math_add_sub: mssU8(mss, 'ppu.colorMathAddSubscreen'),
    color_math_clip: mssU8(mss, 'ppu.colorMathClipMode'),
    color_math_prevent: mssU8(mss, 'ppu.colorMathPreventMode'),
    fixed_color: mssU16(mss, 'ppu.fixedColor'),
    layers,
    mode7_matrix: matrix,
    mode7_center_x: mssU16(mss, 'ppu.mode7.CenterX'),
    mode7_center_y: mssU16(mss, 'ppu.mode7.CenterY'),
    mode7_hscroll: mssU16(mss, 'ppu.mode7.HScroll'),
    mode7_vscroll: mssU16(mss, 'ppu.mode7.VScroll'),
    mode7_hflip: mssU8(mss, 'ppu.mode7.HorizontalMirroring'),
    mode7_vflip: mssU8(mss, 'ppu.mode7.VerticalMirroring'),
    mode7_fill0: mssU8(mss, 'ppu.mode7.FillWithTile0'),
    mode7_large: mssU8(mss, 'ppu.mode7.LargeMap'),
    window0_left: mssU8(mss, 'ppu.window[0].Left'),
    window0_right: mssU8(mss, 'ppu.window[0].Right'),
    window1_left: mssU8(mss, 'ppu.window[1].Left'),
    window1_right: mssU8(mss, 'ppu.window[1].Right'),
  };
}

function writePpu(mss: MssFile, ppu: PpuState): void {
  mssAddBool(mss, 'ppu.forcedBlank', ppu.forced_blank);
  mssAddU8(mss, 'ppu.screenBrightness', ppu.brightness);
  mssAddU8(mss, 'ppu.bgMode', ppu.bgmode);
  mssAddBool(mss, 'ppu.mode1Bg3Priority', ppu.mode1_bg3_priority);
  mssAddU8(mss, 'ppu.mainScreenLayers', ppu.main_screen_layers);
  mssAddU8(mss, 'ppu.subScreenLayers', ppu.sub_screen_layers);
  mssAddU16(mss, 'ppu.cgramAddress', ppu.cgram_address);
  mssAddU16(mss, 'ppu.vramAddress', ppu.vram_address);
  mssAddU8(mss, 'ppu.vramIncrementValue', ppu.vram_increment);
  mssAddU8(mss, 'ppu.vramAddressRemapping', ppu.vram_remap);
  mssAddBool(mss, 'ppu.vramAddrIncrementOnSecondReg', ppu.vram_inc_on_high);
  mssAddU16(mss, 'ppu.vramReadBuffer', ppu.vram_read_buffer);
  mssAddU8(mss, 'ppu.mosaicSize', ppu.mosaic_size);
  mssAddU8(mss, 'ppu.mosaicEnabled', ppu.mosaic_enabled);
  mssAddU8(mss, 'ppu.oamMode', ppu.oam_mode);
  mssAddU16(mss, 'ppu.oamBaseAddress', ppu.oam_base);
  mssAddU16(mss, 'ppu.oamRamAddress', ppu.oam_addr);
  mssAddBool(mss, 'ppu.enableOamPriority', ppu.oam_priority);
  mssAddBool(mss, 'ppu.hiResMode', ppu.hi_res);
  mssAddBool(mss, 'ppu.screenInterlace', ppu.screen_interlace);
  mssAddBool(mss, 'ppu.objInterlace', ppu.obj_interlace);
  mssAddBool(mss, 'ppu.overscanMode', ppu.overscan);
  mssAddBool(mss, 'ppu.directColorMode', ppu.direct_color);
  mssAddBool(mss, 'ppu.extBgEnabled', ppu.extbg);
  mssAddU8(mss, 'ppu.colorMathEnabled', ppu.color_math_enabled);
  mssAddBool(mss, 'ppu.colorMathSubtractMode', ppu.color_math_subtract);
  mssAddBool(mss, 'ppu.colorMathHalveResult', ppu.color_math_halve);
  mssAddBool(mss, 'ppu.colorMathAddSubscreen', ppu.color_math_add_sub);
  mssAddU8(mss, 'ppu.colorMathClipMode', ppu.color_math_clip);
  mssAddU8(mss, 'ppu.colorMathPreventMode', ppu.color_math_prevent);
  mssAddU16(mss, 'ppu.fixedColor', ppu.fixed_color);
  const layers = ppu.layers ?? [];
  for (let i = 0; i < 4; i += 1) {
    const L = layers[i] ?? {
      tilemap_address: 0, chr_address: 0, hscroll: 0, vscroll: 0,
      double_width: 0, double_height: 0, large_tiles: 0,
    };
    mssAddU16(mss, `ppu.layers[${i}].TilemapAddress`, L.tilemap_address);
    mssAddU16(mss, `ppu.layers[${i}].ChrAddress`, L.chr_address);
    mssAddU16(mss, `ppu.layers[${i}].HScroll`, L.hscroll);
    mssAddU16(mss, `ppu.layers[${i}].VScroll`, L.vscroll);
    mssAddBool(mss, `ppu.layers[${i}].DoubleWidth`, L.double_width);
    mssAddBool(mss, `ppu.layers[${i}].DoubleHeight`, L.double_height);
    mssAddBool(mss, `ppu.layers[${i}].LargeTiles`, L.large_tiles);
  }
  const m = ppu.mode7_matrix ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) mssAddS16(mss, `ppu.mode7.Matrix[${i}]`, m[i] ?? 0);
  mssAddU16(mss, 'ppu.mode7.CenterX', ppu.mode7_center_x ?? 0);
  mssAddU16(mss, 'ppu.mode7.CenterY', ppu.mode7_center_y ?? 0);
  mssAddU16(mss, 'ppu.mode7.HScroll', ppu.mode7_hscroll ?? 0);
  mssAddU16(mss, 'ppu.mode7.VScroll', ppu.mode7_vscroll ?? 0);
  mssAddBool(mss, 'ppu.mode7.HorizontalMirroring', ppu.mode7_hflip ?? 0);
  mssAddBool(mss, 'ppu.mode7.VerticalMirroring', ppu.mode7_vflip ?? 0);
  mssAddBool(mss, 'ppu.mode7.FillWithTile0', ppu.mode7_fill0 ?? 0);
  mssAddBool(mss, 'ppu.mode7.LargeMap', ppu.mode7_large ?? 0);
  mssAddU8(mss, 'ppu.window[0].Left', ppu.window0_left ?? 0);
  mssAddU8(mss, 'ppu.window[0].Right', ppu.window0_right ?? 0);
  mssAddU8(mss, 'ppu.window[1].Left', ppu.window1_left ?? 0);
  mssAddU8(mss, 'ppu.window[1].Right', ppu.window1_right ?? 0);
}

function readDma(mss: MssFile): DmaState {
  const channels: DmaChannel[] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = `dmaController.channel[${i}].`;
    channels.push({
      invert_direction: mssU8(mss, `${p}InvertDirection`),
      hdma_indirect: mssU8(mss, `${p}HdmaIndirectAddressing`),
      unused_43x0: mssU8(mss, `${p}UnusedControlFlag`),
      fixed_transfer: mssU8(mss, `${p}FixedTransfer`),
      decrement: mssU8(mss, `${p}Decrement`),
      transfer_mode: mssU8(mss, `${p}TransferMode`),
      dest: mssU8(mss, `${p}DestAddress`),
      src_address: mssU16(mss, `${p}SrcAddress`),
      src_bank: mssU8(mss, `${p}SrcBank`),
      transfer_size: mssU16(mss, `${p}TransferSize`),
      hdma_bank: mssU8(mss, `${p}HdmaBank`),
      hdma_table: mssU16(mss, `${p}HdmaTableAddress`),
      hdma_line: mssU8(mss, `${p}HdmaLineCounterAndRepeat`),
      do_transfer: mssU8(mss, `${p}DoTransfer`),
    });
  }
  return { hdma_channels: mssU8(mss, 'dmaController.hdmaChannels'), channels };
}

function writeDma(mss: MssFile, dma: DmaState): void {
  mssAddU8(mss, 'dmaController.hdmaChannels', dma.hdma_channels);
  for (let i = 0; i < 8; i += 1) {
    const ch = dma.channels[i] ?? emptyDmaChannel();
    const p = `dmaController.channel[${i}].`;
    mssAddBool(mss, `${p}InvertDirection`, ch.invert_direction);
    mssAddBool(mss, `${p}HdmaIndirectAddressing`, ch.hdma_indirect);
    mssAddBool(mss, `${p}UnusedControlFlag`, ch.unused_43x0);
    mssAddBool(mss, `${p}FixedTransfer`, ch.fixed_transfer);
    mssAddBool(mss, `${p}Decrement`, ch.decrement);
    mssAddU8(mss, `${p}TransferMode`, ch.transfer_mode);
    mssAddU8(mss, `${p}DestAddress`, ch.dest);
    mssAddU16(mss, `${p}SrcAddress`, ch.src_address);
    mssAddU8(mss, `${p}SrcBank`, ch.src_bank);
    mssAddU16(mss, `${p}TransferSize`, ch.transfer_size);
    mssAddU8(mss, `${p}HdmaBank`, ch.hdma_bank);
    mssAddU16(mss, `${p}HdmaTableAddress`, ch.hdma_table);
    mssAddU8(mss, `${p}HdmaLineCounterAndRepeat`, ch.hdma_line);
    mssAddBool(mss, `${p}DoTransfer`, ch.do_transfer);
  }
}

function readInternal(mss: MssFile): InternalRegs {
  return {
    enable_nmi: mssU8(mss, 'internalRegisters.enableNmi'),
    enable_v_irq: mssU8(mss, 'internalRegisters.enableVerticalIrq'),
    enable_h_irq: mssU8(mss, 'internalRegisters.enableHorizontalIrq'),
    enable_auto_joy: mssU8(mss, 'internalRegisters.enableAutoJoypadRead'),
    h_timer: mssU16(mss, 'internalRegisters.horizontalTimer'),
    v_timer: mssU16(mss, 'internalRegisters.verticalTimer'),
    enable_fastrom: mssU8(mss, 'internalRegisters.enableFastRom'),
    io_port: mssU8(mss, 'internalRegisters.ioPortOutput'),
    wram_port: mssU32(mss, 'memoryManager.registerHandlerB.wramPosition'),
    nmi_flag: mssU8(mss, 'internalRegisters.nmiFlag'),
    irq_flag: mssU8(mss, 'internalRegisters.irqFlag'),
    mul_a: mssU8(mss, 'internalRegisters.aluMulDiv.multOperand1'),
    mul_b: mssU8(mss, 'internalRegisters.aluMulDiv.multOperand2'),
    dividend: mssU16(mss, 'internalRegisters.aluMulDiv.dividend'),
    divisor: mssU8(mss, 'internalRegisters.aluMulDiv.divisor'),
  };
}

function writeInternal(mss: MssFile, ir: InternalRegs): void {
  mssAddBool(mss, 'internalRegisters.enableNmi', ir.enable_nmi);
  mssAddBool(mss, 'internalRegisters.enableVerticalIrq', ir.enable_v_irq);
  mssAddBool(mss, 'internalRegisters.enableHorizontalIrq', ir.enable_h_irq);
  mssAddBool(mss, 'internalRegisters.enableAutoJoypadRead', ir.enable_auto_joy);
  mssAddU16(mss, 'internalRegisters.horizontalTimer', ir.h_timer);
  mssAddU16(mss, 'internalRegisters.verticalTimer', ir.v_timer);
  mssAddBool(mss, 'internalRegisters.enableFastRom', ir.enable_fastrom);
  mssAddU8(mss, 'internalRegisters.ioPortOutput', ir.io_port);
  mssAddU32(mss, 'memoryManager.registerHandlerB.wramPosition', ir.wram_port);
  if (ir.nmi_flag != null) mssAddBool(mss, 'internalRegisters.nmiFlag', ir.nmi_flag);
  if (ir.irq_flag != null) mssAddBool(mss, 'internalRegisters.irqFlag', ir.irq_flag);
  if (ir.mul_a != null) mssAddU8(mss, 'internalRegisters.aluMulDiv.multOperand1', ir.mul_a);
  if (ir.mul_b != null) mssAddU8(mss, 'internalRegisters.aluMulDiv.multOperand2', ir.mul_b);
  if (ir.dividend != null) mssAddU16(mss, 'internalRegisters.aluMulDiv.dividend', ir.dividend);
  if (ir.divisor != null) mssAddU8(mss, 'internalRegisters.aluMulDiv.divisor', ir.divisor);
}

function readSpc(mss: MssFile): Spc700 {
  return {
    a: mssU8(mss, 'spc.a'),
    x: mssU8(mss, 'spc.x'),
    y: mssU8(mss, 'spc.y'),
    psw: mssU8(mss, 'spc.ps'),
    sp: mssU8(mss, 'spc.sp'),
    pc: mssU16(mss, 'spc.pc'),
    dsp_reg: mssU8(mss, 'spc.dspReg'),
    rom_enabled: mssU8(mss, 'spc.romEnabled'),
    timers_enabled: mssU8(mss, 'spc.timersEnabled'),
    cpu_regs: [0, 1, 2, 3].map((i) => mssU8(mss, `spc.cpuRegs[${i}]`)),
    output_reg: [0, 1, 2, 3].map((i) => mssU8(mss, `spc.outputReg[${i}]`)),
  };
}

function writeSpc(mss: MssFile, spc: Spc700): void {
  mssAddU8(mss, 'spc.a', spc.a);
  mssAddU8(mss, 'spc.x', spc.x);
  mssAddU8(mss, 'spc.y', spc.y);
  mssAddU8(mss, 'spc.ps', spc.psw);
  mssAddU8(mss, 'spc.sp', spc.sp);
  mssAddU16(mss, 'spc.pc', spc.pc);
  if (spc.dsp_reg != null) mssAddU8(mss, 'spc.dspReg', spc.dsp_reg);
  if (spc.rom_enabled != null) mssAddBool(mss, 'spc.romEnabled', spc.rom_enabled);
  if (spc.timers_enabled != null) mssAddBool(mss, 'spc.timersEnabled', spc.timers_enabled);
  (spc.cpu_regs ?? []).forEach((v, i) => mssAddU8(mss, `spc.cpuRegs[${i}]`, v));
  (spc.output_reg ?? []).forEach((v, i) => mssAddU8(mss, `spc.outputReg[${i}]`, v));
}

function readVoices(mss: MssFile): DspVoice[] | undefined {
  if (!mssGet(mss, 'spc.dsp.voices[0].envVolume') && !mssGet(mss, 'spc.dsp.voices[0].envOut')) {
    return undefined;
  }
  const voices: DspVoice[] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = `spc.dsp.voices[${i}].`;
    voices.push({
      env_volume: mssU16(mss, `${p}envVolume`),
      prev_calculated_env: mssU16(mss, `${p}prevCalculatedEnv`),
      interpolation_pos: mssU16(mss, `${p}interpolationPos`),
      env_mode: mssU8(mss, `${p}envMode`),
      brr_address: mssU16(mss, `${p}brrAddress`),
      brr_offset: mssU8(mss, `${p}brrOffset`),
      voice_bit: mssU8(mss, `${p}voiceBit`),
      key_on_delay: mssU8(mss, `${p}keyOnDelay`),
      env_out: mssU16(mss, `${p}envOut`),
      buffer_pos: mssU8(mss, `${p}bufferPos`),
      sample_buffer: mssBytes(mss, `${p}sampleBuffer`, 12) ?? undefined,
    });
  }
  return voices;
}

function writeVoices(mss: MssFile, voices: DspVoice[]): void {
  for (let i = 0; i < Math.min(8, voices.length); i += 1) {
    const v = voices[i]!;
    const p = `spc.dsp.voices[${i}].`;
    mssAddU16(mss, `${p}envVolume`, v.env_volume);
    mssAddU16(mss, `${p}prevCalculatedEnv`, v.prev_calculated_env);
    mssAddU16(mss, `${p}interpolationPos`, v.interpolation_pos);
    mssAddU8(mss, `${p}envMode`, v.env_mode);
    mssAddU16(mss, `${p}brrAddress`, v.brr_address);
    mssAddU8(mss, `${p}brrOffset`, v.brr_offset);
    mssAddU8(mss, `${p}voiceBit`, v.voice_bit);
    mssAddU8(mss, `${p}keyOnDelay`, v.key_on_delay);
    mssAddU16(mss, `${p}envOut`, v.env_out);
    mssAddU8(mss, `${p}bufferPos`, v.buffer_pos);
    if (v.sample_buffer) mssAdd(mss, `${p}sampleBuffer`, v.sample_buffer);
  }
}

/** Reconstruct 32KiB FillRAM ($00:0000–$00:7FFF) from WRAM + decoded MMIO maps. */
export function reconstructFillram(state: RhState1): Uint8Array {
  const fil = new Uint8Array(FILLRAM);
  const wram = getSectionDecoded(state, 'wram');
  if (wram) fil.set(wram.subarray(0, Math.min(0x2000, wram.length)));
  const existing = getSectionDecoded(state, 'fillram');
  if (existing) {
    fil.set(existing.subarray(0, Math.min(FILLRAM, existing.length)));
  }
  const ppu = state.ppu;
  if (ppu) {
    fil[0x2100] = ((ppu.forced_blank ? 0x80 : 0) | (ppu.brightness & 0x0f)) & 0xff;
    fil[0x2101] = ppu.oam_mode & 0xff;
    fil[0x2102] = ppu.oam_addr & 0xff;
    fil[0x2103] = ((ppu.oam_addr >> 8) & 0x01) | (ppu.oam_priority ? 0x80 : 0);
    const layers = ppu.layers ?? [];
    let bgmode = ppu.bgmode & 0x07;
    if (ppu.mode1_bg3_priority) bgmode |= 0x08;
    for (let i = 0; i < 4; i += 1) {
      if (layers[i]?.large_tiles) bgmode |= 0x10 << i;
    }
    fil[0x2105] = bgmode;
    fil[0x2106] = ((ppu.mosaic_size & 0x0f) << 4) | (ppu.mosaic_enabled & 0x0f);
    for (let i = 0; i < 4; i += 1) {
      const L = layers[i];
      if (!L) continue;
      const sc = (L.tilemap_address >> 8) & 0xfc;
      fil[0x2107 + i] = sc | (L.double_width ? 1 : 0) | (L.double_height ? 2 : 0);
    }
    const nba01 = ((layers[0]?.chr_address ?? 0) >> 12) | (((layers[1]?.chr_address ?? 0) >> 8) & 0xf0);
    const nba23 = ((layers[2]?.chr_address ?? 0) >> 12) | (((layers[3]?.chr_address ?? 0) >> 8) & 0xf0);
    fil[0x210b] = nba01 & 0xff;
    fil[0x210c] = nba23 & 0xff;
    fil[0x2115] = (ppu.vram_inc_on_high ? 0x80 : 0) | ((ppu.vram_remap & 3) << 2) | (ppu.vram_increment === 32 ? 1 : ppu.vram_increment === 128 ? 2 : 0);
    fil[0x2116] = ppu.vram_address & 0xff;
    fil[0x2117] = (ppu.vram_address >> 8) & 0xff;
    fil[0x212c] = ppu.main_screen_layers & 0xff;
    fil[0x212d] = ppu.sub_screen_layers & 0xff;
    fil[0x2132] = ppu.fixed_color & 0xff;
  }
  const ir = state.internal;
  if (ir) {
    fil[0x4200] = (ir.enable_nmi ? 0x80 : 0) | (ir.enable_v_irq ? 0x20 : 0) | (ir.enable_h_irq ? 0x10 : 0) | (ir.enable_auto_joy ? 1 : 0);
    fil[0x4201] = ir.io_port & 0xff;
    fil[0x4207] = ir.h_timer & 0xff;
    fil[0x4208] = (ir.h_timer >> 8) & 0xff;
    fil[0x4209] = ir.v_timer & 0xff;
    fil[0x420a] = (ir.v_timer >> 8) & 0xff;
    fil[0x420d] = ir.enable_fastrom ? 1 : 0;
    fil[0x2181] = ir.wram_port & 0xff;
    fil[0x2182] = (ir.wram_port >> 8) & 0xff;
    fil[0x2183] = (ir.wram_port >> 16) & 0x01;
  }
  const dma = state.dma;
  if (dma) {
    fil[0x420c] = dma.hdma_channels & 0xff;
    for (let i = 0; i < 8; i += 1) {
      const ch = dma.channels[i] ?? emptyDmaChannel();
      const b = 0x4300 + i * 16;
      fil[b] = ((ch.invert_direction ? 0x80 : 0)
        | (ch.hdma_indirect ? 0x40 : 0)
        | (ch.unused_43x0 ? 0x20 : 0)
        | (ch.fixed_transfer ? 0x10 : 0)
        | (ch.decrement ? 0x08 : 0)
        | (ch.transfer_mode & 7)) & 0xff;
      fil[b + 1] = ch.dest & 0xff;
      fil[b + 2] = ch.src_address & 0xff;
      fil[b + 3] = (ch.src_address >> 8) & 0xff;
      fil[b + 4] = ch.src_bank & 0xff;
      fil[b + 5] = ch.transfer_size & 0xff;
      fil[b + 6] = (ch.transfer_size >> 8) & 0xff;
      fil[b + 7] = ch.hdma_bank & 0xff;
      fil[b + 8] = ch.hdma_table & 0xff;
      fil[b + 9] = (ch.hdma_table >> 8) & 0xff;
      fil[b + 10] = ch.hdma_line & 0xff;
    }
  }
  return fil;
}

export interface MssToPortableOpts {
  rom: RhState1['rom'];
  host: RhState1['host'];
  profile?: RhState1['profile'];
  trigger?: Partial<RhState1['trigger']>;
}

export function mssToPortable(mss: MssFile, opts: MssToPortableOpts): RhState1 {
  const sections: RhState1Section[] = [];
  const wram = mssBytes(mss, 'memoryManager.workRam', WRAM);
  const vram = first(mss, ['ppu.vram']) ?? null;
  const cgram = first(mss, ['ppu.cgram']) ?? null;
  const oam = first(mss, ['ppu.oamRam']) ?? null;
  const sram = first(mss, ['cart.saveRam']) ?? null;
  const aram = first(mss, ['spc.ram']) ?? null;
  const dsp = first(mss, ['spc.dsp.regs']) ?? null;
  const sa1Iram = first(mss, ['cart.coprocessor.iRam', 'cart.sa1.iRam']) ?? null;
  const gsuWram = first(mss, ['cart.coprocessor.gsuRam', 'cart.gsu.gsuRam']) ?? null;
  const cx4 = first(mss, ['cart.coprocessor.dataRam', 'cart.cx4.dataRam']) ?? null;
  const dspData = first(mss, ['cart.coprocessor.ram', 'cart.necDsp.ram']) ?? null;
  const st018 = first(mss, ['cart.coprocessor.workRam']) ?? null;

  pushSec(sections, 'wram', 0x7e0000, wram, WRAM);
  pushSec(sections, 'vram', 0, vram ? (vram.length === VRAM ? vram : pad(vram, VRAM)) : null);
  pushSec(sections, 'cgram', 0, cgram ? pad(cgram, CGRAM) : null);
  pushSec(sections, 'oam', 0, oam ? pad(oam, OAM) : null);
  if (sram && sram.length) pushSec(sections, 'sram', 0, sram);
  pushSec(sections, 'spc_aram', 0, aram, ARAM);
  pushSec(sections, 'dsp', 0, dsp, DSP);
  if (sa1Iram) pushSec(sections, 'sa1_iram', 0, sa1Iram, SA1_IRAM);
  if (gsuWram) pushSec(sections, 'gsu_wram', 0, gsuWram);
  if (cx4) pushSec(sections, 'cx4_data', 0, cx4);
  if (dspData) pushSec(sections, 'dsp_data', 0, dspData);
  if (st018) pushSec(sections, 'st018_wram', 0, st018);

  const cpu = readCpu(mss, 'cpu.');
  const ppu = readPpu(mss);
  const dma = readDma(mss);
  const internal = readInternal(mss);
  const spc = readSpc(mss);
  const dsp_voices = readVoices(mss);
  const sa1CpuBlob = mssGet(mss, 'cart.coprocessor.cpu.a') || mssGet(mss, 'cart.sa1.cpu.a');
  const sa1 = sa1CpuBlob
    ? { cpu: readCpu(mss, mssGet(mss, 'cart.sa1.cpu.a') ? 'cart.sa1.cpu.' : 'cart.coprocessor.cpu.') }
    : undefined;

  const scanline = mssU16(mss, 'ppu.scanline');
  const hclock = mssU16(mss, 'memoryManager.hClock');

  const state: RhState1 = {
    v: RHSTATE1_VERSION,
    profile: opts.profile || 'in_level',
    rom: opts.rom,
    host: opts.host,
    cpu,
    trigger: {
      game_mode: opts.trigger?.game_mode ?? 0x14,
      pc: opts.trigger?.pc ?? cpu.pc,
      frame: opts.trigger?.frame ?? mssU32(mss, 'ppu.frameCount'),
      scanline,
      hclock,
      region: opts.trigger?.region,
    },
    sections,
    spc,
    ppu,
    dma,
    internal,
    sa1,
    dsp_voices,
  };
  pushSec(sections, 'fillram', 0, reconstructFillram(state), FILLRAM);
  return state;
}

export function portableToMss(state: RhState1, romName: string): MssFile {
  const mss = createEmptyMss(romName);
  writeCpu(mss, 'cpu.', state.cpu);
  if (state.ppu) writePpu(mss, state.ppu);
  if (state.dma) writeDma(mss, state.dma);
  if (state.internal) writeInternal(mss, state.internal);
  if (state.spc) writeSpc(mss, state.spc);
  if (state.dsp_voices) writeVoices(mss, state.dsp_voices);
  if (state.sa1) writeCpu(mss, 'cart.coprocessor.cpu.', state.sa1.cpu);

  const addSec = (id: string, key: string): void => {
    const data = getSectionDecoded(state, id);
    if (data) mssAdd(mss, key, data);
  };
  addSec('wram', 'memoryManager.workRam');
  addSec('vram', 'ppu.vram');
  addSec('cgram', 'ppu.cgram');
  addSec('oam', 'ppu.oamRam');
  addSec('sram', 'cart.saveRam');
  addSec('spc_aram', 'spc.ram');
  addSec('dsp', 'spc.dsp.regs');
  addSec('sa1_iram', 'cart.coprocessor.iRam');
  addSec('gsu_wram', 'cart.coprocessor.gsuRam');
  addSec('cx4_data', 'cart.coprocessor.dataRam');
  addSec('dsp_data', 'cart.coprocessor.ram');
  addSec('st018_wram', 'cart.coprocessor.workRam');

  if (state.dma) mssAddU8(mss, 'dmaController.hdmaChannels', state.dma.hdma_channels);
  if (state.trigger.scanline != null) mssAddU16(mss, 'ppu.scanline', state.trigger.scanline);
  return mss;
}

export function encodePortableAsMss(state: RhState1, romName: string): Buffer {
  return encodeMss(portableToMss(state, romName));
}

/** Apply Mesen getState scalar keys (fallback when no .mss). Unknown keys ignored. */
export function applyMesenScalarKeys(state: RhState1, keys: Record<string, number>): void {
  const n = (k: string, d = 0) => Number(keys[k]) || d;
  if (keys['cpu.a'] != null || keys['cpu.pc'] != null) {
    const pc16 = n('cpu.pc');
    const k = n('cpu.k');
    state.cpu = normalizeCpu({
      a: n('cpu.a'),
      x: n('cpu.x'),
      y: n('cpu.y'),
      d: n('cpu.d'),
      db: n('cpu.dbr', n('cpu.db')),
      p: n('cpu.ps', n('cpu.p')),
      sp: n('cpu.sp'),
      pc: k ? ((k & 0xff) << 16) | (pc16 & 0xffff) : n('cpu.pc'),
      e: n('cpu.emulationMode', 1),
      waiting: n('cpu.stopState') === STOP_WAIT ? 1 : 0,
      nmi_pending: n('cpu.needNmi'),
      irq_pending: n('cpu.irqSource') ? 1 : 0,
    });
  }
}
