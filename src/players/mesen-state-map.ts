import {
  createEmptyMss,
  encodeMss,
  mssAdd,
  mssAddBool,
  mssAddI32,
  mssAddS16,
  mssAddU8,
  mssAddU16,
  mssAddU32,
  mssAddU64,
  mssAddF64,
  mssBytes,
  mssGet,
  mssI32,
  mssU8,
  mssU16,
  mssU32,
  mssU64,
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
  type DspMixer,
  type DspVoice,
  type InternalRegs,
  type PpuLayer,
  type PpuState,
  type RhState1,
  type RhState1Section,
  type Spc700,
  type SpcTimer,
} from '../rhstate1/types.ts';

const WRAM = 0x20000;
const VRAM = 0x10000;
const CGRAM = 512;
const OAM = 544;
const ARAM = 0x10000;
const DSP = 128;
const DSP_SAMPLE_BUF = 24;
const DSP_ECHO_HIST = 32;
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

function u64keys(mss: MssFile, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const n = mssU64(mss, k, -1);
    if (n >= 0 && mssGet(mss, k)) return n;
  }
  return fallback;
}

const NTSC_FRAME_CYCLES = 357368;
/** Mesen NTSC master clock and default SPC sample-rate tweak (32040 Hz). */
const NTSC_MASTER_CLOCK_RATE = 21477272;
const MESEN_SPC_SAMPLE_RATE = 32040;

function defaultMasterClock(state: RhState1): number {
  const have = state.internal?.master_clock;
  if (have != null && have >= 1000) return have;
  const frame = Number(state.trigger.frame) || 1;
  return Math.max(10_000, frame * NTSC_FRAME_CYCLES);
}

/** `Spc::Run` needs cycle < master*ratio-1; UpdateClockRatio resnaps if |delta|>20. */
function spcCycleJustBehind(master: number): number {
  const ratio = (MESEN_SPC_SAMPLE_RATE * 64) / NTSC_MASTER_CLOCK_RATE;
  return Math.max(0, Math.floor(master * ratio) - 8);
}

function readCpu(mss: MssFile, prefix: string): Cpu5A22 {
  const pc16 = u16keys(mss, [`${prefix}pc`]);
  const k = u8keys(mss, [`${prefix}k`]);
  const stop = u8keys(mss, [`${prefix}stopState`]);
  const cycle = u64keys(mss, [`${prefix}cycleCount`]);
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
    cycle_count: cycle || undefined,
    nmi_flag_counter: u8keys(mss, [`${prefix}nmiFlagCounter`]),
    irq_lock: u8keys(mss, [`${prefix}irqLock`]),
    wai_over: u8keys(mss, [`${prefix}waiOver`]),
    prev_irq: u8keys(mss, [`${prefix}prevIrqSource`]),
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
  mssAddU64(mss, `${prefix}cycleCount`, cpu.cycle_count ?? 0);
  if (cpu.nmi_flag_counter != null) mssAddU8(mss, `${prefix}nmiFlagCounter`, cpu.nmi_flag_counter);
  if (cpu.irq_lock != null) mssAddBool(mss, `${prefix}irqLock`, cpu.irq_lock);
  if (cpu.wai_over != null) mssAddBool(mss, `${prefix}waiOver`, cpu.wai_over);
  if (cpu.prev_irq != null) mssAddU8(mss, `${prefix}prevIrqSource`, cpu.prev_irq);
}

