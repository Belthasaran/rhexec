# RHSTATE1 file format (v1)

On-disk: **8-byte magic** `RHSTATE1` plus one **MessagePack map** (`@msgpack/msgpack`). Unknown keys must be ignored.

This is a **portable SNES hardware dump**, not an emulator savestate. Temporary Mesen `.mss` files may be used while capturing or launching, then discarded. Do not store Mesen key names or an `.mss` blob in this file.

Checklist vs Snes9x v12 freeze (`snapshot.cpp`) / [s9x_mss](https://github.com/shanytc/s9x_mss): **REG** → `cpu`; **CPU** flags → `cpu.waiting` / `nmi_pending` / `irq_pending`; **RAM/VRA/SRA** → sections; **FIL** → `fillram`; **PPU/DMA** → `ppu` / `dma`; **SND** → `spc_aram` + `dsp` + `spc` + optional `dsp_voices`. Skip NAM/CTL/TIM/SHO/MOV. Coprocessor sections only when present.

## Map

| Key | Type | Notes |
|-----|------|--------|
| `v` | uint | `1` |
| `profile` | string | `in_level` (this capturer), also `ow_ready` / `level_fade` |
| `rom` | map | `sha1`, `size`, `headered`, `mapping`, `sa1` |
| `host` | map | `emulator` (e.g. `mesen2`), `mode` (`auto`/`manual`) |
| `cpu` | map | 5A22 `a,x,y,d,db,p,sp,pc,e` plus `waiting`, `nmi_pending`, `irq_pending`. `pc` is 24-bit (`K<<16\|PC`) |
| `spc` | map | SPC-700 `a,x,y,psw,sp,pc`, ports, timers, `dsp_reg`, `rom_enabled`, optional `write_enabled` / `internal_speed` / `external_speed` |
| `ppu` | map | MMIO-equivalent (forced blank, BGMODE, TM/TS, layers, Mode7, windows, VMA, OAM, color math) |
| `dma` | map | `hdma_channels` (`$420C`) + 8 channels (`$4300–$437F` meaning) |
| `internal` | map | `$4200` family, H/V IRQ timers, FastROM, auto-joypad, WRAM port `$2181–$2183`, optional `master_clock` / `hclock` (SNES scheduler) |
| `sa1` / `gsu` | map | optional coprocessor CPU/regs |
| `dsp_voices` | array | optional 8 DSP voice envelopes (`env_volume` is 11.8-style int, `sample_buffer` 24 bytes) |
| `dsp_state` | map | optional DSP mixer latches (key-on, echo, BRR step) |
| `trigger` | map | `game_mode`, `pc`, `frame`, optional `scanline`, `hclock`, `region` |
| `sections` | array | `{ id, bus, encoding, data }` |

Section `id`: `wram`, `vram`, `cgram`, `oam`, `sram`, `spc_aram`, `dsp`, `fillram` (32 KiB `$00:0000–$00:7FFF` I/O shadow), `sa1_iram`, `gsu_wram`, `cx4_data`, `dsp_data`, `st018_wram`, `obc1_ram` (omit if not dumped). Legacy `ppu_mmio` / `dma` blobs are still accepted.

`encoding`: **`raw`** (default — long `0x00` runs stay literal so **zip/DEFLATE matches shared RAM across files**) or **`rle0`** (`0x00 <len>` = `len` zeros, `len` 1–255). Do not wrap the whole file in zstd/gzip if zip-sharing matters.

`data` is MessagePack binary. `wram` is `$7E/$7F` (128 KiB when captured from Mesen).

## Mutations (playback)

`--level` (hex translevel) and `--ow-*` write the same WRAM as `extrapatches/4lvno.asm` (`$13BF`, `$0F`, `$1F11`… pixels = tile×16+8). Playback tools must **not** patch `$05D89B` / `$05DCDD`. `--level` on an `in_level` capture only pokes those bytes; it does not re-run the loader.

## Consumers

- `rhboot1-sfc` — embed WRAM after a reset trampoline
- `rhcheat1-yml` — PAR8 WRAM lines
- `rhlaunch1-mesen` — synthesize a throwaway Mesen `.mss` and `loadSavestate` in one `cpuExec` callback, then `emu.setState` clocks/PPU/HDMA (emulation frozen until the callback returns)
