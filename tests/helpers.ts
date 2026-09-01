import type { Cpu5A22, RhState1 } from '../src/rhstate1/types.ts';
import { RHSTATE1_VERSION } from '../src/rhstate1/types.ts';

export function emptyCpu(): Cpu5A22 {
  return { a: 0, x: 0, y: 0, d: 0, db: 0, p: 0, sp: 0x1ff, pc: 0x008000, e: 1 };
}

export function makeState(wram: Uint8Array, extra?: Partial<RhState1>): RhState1 {
  return {
    v: RHSTATE1_VERSION,
    profile: 'in_level',
    rom: { sha1: '00', size: 0x8000, headered: false, mapping: 'lorom', sa1: false },
    host: { emulator: 'test', mode: 'manual' },
    cpu: emptyCpu(),
    trigger: { game_mode: 0x14, pc: 0x808000, frame: 1 },
    sections: [{ id: 'wram', bus: 0x7e0000, encoding: 'raw', data: wram }],
    ...extra,
  };
}

/** LoROM fixture large enough to contain $05D89B. */
export function makeFixtureRom(): Uint8Array {
  const rom = new Uint8Array(0x40000);
  rom.fill(0xea);
  const loader = 5 * 0x8000 + (0xd89b - 0x8000);
  rom[loader] = 0x22;
  rom[loader + 1] = 0x33;
  rom[loader + 2] = 0x44;
  rom[loader + 3] = 0x55;
  rom[0x7ffc] = 0x00;
  rom[0x7ffd] = 0x80;
  rom[0x7fd5] = 0x20; // LoROM FastROM-ish
  return rom;
}