function readPpu(mss: MssFile): PpuState {
  const layers: PpuLayer[] = [];
  for (let i = 0; i < 4; i += 1) {
    const p = `ppu.layers[${i}].`;
    layers.push({
      tilemap_address: u16keys(mss, [`${p}tilemapAddress`, `${p}TilemapAddress`]),
      chr_address: u16keys(mss, [`${p}chrAddress`, `${p}ChrAddress`]),
      hscroll: u16keys(mss, [`${p}hscroll`, `${p}HScroll`]),
      vscroll: u16keys(mss, [`${p}vscroll`, `${p}VScroll`]),
      double_width: u8keys(mss, [`${p}doubleWidth`, `${p}DoubleWidth`]),
      double_height: u8keys(mss, [`${p}doubleHeight`, `${p}DoubleHeight`]),
      large_tiles: u8keys(mss, [`${p}largeTiles`, `${p}LargeTiles`]),
    });
  }
  const matrix = [
    u16keys(mss, ['ppu.mode7.matrix[0]', 'ppu.mode7.Matrix[0]']),
    u16keys(mss, ['ppu.mode7.matrix[1]', 'ppu.mode7.Matrix[1]']),
    u16keys(mss, ['ppu.mode7.matrix[2]', 'ppu.mode7.Matrix[2]']),
    u16keys(mss, ['ppu.mode7.matrix[3]', 'ppu.mode7.Matrix[3]']),
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
    oam_address_offset: mssU16(mss, 'ppu.oamAddressOffset'),
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
    mode7_center_x: u16keys(mss, ['ppu.mode7.centerX', 'ppu.mode7.CenterX']),
    mode7_center_y: u16keys(mss, ['ppu.mode7.centerY', 'ppu.mode7.CenterY']),
    mode7_hscroll: u16keys(mss, ['ppu.mode7.hscroll', 'ppu.mode7.HScroll']),
    mode7_vscroll: u16keys(mss, ['ppu.mode7.vscroll', 'ppu.mode7.VScroll']),
    mode7_hflip: u8keys(mss, ['ppu.mode7.horizontalMirroring', 'ppu.mode7.HorizontalMirroring']),
    mode7_vflip: u8keys(mss, ['ppu.mode7.verticalMirroring', 'ppu.mode7.VerticalMirroring']),
    mode7_fill0: u8keys(mss, ['ppu.mode7.fillWithTile0', 'ppu.mode7.FillWithTile0']),
    mode7_large: u8keys(mss, ['ppu.mode7.largeMap', 'ppu.mode7.LargeMap']),
    window0_left: u8keys(mss, ['ppu.window[0].left', 'ppu.window[0].Left']),
    window0_right: u8keys(mss, ['ppu.window[0].right', 'ppu.window[0].Right']),
    window1_left: u8keys(mss, ['ppu.window[1].left', 'ppu.window[1].Left']),
    window1_right: u8keys(mss, ['ppu.window[1].right', 'ppu.window[1].Right']),
    scanline: mssU16(mss, 'ppu.scanline'),
    frame_count: mssU32(mss, 'ppu.frameCount'),
    horizontal_location: mssU16(mss, 'ppu.horizontalLocation'),
    vertical_location: mssU16(mss, 'ppu.verticalLocation'),
    odd_frame: mssU8(mss, 'ppu.oddFrame'),
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
  if (ppu.oam_address_offset != null) mssAddU16(mss, 'ppu.oamAddressOffset', ppu.oam_address_offset);
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
    mssAddU16(mss, `ppu.layers[${i}].tilemapAddress`, L.tilemap_address);
    mssAddU16(mss, `ppu.layers[${i}].chrAddress`, L.chr_address);
    mssAddU16(mss, `ppu.layers[${i}].hscroll`, L.hscroll);
    mssAddU16(mss, `ppu.layers[${i}].vscroll`, L.vscroll);
    mssAddBool(mss, `ppu.layers[${i}].doubleWidth`, L.double_width);
    mssAddBool(mss, `ppu.layers[${i}].doubleHeight`, L.double_height);
    mssAddBool(mss, `ppu.layers[${i}].largeTiles`, L.large_tiles);
  }
  const m = ppu.mode7_matrix ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i += 1) mssAddS16(mss, `ppu.mode7.matrix[${i}]`, m[i] ?? 0);
  mssAddU16(mss, 'ppu.mode7.centerX', ppu.mode7_center_x ?? 0);
  mssAddU16(mss, 'ppu.mode7.centerY', ppu.mode7_center_y ?? 0);
  mssAddU16(mss, 'ppu.mode7.hscroll', ppu.mode7_hscroll ?? 0);
  mssAddU16(mss, 'ppu.mode7.vscroll', ppu.mode7_vscroll ?? 0);
  mssAddBool(mss, 'ppu.mode7.horizontalMirroring', ppu.mode7_hflip ?? 0);
  mssAddBool(mss, 'ppu.mode7.verticalMirroring', ppu.mode7_vflip ?? 0);
  mssAddBool(mss, 'ppu.mode7.fillWithTile0', ppu.mode7_fill0 ?? 0);
  mssAddBool(mss, 'ppu.mode7.largeMap', ppu.mode7_large ?? 0);
  mssAddU8(mss, 'ppu.window[0].left', ppu.window0_left ?? 0);
  mssAddU8(mss, 'ppu.window[0].right', ppu.window0_right ?? 0);
  mssAddU8(mss, 'ppu.window[1].left', ppu.window1_left ?? 0);
  mssAddU8(mss, 'ppu.window[1].right', ppu.window1_right ?? 0);
  if (ppu.scanline != null) mssAddU16(mss, 'ppu.scanline', ppu.scanline);
  if (ppu.frame_count != null) mssAddU32(mss, 'ppu.frameCount', ppu.frame_count);
  if (ppu.horizontal_location != null) mssAddU16(mss, 'ppu.horizontalLocation', ppu.horizontal_location);
  if (ppu.vertical_location != null) mssAddU16(mss, 'ppu.verticalLocation', ppu.vertical_location);
  if (ppu.odd_frame != null) mssAddBool(mss, 'ppu.oddFrame', ppu.odd_frame);
}

function readDma(mss: MssFile): DmaState {
  const channels: DmaChannel[] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = `dmaController.channel[${i}].`;
    channels.push({
      invert_direction: u8keys(mss, [`${p}invertDirection`, `${p}InvertDirection`]),
      hdma_indirect: u8keys(mss, [`${p}hdmaIndirectAddressing`, `${p}HdmaIndirectAddressing`]),
      unused_43x0: u8keys(mss, [`${p}unusedControlFlag`, `${p}UnusedControlFlag`]),
      fixed_transfer: u8keys(mss, [`${p}fixedTransfer`, `${p}FixedTransfer`]),
      decrement: u8keys(mss, [`${p}decrement`, `${p}Decrement`]),
      transfer_mode: u8keys(mss, [`${p}transferMode`, `${p}TransferMode`]),
      dest: u8keys(mss, [`${p}destAddress`, `${p}DestAddress`]),
      src_address: u16keys(mss, [`${p}srcAddress`, `${p}SrcAddress`]),
      src_bank: u8keys(mss, [`${p}srcBank`, `${p}SrcBank`]),
      transfer_size: u16keys(mss, [`${p}transferSize`, `${p}TransferSize`]),
      hdma_bank: u8keys(mss, [`${p}hdmaBank`, `${p}HdmaBank`]),
      hdma_table: u16keys(mss, [`${p}hdmaTableAddress`, `${p}HdmaTableAddress`]),
      hdma_line: u8keys(mss, [`${p}hdmaLineCounterAndRepeat`, `${p}HdmaLineCounterAndRepeat`]),
      do_transfer: u8keys(mss, [`${p}doTransfer`, `${p}DoTransfer`]),
      hdma_finished: u8keys(mss, [`${p}hdmaFinished`, `${p}HdmaFinished`]),
      dma_active: u8keys(mss, [`${p}dmaActive`, `${p}DmaActive`]),
    });
  }
  return {
    hdma_channels: mssU8(mss, 'dmaController.hdmaChannels'),
    channels,
    hdma_pending: mssU8(mss, 'dmaController.hdmaPending'),
    dma_pending: mssU8(mss, 'dmaController.dmaPending'),
    hdma_init_pending: mssU8(mss, 'dmaController.hdmaInitPending'),
    need_to_process: mssU8(mss, 'dmaController.needToProcess'),
    dma_clock_counter: mssU32(mss, 'dmaController.dmaClockCounter'),
    dma_start_delay: mssU8(mss, 'dmaController.dmaStartDelay'),
  };
}

