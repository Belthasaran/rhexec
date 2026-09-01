# Mesen 2 capture and restore

`rhcap1-mesen` / `rhlaunch1-mesen` spawn:

```
$MESEN_PATH [MESEN_ARGS...] <rom> --lua <generated.lua>
```

Default binary name: `Mesen`. Set `MESEN_PATH` to the Mesen **2** executable.

Lua lives in `src/lua/`:

- `mesen_input.lua` — Start button (`emu.setInput`). Override here if your build differs.
- `mesen_capture.lua` — on `startFrame`, if `$0100=$14` and `$71=0`, arm a one-shot `cpuExec` callback. That callback calls `emu.createSavestate()` (only legal from exec), writes a temp `mesen.mss`, dumps coprocessor RAM Lua can see, writes `done`. Fallback: `read32` dumps + `getState` whitelist if savestate fails.
- `mesen_apply.lua` — **one** `cpuExec`: `emu.loadSavestate` of a synthesized temp `.mss` (optional WRAM overlay / `write32` fallback in the same callback). Emulation does not run guest instructions until the callback returns.

Node parses `mesen.mss` (`MSS` + zlib `key\0 size_le value`) into portable `.rhstate1` maps/sections and **deletes** the `.mss`. Launch synthesizes a new temp `.mss` from that portable file. Mesen keys and `.mss` blobs are never stored in RHSTATE1.

Dump directory (temp): `mesen.mss` (deleted after parse), `wram.bin` / coprocessor bins (fallback), `cpu.json`, `chips.json`, `meta.json`, `done`.

## Limits

- Capture is at an instruction boundary after `startFrame` (vblank-ish). Mid-scanline PPU shift registers / mid-DMA are not snapshotted.
- One-frame HDMA/audio hitch is acceptable if Mesen fills scheduler internals with defaults (same as s9x_mss).
- `--level` on an `in_level` capture only pokes `$13BF` / `$0F`; it does not re-run level init.
- `--out` is a `rhboot1-sfc` flag (WRAM + reset stub). `rhlaunch1-mesen` rejects it.

If `--lua` is rejected, pass the equivalent via `MESEN_ARGS` and file a note; the Node waiter only needs `done` in the dump dir.

Required: Mesen 2 Lua with `emu.addMemoryCallback` / `callbackType.exec` / `createSavestate` / `loadSavestate`. `emu.read` / `emu.memType.snesWorkRam` remain the fallback path.
