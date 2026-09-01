# RHSTATE1 file format (v1)

On-disk: **8-byte magic** `RHSTATE1` plus one **MessagePack map** (`@msgpack/msgpack`). Unknown keys must be ignored.

## Map

| Key | Type | Notes |
|-----|------|--------|
| `v` | uint | `1` |
| `profile` | string | `in_level` (this capturer), also `ow_ready` / `level_fade` |
| `rom` | map | `sha1`, `size`, `headered`, `mapping`, `sa1` |
| `host` | map | `emulator` (e.g. `mesen2`), `mode` (`auto`/`manual`) |
| `cpu` | map | 5A22 `a,x,y,d,db,p,sp,pc,e` |
| `trigger` | map | `game_mode`, `pc`, `frame` |
| `sections` | array | `{ id, bus, encoding, data }` |

Section `id`: `wram`, `vram`, `cgram`, `oam`, `sram`, `spc_aram`, `dsp`, `ppu_mmio`, `dma` (omit if not dumped).

`encoding`: **`raw`** (default — long `0x00` runs stay literal so **zip/DEFLATE matches shared RAM across files**) or **`rle0`** (`0x00 <len>` = `len` zeros, `len` 1–255). Do not wrap the whole file in zstd/gzip if zip-sharing matters.

`data` is MessagePack binary. `wram` is `$7E/$7F` (128 KiB when captured from Mesen).

## Mutations (playback)

`--level` (hex translevel) and `--ow-*` write the same WRAM as `extrapatches/4lvno.asm` (`$13BF`, `$0F`, `$1F11`… pixels = tile×16+8). Playback tools must **not** patch `$05D89B` / `$05DCDD`.

## Consumers

- `rhboot1-sfc` — embed WRAM after a reset trampoline
- `rhcheat1-yml` — PAR8 WRAM lines
- `rhlaunch1-mesen` — Lua WRAM poke