function writeDma(mss: MssFile, dma: DmaState): void {
  mssAddU8(mss, 'dmaController.hdmaChannels', dma.hdma_channels);
  if (dma.hdma_pending != null) mssAddBool(mss, 'dmaController.hdmaPending', dma.hdma_pending);
  if (dma.dma_pending != null) mssAddBool(mss, 'dmaController.dmaPending', dma.dma_pending);
  if (dma.hdma_init_pending != null) mssAddBool(mss, 'dmaController.hdmaInitPending', dma.hdma_init_pending);
  if (dma.need_to_process != null) mssAddBool(mss, 'dmaController.needToProcess', dma.need_to_process);
  if (dma.dma_clock_counter != null) mssAddU32(mss, 'dmaController.dmaClockCounter', dma.dma_clock_counter);
  if (dma.dma_start_delay != null) mssAddBool(mss, 'dmaController.dmaStartDelay', dma.dma_start_delay);
  for (let i = 0; i < 8; i += 1) {
    const ch = dma.channels[i] ?? emptyDmaChannel();
    const p = `dmaController.channel[${i}].`;
    mssAddBool(mss, `${p}invertDirection`, ch.invert_direction);
    mssAddBool(mss, `${p}hdmaIndirectAddressing`, ch.hdma_indirect);
    mssAddBool(mss, `${p}unusedControlFlag`, ch.unused_43x0);
    mssAddBool(mss, `${p}fixedTransfer`, ch.fixed_transfer);
    mssAddBool(mss, `${p}decrement`, ch.decrement);
    mssAddU8(mss, `${p}transferMode`, ch.transfer_mode);
    mssAddU8(mss, `${p}destAddress`, ch.dest);
    mssAddU16(mss, `${p}srcAddress`, ch.src_address);
    mssAddU8(mss, `${p}srcBank`, ch.src_bank);
    mssAddU16(mss, `${p}transferSize`, ch.transfer_size);
    mssAddU8(mss, `${p}hdmaBank`, ch.hdma_bank);
    mssAddU16(mss, `${p}hdmaTableAddress`, ch.hdma_table);
    mssAddU8(mss, `${p}hdmaLineCounterAndRepeat`, ch.hdma_line);
    mssAddBool(mss, `${p}doTransfer`, ch.do_transfer);
    if (ch.hdma_finished != null) mssAddBool(mss, `${p}hdmaFinished`, ch.hdma_finished);
    if (ch.dma_active != null) mssAddBool(mss, `${p}dmaActive`, ch.dma_active);
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
    master_clock: mssU64(mss, 'memoryManager.masterClock') || undefined,
    hclock: mssU16(mss, 'memoryManager.hClock'),
    next_event: mssU8(mss, 'memoryManager.nextEvent'),
    next_event_clock: mssU16(mss, 'memoryManager.nextEventClock'),
    dram_refresh: mssU16(mss, 'memoryManager.dramRefreshPosition'),
    cpu_speed: mssU8(mss, 'memoryManager.cpuSpeed'),
    open_bus: mssU8(mss, 'memoryManager.openBus'),
    irq_level: mssU8(mss, 'internalRegisters.irqLevel'),
    need_irq: mssU8(mss, 'internalRegisters.needIrq'),
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
  mssAddU64(mss, 'memoryManager.masterClock', ir.master_clock ?? 0);
  if (ir.hclock != null) mssAddU16(mss, 'memoryManager.hClock', ir.hclock);
  if (ir.next_event != null) mssAddU8(mss, 'memoryManager.nextEvent', ir.next_event);
  if (ir.next_event_clock != null) mssAddU16(mss, 'memoryManager.nextEventClock', ir.next_event_clock);
  if (ir.dram_refresh != null) mssAddU16(mss, 'memoryManager.dramRefreshPosition', ir.dram_refresh);
  if (ir.cpu_speed != null) mssAddU8(mss, 'memoryManager.cpuSpeed', ir.cpu_speed);
  if (ir.open_bus != null) mssAddU8(mss, 'memoryManager.openBus', ir.open_bus);
  if (ir.irq_level != null) mssAddBool(mss, 'internalRegisters.irqLevel', ir.irq_level);
  if (ir.need_irq != null) mssAddBool(mss, 'internalRegisters.needIrq', ir.need_irq);
}

function readSpcTimer(mss: MssFile, prefix: string): SpcTimer {
  return {
    stage0: mssU8(mss, `${prefix}stage0`),
    stage1: mssU8(mss, `${prefix}stage1`),
    stage2: mssU8(mss, `${prefix}stage2`),
    output: mssU8(mss, `${prefix}output`),
    target: mssU8(mss, `${prefix}target`),
    enabled: mssU8(mss, `${prefix}enabled`),
    timers_enabled: mssU8(mss, `${prefix}timersEnabled`),
    prev_stage1: mssU8(mss, `${prefix}prevStage1`),
  };
}

function writeSpcTimer(mss: MssFile, prefix: string, t: SpcTimer): void {
  mssAddU8(mss, `${prefix}stage0`, t.stage0);
  mssAddU8(mss, `${prefix}stage1`, t.stage1);
  mssAddU8(mss, `${prefix}stage2`, t.stage2);
  mssAddU8(mss, `${prefix}output`, t.output);
  mssAddU8(mss, `${prefix}target`, t.target);
  mssAddBool(mss, `${prefix}enabled`, t.enabled);
  mssAddBool(mss, `${prefix}timersEnabled`, t.timers_enabled);
  mssAddU8(mss, `${prefix}prevStage1`, t.prev_stage1);
}

function readSpc(mss: MssFile): Spc700 {
  const timers = [0, 1, 2].map((i) => readSpcTimer(mss, `spc.timer${i}.`));
  const hasTimers = mssGet(mss, 'spc.timer0.stage0') || mssGet(mss, 'spc.timer0.target');
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
    ram_reg: [0, 1].map((i) => mssU8(mss, `spc.ramReg[${i}]`)),
    cycle: u64keys(mss, ['spc.cycle']) || undefined,
    write_enabled: mssGet(mss, 'spc.writeEnabled') ? mssU8(mss, 'spc.writeEnabled') : undefined,
    timers_disabled: mssGet(mss, 'spc.timersDisabled') ? mssU8(mss, 'spc.timersDisabled') : undefined,
    internal_speed: mssGet(mss, 'spc.internalSpeed') ? mssU8(mss, 'spc.internalSpeed') : undefined,
    external_speed: mssGet(mss, 'spc.externalSpeed') ? mssU8(mss, 'spc.externalSpeed') : undefined,
    timers: hasTimers ? timers : undefined,
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
  mssAddBool(mss, 'spc.writeEnabled', spc.write_enabled ?? 1);
  mssAddBool(mss, 'spc.timersDisabled', spc.timers_disabled ?? 0);
  // Speed 0 is valid (and what in-level captures store). Omitting the key
  // leaves Mesen's boot garbage, which desyncs IncCycleCount vs the DSP.
  mssAddU8(mss, 'spc.internalSpeed', spc.internal_speed ?? 0);
  mssAddU8(mss, 'spc.externalSpeed', spc.external_speed ?? 0);
  mssAddBool(mss, 'spc.enabled', 1);
  mssAddU8(mss, 'spc.opStep', 0);
  mssAddU8(mss, 'spc.opSubStep', 0);
  mssAddBool(mss, 'spc.pendingCpuRegUpdate', 0);
  const cpuRegs = spc.cpu_regs ?? [0, 0, 0, 0];
  cpuRegs.forEach((v, i) => mssAddU8(mss, `spc.cpuRegs[${i}]`, v));
  (spc.output_reg ?? [0, 0, 0, 0]).forEach((v, i) => mssAddU8(mss, `spc.outputReg[${i}]`, v));
  const ramReg = spc.ram_reg ?? [0, 0];
  ramReg.forEach((v, i) => mssAddU8(mss, `spc.ramReg[${i}]`, v));
  mssAdd(mss, 'spc.newCpuRegs', Uint8Array.from(cpuRegs));
  if (spc.cycle != null) mssAddU64(mss, 'spc.cycle', spc.cycle);
  (spc.timers ?? []).forEach((t, i) => writeSpcTimer(mss, `spc.timer${i}.`, t));
}

function i32Pair(mss: MssFile, key: string): number[] | undefined {
  const d = mssGet(mss, key);
  if (!d || d.length < 8) return undefined;
  return [
    Buffer.from(d.subarray(0, 4)).readInt32LE(0),
    Buffer.from(d.subarray(4, 8)).readInt32LE(0),
  ];
}

function writeI32Pair(mss: MssFile, key: string, pair: number[] | undefined): void {
  if (!pair || pair.length < 2) return;
  const b = Buffer.alloc(8);
  b.writeInt32LE(pair[0]! | 0, 0);
  b.writeInt32LE(pair[1]! | 0, 4);
  mssAdd(mss, key, b);
}

function readDspState(mss: MssFile): DspMixer | undefined {
  const p = 'spc.dsp.';
  if (!mssGet(mss, `${p}keyOn`) && !mssGet(mss, `${p}noiseLfsr`) && !mssGet(mss, `${p}counter`)) {
    return undefined;
  }
  return {
    noise_lfsr: mssI32(mss, `${p}noiseLfsr`),
    counter: mssU16(mss, `${p}counter`),
    step: mssU8(mss, `${p}step`),
    out_reg_buffer: mssU8(mss, `${p}outRegBuffer`),
    env_reg_buffer: mssU8(mss, `${p}envRegBuffer`),
    voice_end_buffer: mssU8(mss, `${p}voiceEndBuffer`),
    voice_output: mssI32(mss, `${p}voiceOutput`),
    out_samples: i32Pair(mss, `${p}outSamples`),
    pitch: mssI32(mss, `${p}pitch`),
    sample_address: mssU16(mss, `${p}sampleAddress`),
    brr_next_address: mssU16(mss, `${p}brrNextAddress`),
    dir: mssU8(mss, `${p}dirSampleTableAddress`),
    noise_on: mssU8(mss, `${p}noiseOn`),
    pitch_mod_on: mssU8(mss, `${p}pitchModulationOn`),
    key_on: mssU8(mss, `${p}keyOn`),
    new_key_on: mssU8(mss, `${p}newKeyOn`),
    key_off: mssU8(mss, `${p}keyOff`),
    every_other_sample: mssU8(mss, `${p}everyOtherSample`, 1),
    source_number: mssU8(mss, `${p}sourceNumber`),
    brr_header: mssU8(mss, `${p}brrHeader`),
    brr_data: mssU8(mss, `${p}brrData`),
    looped: mssU8(mss, `${p}looped`),
    adsr1: mssU8(mss, `${p}adsr1`),
    echo_in: i32Pair(mss, `${p}echoIn`),
    echo_out: i32Pair(mss, `${p}echoOut`),
    echo_history: mssBytes(mss, `${p}echoHistory`, DSP_ECHO_HIST) ?? undefined,
    echo_pointer: mssU16(mss, `${p}echoPointer`),
    echo_length: mssU16(mss, `${p}echoLength`),
    echo_offset: mssU16(mss, `${p}echoOffset`),
    echo_history_pos: mssU8(mss, `${p}echoHistoryPos`),
    echo_ring: mssU8(mss, `${p}echoRingBufferAddress`),
    echo_on: mssU8(mss, `${p}echoOn`),
    echo_enabled: mssU8(mss, `${p}echoEnabled`),
  };
}

/** Mixer latches from DSP regs when the .rhstate1 was captured before dsp_state existed. */
export function inferDspState(state: RhState1): DspMixer | undefined {
  if (state.dsp_state) return state.dsp_state;
  const dsp = getSectionDecoded(state, 'dsp');
  if (!dsp || dsp.length < 0x70) return undefined;
  const flg = dsp[0x6c] ?? 0;
  return {
    every_other_sample: 1,
    key_on: dsp[0x4c] ?? 0,
    new_key_on: 0,
    key_off: dsp[0x5c] ?? 0,
    dir: dsp[0x5d] ?? 0,
    echo_on: dsp[0x4d] ?? 0,
    echo_enabled: (flg & 0x20) ? 0 : 1,
    echo_ring: dsp[0x6d] ?? 0,
    noise_on: dsp[0x3d] ?? 0,
    pitch_mod_on: dsp[0x2d] ?? 0,
    noise_lfsr: 0x4000,
    counter: 0,
    step: 0,
  };
}

function writeDspState(mss: MssFile, d: DspMixer): void {
  const p = 'spc.dsp.';
  if (d.noise_lfsr != null) mssAddI32(mss, `${p}noiseLfsr`, d.noise_lfsr);
  if (d.counter != null) mssAddU16(mss, `${p}counter`, d.counter);
  if (d.step != null) mssAddU8(mss, `${p}step`, d.step);
  if (d.out_reg_buffer != null) mssAddU8(mss, `${p}outRegBuffer`, d.out_reg_buffer);
  if (d.env_reg_buffer != null) mssAddU8(mss, `${p}envRegBuffer`, d.env_reg_buffer);
  if (d.voice_end_buffer != null) mssAddU8(mss, `${p}voiceEndBuffer`, d.voice_end_buffer);
  if (d.voice_output != null) mssAddI32(mss, `${p}voiceOutput`, d.voice_output);
  writeI32Pair(mss, `${p}outSamples`, d.out_samples);
  if (d.pitch != null) mssAddI32(mss, `${p}pitch`, d.pitch);
  if (d.sample_address != null) mssAddU16(mss, `${p}sampleAddress`, d.sample_address);
  if (d.brr_next_address != null) mssAddU16(mss, `${p}brrNextAddress`, d.brr_next_address);
  if (d.dir != null) mssAddU8(mss, `${p}dirSampleTableAddress`, d.dir);
  if (d.noise_on != null) mssAddU8(mss, `${p}noiseOn`, d.noise_on);
  if (d.pitch_mod_on != null) mssAddU8(mss, `${p}pitchModulationOn`, d.pitch_mod_on);
  if (d.key_on != null) mssAddU8(mss, `${p}keyOn`, d.key_on);
  if (d.new_key_on != null) mssAddU8(mss, `${p}newKeyOn`, d.new_key_on);
  if (d.key_off != null) mssAddU8(mss, `${p}keyOff`, d.key_off);
  mssAddU8(mss, `${p}everyOtherSample`, d.every_other_sample ?? 1);
  if (d.source_number != null) mssAddU8(mss, `${p}sourceNumber`, d.source_number);
  if (d.brr_header != null) mssAddU8(mss, `${p}brrHeader`, d.brr_header);
  if (d.brr_data != null) mssAddU8(mss, `${p}brrData`, d.brr_data);
  if (d.looped != null) mssAddU8(mss, `${p}looped`, d.looped);
  if (d.adsr1 != null) mssAddU8(mss, `${p}adsr1`, d.adsr1);
  writeI32Pair(mss, `${p}echoIn`, d.echo_in);
  writeI32Pair(mss, `${p}echoOut`, d.echo_out);
  if (d.echo_history) mssAdd(mss, `${p}echoHistory`, pad(d.echo_history, DSP_ECHO_HIST));
  if (d.echo_pointer != null) mssAddU16(mss, `${p}echoPointer`, d.echo_pointer);
  if (d.echo_length != null) mssAddU16(mss, `${p}echoLength`, d.echo_length);
  if (d.echo_offset != null) mssAddU16(mss, `${p}echoOffset`, d.echo_offset);
  if (d.echo_history_pos != null) mssAddU8(mss, `${p}echoHistoryPos`, d.echo_history_pos);
  if (d.echo_ring != null) mssAddU8(mss, `${p}echoRingBufferAddress`, d.echo_ring);
  if (d.echo_on != null) mssAddU8(mss, `${p}echoOn`, d.echo_on);
  if (d.echo_enabled != null) mssAddBool(mss, `${p}echoEnabled`, d.echo_enabled);
}

function readVoices(mss: MssFile): DspVoice[] | undefined {
  if (!mssGet(mss, 'spc.dsp.voices[0].envVolume') && !mssGet(mss, 'spc.dsp.voices[0].envOut')) {
    return undefined;
  }
  const voices: DspVoice[] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = `spc.dsp.voices[${i}].`;
    voices.push({
      env_volume: mssI32(mss, `${p}envVolume`),
      prev_calculated_env: mssI32(mss, `${p}prevCalculatedEnv`),
      interpolation_pos: mssI32(mss, `${p}interpolationPos`),
      env_mode: mssI32(mss, `${p}envMode`),
      brr_address: mssU16(mss, `${p}brrAddress`),
      brr_offset: mssU16(mss, `${p}brrOffset`),
      voice_bit: mssU8(mss, `${p}voiceBit`),
      key_on_delay: mssU8(mss, `${p}keyOnDelay`),
      env_out: mssU8(mss, `${p}envOut`),
      buffer_pos: mssU8(mss, `${p}bufferPos`),
      sample_buffer: mssBytes(mss, `${p}sampleBuffer`, DSP_SAMPLE_BUF) ?? undefined,
    });
  }
  return voices;
}

