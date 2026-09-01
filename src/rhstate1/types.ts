export const RHSTATE1_MAGIC = Buffer.from('RHSTATE1', 'ascii');
export const RHSTATE1_VERSION = 1;

export type CaptureMode = 'auto' | 'manual';
export type CaptureProfile = 'in_level' | 'ow_ready' | 'level_fade';
export type SectionEncoding = 'raw' | 'rle0';

export type SectionId =
  | 'wram'
  | 'vram'
  | 'cgram'
  | 'oam'
  | 'sram'
  | 'spc_aram'
  | 'dsp'
  | 'ppu_mmio'
  | 'dma';

export interface Cpu5A22 {
  a: number;
  x: number;
  y: number;
  d: number;
  db: number;
  p: number;
  sp: number;
  pc: number;
  e: number;
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
  [key: string]: unknown;
}

export interface MutateParams {
  level?: number | null;
  owHave?: boolean;
  owSubmap?: number;
  owX?: number;
  owY?: number;
}
