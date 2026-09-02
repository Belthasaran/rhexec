export const RHSTATE1_MAGIC = Buffer.from('RHSTATE1', 'ascii');
export const RHSTATE1_VERSION = 1;

export type CaptureMode = 'auto' | 'manual';
export type CaptureProfile = 'in_level' | 'ow_ready' | 'level_fade';
export type SectionEncoding = 'raw' | 'rle0';

/** Portable RAM blobs. Unknown ids must still round-trip. */
export type SectionId =
  | 'wram'
  | 'vram'
  | 'cgram'
  | 'oam'
  | 'sram'
  | 'spc_aram'
  | 'dsp'
  | 'fillram'
  | 'ppu_mmio'
  | 'dma'
  | 'sa1_iram'
  | 'gsu_wram'
  | 'cx4_data'
  | 'dsp_data'
  | 'st018_wram'
  | 'obc1_ram'
  | string;

export interface Cpu5A22 {
  a: number;
  x: number;
  y: number;
  d: number;
  db: number;
  p: number;
  sp: number;
  /** 24-bit PC (K << 16 | PC16). */
  pc: number;
  e: number;
  /** WAI / waiting-for-IRQ (Snes9x WaitingForInterrupt). */
  waiting?: number;
  nmi_pending?: number;
  irq_pending?: number;
  /** 5A22 cycle counter (Mesen `cpu.cycleCount`). */
  cycle_count?: number;
  nmi_flag_counter?: number;
  irq_lock?: number;
  wai_over?: number;
  prev_irq?: number;
}

export interface Spc700 {
  a: number;
  x: number;
  y: number;
  psw: number;
  sp: number;
  pc: number;
  dsp_reg?: number;
  rom_enabled?: number;
  timers_enabled?: number;
  cpu_regs?: number[];
  output_reg?: number[];
  ram_reg?: number[];
  /** SPC cycle counter (Mesen `spc.cycle`). */
  cycle?: number;
  write_enabled?: number;
  timers_disabled?: number;
  internal_speed?: number;
  external_speed?: number;
  /** Mesen decoder: 0=fetch opcode. Missing on old dumps — launch aligns PC. */
  op_step?: number;
  op_sub_step?: number;
  op_code?: number;
  operand_a?: number;
  operand_b?: number;
  tmp1?: number;
  tmp2?: number;
  tmp3?: number;
  timers?: SpcTimer[];
}

export interface SpcTimer {
  stage0: number;
  stage1: number;
  stage2: number;
  output: number;
  target: number;
  enabled: number;
  timers_enabled: number;
  prev_stage1: number;
}

export interface PpuLayer {
  tilemap_address: number;
  chr_address: number;
  hscroll: number;
  vscroll: number;
  double_width: number;
  double_height: number;
  large_tiles: number;
}

export interface PpuState {
  forced_blank: number;
  brightness: number;
  bgmode: number;
  mode1_bg3_priority: number;
  main_screen_layers: number;
  sub_screen_layers: number;
  cgram_address: number;
  vram_address: number;
  vram_increment: number;
  vram_remap: number;
  vram_inc_on_high: number;
  vram_read_buffer: number;
  mosaic_size: number;
  mosaic_enabled: number;
  oam_mode: number;
  oam_base: number;
  oam_addr: number;
  oam_priority: number;
  /** $2101 name-select offset (Mesen `ppu.oamAddressOffset`). */
  oam_address_offset?: number;
  hi_res: number;
  screen_interlace: number;
  obj_interlace: number;
  overscan: number;
  direct_color: number;
  extbg: number;
  color_math_enabled: number;
  color_math_subtract: number;
  color_math_halve: number;
  color_math_add_sub: number;
  color_math_clip: number;
  color_math_prevent: number;
  fixed_color: number;
  layers?: PpuLayer[];
  mode7_matrix?: number[];
  mode7_center_x?: number;
  mode7_center_y?: number;
  mode7_hscroll?: number;
  mode7_vscroll?: number;
  mode7_hflip?: number;
  mode7_vflip?: number;
  mode7_fill0?: number;
  mode7_large?: number;
  window0_left?: number;
  window0_right?: number;
  window1_left?: number;
  window1_right?: number;
  scanline?: number;
  frame_count?: number;
  /** PPU beam (Mesen binary savestate; not in Lua setState). */
  horizontal_location?: number;
  vertical_location?: number;
  odd_frame?: number;
}

export interface DmaChannel {
  invert_direction: number;
  hdma_indirect: number;
  unused_43x0: number;
  fixed_transfer: number;
  decrement: number;
  transfer_mode: number;
  dest: number;
  src_address: number;
  src_bank: number;
  transfer_size: number;
  hdma_bank: number;
  hdma_table: number;
  hdma_line: number;
  do_transfer: number;
  hdma_finished?: number;
  dma_active?: number;
}

export interface DmaState {
  hdma_channels: number;
  channels: DmaChannel[];
  hdma_pending?: number;
  dma_pending?: number;
  hdma_init_pending?: number;
  need_to_process?: number;
  dma_clock_counter?: number;
  dma_start_delay?: number;
}