function writeVoices(mss: MssFile, voices: DspVoice[]): void {
  for (let i = 0; i < Math.min(8, voices.length); i += 1) {
    const v = voices[i]!;
    const p = `spc.dsp.voices[${i}].`;
    // Mesen DspVoice: int32 env/interp, enum envMode, uint16 brrOffset, int16[12] sampleBuffer.
    // Binary load ignores values shorter than sizeof(T) — u16 envVolume left voices at Release/0.
    mssAddI32(mss, `${p}envVolume`, v.env_volume);
    mssAddI32(mss, `${p}prevCalculatedEnv`, v.prev_calculated_env);
    mssAddI32(mss, `${p}interpolationPos`, v.interpolation_pos);
    mssAddI32(mss, `${p}envMode`, v.env_mode);
    mssAddU16(mss, `${p}brrAddress`, v.brr_address);
    mssAddU16(mss, `${p}brrOffset`, v.brr_offset);
    mssAddU8(mss, `${p}voiceBit`, v.voice_bit);
    mssAddU8(mss, `${p}keyOnDelay`, v.key_on_delay);
    mssAddU8(mss, `${p}envOut`, v.env_out);
    mssAddU8(mss, `${p}bufferPos`, v.buffer_pos);
    mssAdd(mss, `${p}sampleBuffer`, pad(v.sample_buffer ?? new Uint8Array(0), DSP_SAMPLE_BUF));
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
  const dsp = first(mss, ['spc.dsp.regs', 'spc.dsp.externalRegs']) ?? null;
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
  const dsp_state = readDspState(mss);
  const sa1CpuBlob = mssGet(mss, 'cart.coprocessor.cpu.a') || mssGet(mss, 'cart.sa1.cpu.a');
  const sa1 = sa1CpuBlob
    ? { cpu: readCpu(mss, mssGet(mss, 'cart.sa1.cpu.a') ? 'cart.sa1.cpu.' : 'cart.coprocessor.cpu.') }
    : undefined;

  const scanline = ppu.scanline ?? mssU16(mss, 'ppu.scanline');
  const hclock = internal.hclock ?? mssU16(mss, 'memoryManager.hClock');

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
    dsp_state,
  };
  pushSec(sections, 'fillram', 0, reconstructFillram(state), FILLRAM);
  return state;
}

