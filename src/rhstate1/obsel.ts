import type { PpuState } from './types.ts';

/** Pack Mesen's unpacked OBSEL fields back into $2101. */
export function obselByte(ppu: Pick<PpuState, 'oam_mode' | 'oam_base'> & { oam_address_offset?: number }): number {
  const size = (ppu.oam_mode & 7) << 5;
  const nameSelect = ppu.oam_address_offset != null
    ? ((((ppu.oam_address_offset >> 12) - 1) & 3) << 3)
    : 0;
  const nameBase = (ppu.oam_base >> 13) & 7;
  return (size | nameSelect | nameBase) & 0xff;
}