export interface InternalRegs {
  enable_nmi: number;
  enable_v_irq: number;
  enable_h_irq: number;
  enable_auto_joy: number;
  h_timer: number;
  v_timer: number;
  enable_fastrom: number;
  io_port: number;
  wram_port: number;
  nmi_flag?: number;
  irq_flag?: number;
  mul_a?: number;
  mul_b?: number;
  dividend?: number;
  divisor?: number;
  /** SNES master clock. Needed so Mesen does not treat restore as power-on. */
  master_clock?: number;
  hclock?: number;
  next_event?: number;
  next_event_clock?: number;
  dram_refresh?: number;
  cpu_speed?: number;
  open_bus?: number;
  irq_level?: number;
  need_irq?: number;
}

export interface DspVoice {
  env_volume: number;
  prev_calculated_env: number;
  interpolation_pos: number;
  env_mode: number;
  brr_address: number;
  brr_offset: number;
  voice_bit: number;
  key_on_delay: number;
  env_out: number;
  buffer_pos: number;
  /** 12 × int16 LE (24 bytes). Older files may store 12 bytes. */
  sample_buffer?: Uint8Array;
}

/** DSP mixer latches (not the 128-byte register file in section `dsp`). */
export interface DspMixer {
  noise_lfsr?: number;
  counter?: number;
  step?: number;
  out_reg_buffer?: number;
  env_reg_buffer?: number;
  voice_end_buffer?: number;
  voice_output?: number;
  out_samples?: number[];
  pitch?: number;
  sample_address?: number;
  brr_next_address?: number;
  dir?: number;
  noise_on?: number;
  pitch_mod_on?: number;
  key_on?: number;
  new_key_on?: number;
  key_off?: number;
  every_other_sample?: number;
  source_number?: number;
  brr_header?: number;
  brr_data?: number;
  looped?: number;
  adsr1?: number;
  echo_in?: number[];
  echo_out?: number[];
  echo_history?: Uint8Array;
  echo_pointer?: number;
  echo_length?: number;
  echo_offset?: number;
  echo_history_pos?: number;
  echo_ring?: number;
  echo_on?: number;
  echo_enabled?: number;
}

export interface Sa1State {
  cpu: Cpu5A22;
}

export interface GsuState {
  [key: string]: unknown;
}

export interface RomInfo {
  sha1: string;
  size: number;
  headered: boolean;
  mapping: string;
  sa1: boolean;
}

export interface RhState1Host {
  emulator: string;
  mode: CaptureMode;
}

export interface RhState1Trigger {
  game_mode: number;
  pc: number;
  frame: number;
  scanline?: number;
  hclock?: number;
  region?: string;
}

export interface RhState1Section {
  id: SectionId;
  bus: number;
  encoding: SectionEncoding;
  data: Uint8Array;
}

export interface RhState1 {
  v: number;
  profile: CaptureProfile;
  rom: RomInfo;
  host: RhState1Host;
  cpu: Cpu5A22;
  trigger: RhState1Trigger;
  sections: RhState1Section[];
  spc?: Spc700;
  ppu?: PpuState;
  dma?: DmaState;
  internal?: InternalRegs;
  sa1?: Sa1State;
  gsu?: GsuState;
  dsp_voices?: DspVoice[];
  dsp_state?: DspMixer;
  [key: string]: unknown;
}

export interface MutateParams {
  level?: number | null;
  owHave?: boolean;
  owSubmap?: number;
  owX?: number;
  owY?: number;
}

export function emptyDmaChannel(): DmaChannel {
  return {
    invert_direction: 0,
    hdma_indirect: 0,
    unused_43x0: 0,
    fixed_transfer: 0,
    decrement: 0,
    transfer_mode: 0,
    dest: 0,
    src_address: 0,
    src_bank: 0,
    transfer_size: 0,
    hdma_bank: 0,
    hdma_table: 0,
    hdma_line: 0,
    do_transfer: 0,
  };
}

export function normalizeCpu(raw: Partial<Cpu5A22> | null | undefined): Cpu5A22 {
  const r = raw ?? {};
  const num = (v: unknown, fallback: number): number => {
    if (v == null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const pc = num(r.pc, 0);
  // `0 || 1` used to force native-mode captures (e=0) into emulation mode.
  let e = r.e == null ? 1 : num(r.e, 1);
  if (e && ((pc >>> 16) & 0xff)) e = 0;
  return {
    a: num(r.a, 0),
    x: num(r.x, 0),
    y: num(r.y, 0),
    d: num(r.d, 0),
    db: num(r.db, 0),
    p: num(r.p, 0),
    sp: num(r.sp, 0),
    pc,
    e,
    waiting: num(r.waiting, 0),
    nmi_pending: num(r.nmi_pending, 0),
    irq_pending: num(r.irq_pending, 0),
    cycle_count: r.cycle_count != null ? num(r.cycle_count, 0) : undefined,
    nmi_flag_counter: r.nmi_flag_counter != null ? num(r.nmi_flag_counter, 0) : undefined,
    irq_lock: r.irq_lock != null ? num(r.irq_lock, 0) : undefined,
    wai_over: r.wai_over != null ? num(r.wai_over, 0) : undefined,
    prev_irq: r.prev_irq != null ? num(r.prev_irq, 0) : undefined,
  };
}