export function portableToMss(state: RhState1, romName: string): MssFile {
  const mss = createEmptyMss(romName);
  const master = defaultMasterClock(state);
  const cpu: Cpu5A22 = {
    ...state.cpu,
    cycle_count: state.cpu.cycle_count && state.cpu.cycle_count > 0 ? state.cpu.cycle_count : master,
  };
  writeCpu(mss, 'cpu.', cpu);

  const ppu = state.ppu
    ? {
      ...state.ppu,
      scanline: state.ppu.scanline ?? state.trigger.scanline,
      frame_count: state.ppu.frame_count ?? state.trigger.frame,
    }
    : undefined;
  if (ppu) writePpu(mss, ppu);
  if (state.dma) writeDma(mss, state.dma);

  const ir: InternalRegs = {
    enable_nmi: state.internal?.enable_nmi ?? 1,
    enable_v_irq: state.internal?.enable_v_irq ?? 0,
    enable_h_irq: state.internal?.enable_h_irq ?? 0,
    enable_auto_joy: state.internal?.enable_auto_joy ?? 1,
    h_timer: state.internal?.h_timer ?? 0,
    v_timer: state.internal?.v_timer ?? 0,
    enable_fastrom: state.internal?.enable_fastrom ?? 1,
    io_port: state.internal?.io_port ?? 0xff,
    wram_port: state.internal?.wram_port ?? 0,
    ...state.internal,
    master_clock: master,
    hclock: state.internal?.hclock ?? state.trigger.hclock ?? 0,
  };
  writeInternal(mss, ir);
  if (state.spc) {
    const aram = getSectionDecoded(state, 'spc_aram');
    const ramReg = state.spc.ram_reg ?? (
      aram && aram.length > 0xf9 ? [aram[0xf8]!, aram[0xf9]!] : [0, 0]
    );
    writeSpc(mss, {
      ...state.spc,
      ram_reg: ramReg,
      // Captured cycle is often 5 ticks ahead; Mesen only auto-snaps if |delta|>20,
      // then sets cycle == master*ratio which is still 1 too high for Run().
      cycle: spcCycleJustBehind(master),
    });
    mssAddF64(mss, 'spc.clockRatio', (MESEN_SPC_SAMPLE_RATE * 64) / NTSC_MASTER_CLOCK_RATE);
  }
  if (state.dsp_voices) writeVoices(mss, state.dsp_voices);
  const mixer = inferDspState(state);
  if (mixer) writeDspState(mss, mixer);
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
  const dspRegs = getSectionDecoded(state, 'dsp');
  if (dspRegs) mssAdd(mss, 'spc.dsp.externalRegs', dspRegs);
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

function flag(v: number | undefined | null): boolean {
  return !!(v && v !== 0);
}

/** Lua `emu.setState` map: Mesen bool fields must be real booleans, not 0/1. */
export function portableToSetState(state: RhState1): Record<string, number | boolean> {
  const o: Record<string, number | boolean> = {};
  const n = (k: string, v: number | undefined | null) => {
    if (v == null || Number.isNaN(Number(v))) return;
    o[k] = Number(v);
  };
  const b = (k: string, v: number | boolean | undefined | null) => {
    if (v == null) return;
    o[k] = typeof v === 'boolean' ? v : flag(v);
  };
  const cpu = state.cpu;
  n('cpu.a', cpu.a);
  n('cpu.x', cpu.x);
  n('cpu.y', cpu.y);
  n('cpu.d', cpu.d);
  n('cpu.dbr', cpu.db);
  n('cpu.ps', cpu.p);
  n('cpu.sp', cpu.sp);
  n('cpu.pc', cpu.pc & 0xffff);
  n('cpu.k', (cpu.pc >>> 16) & 0xff);
  b('cpu.emulationMode', cpu.e);
  n('cpu.stopState', cpu.waiting ? STOP_WAIT : 0);
  b('cpu.needNmi', cpu.nmi_pending);
  n('cpu.irqSource', cpu.irq_pending ? 1 : 0);
  n('cpu.cycleCount', cpu.cycle_count && cpu.cycle_count > 0 ? cpu.cycle_count : defaultMasterClock(state));
  n('cpu.nmiFlagCounter', cpu.nmi_flag_counter);
  b('cpu.irqLock', cpu.irq_lock);
  b('cpu.waiOver', cpu.wai_over);
  n('cpu.prevIrqSource', cpu.prev_irq);

  const ppu = state.ppu;
  if (ppu) {
    b('ppu.forcedBlank', ppu.forced_blank);
    n('ppu.screenBrightness', ppu.brightness);
    n('ppu.bgMode', ppu.bgmode);
    b('ppu.mode1Bg3Priority', ppu.mode1_bg3_priority);
    n('ppu.mainScreenLayers', ppu.main_screen_layers);
    n('ppu.subScreenLayers', ppu.sub_screen_layers);
    n('ppu.cgramAddress', ppu.cgram_address);
    n('ppu.vramAddress', ppu.vram_address);
    n('ppu.vramIncrementValue', ppu.vram_increment);
    n('ppu.oamMode', ppu.oam_mode);
    n('ppu.oamBaseAddress', ppu.oam_base);
    n('ppu.oamRamAddress', ppu.oam_addr);
    b('ppu.enableOamPriority', ppu.oam_priority);
    n('ppu.oamAddressOffset', ppu.oam_address_offset);
    b('ppu.hiResMode', ppu.hi_res);
    n('ppu.colorMathEnabled', ppu.color_math_enabled);
    n('ppu.fixedColor', ppu.fixed_color);
    n('ppu.scanline', ppu.scanline ?? state.trigger.scanline);
    n('ppu.frameCount', ppu.frame_count ?? state.trigger.frame);
    (ppu.layers ?? []).forEach((L, i) => {
      n(`ppu.layers[${i}].tilemapAddress`, L.tilemap_address);
      n(`ppu.layers[${i}].chrAddress`, L.chr_address);
      n(`ppu.layers[${i}].hscroll`, L.hscroll);
      n(`ppu.layers[${i}].vscroll`, L.vscroll);
      b(`ppu.layers[${i}].doubleWidth`, L.double_width);
      b(`ppu.layers[${i}].doubleHeight`, L.double_height);
      b(`ppu.layers[${i}].largeTiles`, L.large_tiles);
    });
  }

  const dma = state.dma;
  if (dma) {
    n('dmaController.hdmaChannels', dma.hdma_channels);
    b('dmaController.hdmaPending', dma.hdma_pending);
    b('dmaController.dmaPending', dma.dma_pending);
    b('dmaController.hdmaInitPending', dma.hdma_init_pending);
    b('dmaController.needToProcess', dma.need_to_process);
    dma.channels.forEach((ch, i) => {
      const p = `dmaController.channel[${i}].`;
      b(`${p}invertDirection`, ch.invert_direction);
      b(`${p}hdmaIndirectAddressing`, ch.hdma_indirect);
      b(`${p}fixedTransfer`, ch.fixed_transfer);
      b(`${p}decrement`, ch.decrement);
      n(`${p}transferMode`, ch.transfer_mode);
      n(`${p}destAddress`, ch.dest);
      n(`${p}srcAddress`, ch.src_address);
      n(`${p}srcBank`, ch.src_bank);
      n(`${p}transferSize`, ch.transfer_size);
      n(`${p}hdmaBank`, ch.hdma_bank);
      n(`${p}hdmaTableAddress`, ch.hdma_table);
      n(`${p}hdmaLineCounterAndRepeat`, ch.hdma_line);
      b(`${p}doTransfer`, ch.do_transfer);
    });
  }

  const ir = state.internal;
  b('internalRegisters.enableNmi', ir?.enable_nmi ?? 1);
  b('internalRegisters.enableVerticalIrq', ir?.enable_v_irq);
  b('internalRegisters.enableHorizontalIrq', ir?.enable_h_irq);
  b('internalRegisters.enableAutoJoypadRead', ir?.enable_auto_joy ?? 1);
  b('internalRegisters.enableFastRom', ir?.enable_fastrom ?? 1);
  n('internalRegisters.ioPortOutput', ir?.io_port ?? 0xff);
  n('memoryManager.registerHandlerB.wramPosition', ir?.wram_port);
  n('memoryManager.masterClock', defaultMasterClock(state));
  n('memoryManager.hClock', ir?.hclock ?? state.trigger.hclock ?? 0);
  n('memoryManager.nextEvent', ir?.next_event);
  n('memoryManager.nextEventClock', ir?.next_event_clock);
  b('internalRegisters.nmiFlag', ir?.nmi_flag);
  b('internalRegisters.irqFlag', ir?.irq_flag);
  b('internalRegisters.irqLevel', ir?.irq_level);
  b('internalRegisters.needIrq', ir?.need_irq);

  const spc = state.spc;
  if (spc) {
    n('spc.a', spc.a);
    n('spc.x', spc.x);
    n('spc.y', spc.y);
    n('spc.ps', spc.psw);
    n('spc.sp', spc.sp);
    n('spc.pc', spc.pc);
    n('spc.dspReg', spc.dsp_reg);
    b('spc.romEnabled', spc.rom_enabled);
    b('spc.timersEnabled', spc.timers_enabled);
    b('spc.writeEnabled', spc.write_enabled ?? 1);
    b('spc.timersDisabled', spc.timers_disabled ?? 0);
    n('spc.internalSpeed', spc.internal_speed ?? 0);
    n('spc.externalSpeed', spc.external_speed ?? 0);
    b('spc.enabled', 1);
    n('spc.stopState', 0);
    // Do not set spc.cycle here. Captured cycle is often slightly ahead of
    // masterClock*clockRatio, and setState runs after load's UpdateClockRatio
    // snap — leaving the SPC permanently skipped in Spc::Run().
    (spc.cpu_regs ?? [0, 0, 0, 0]).forEach((v, i) => n(`spc.cpuRegs[${i}]`, v));
    (spc.output_reg ?? [0, 0, 0, 0]).forEach((v, i) => n(`spc.outputReg[${i}]`, v));
    const aram = getSectionDecoded(state, 'spc_aram');
    const ramReg = spc.ram_reg ?? (
      aram && aram.length > 0xf9 ? [aram[0xf8]!, aram[0xf9]!] : []
    );
    ramReg.forEach((v, i) => n(`spc.ramReg[${i}]`, v));
    (spc.timers ?? []).forEach((t, i) => {
      const p = `spc.timer${i}.`;
      n(`${p}stage0`, t.stage0);
      n(`${p}stage1`, t.stage1);
      n(`${p}stage2`, t.stage2);
      n(`${p}output`, t.output);
      n(`${p}target`, t.target);
      n(`${p}prevStage1`, t.prev_stage1);
      b(`${p}enabled`, t.enabled);
      b(`${p}timersEnabled`, t.timers_enabled);
    });
  }
  return o;
}

export function setStateToLua(map: Record<string, number | boolean>): string {
  const lines = Object.entries(map).map(([k, v]) => {
    const lit = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    return `  [${JSON.stringify(k)}] = ${lit},`;
  });
  return `local SETSTATE = {\n${lines.join('\n')}\n}\n`;
}

/** Apply Mesen getState scalar keys (fallback when no .mss). Unknown keys ignored. */
export function applyMesenScalarKeys(state: RhState1, keys: Record<string, number>): void {
  const n = (k: string, d = 0) => {
    if (keys[k] == null) return d;
    const v = Number(keys[k]);
    return Number.isFinite(v) ? v : d;
  };
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
      pc: ((k & 0xff) << 16) | (pc16 & 0xffff),
      e: n('cpu.emulationMode', 1),
      waiting: n('cpu.stopState') === STOP_WAIT ? 1 : 0,
      nmi_pending: n('cpu.needNmi'),
      irq_pending: n('cpu.irqSource') ? 1 : 0,
    });
  }
}
