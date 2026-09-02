# Mesen 2 capture and restore

`rhcap1-mesen` / `rhlaunch1-mesen` spawn:

```
$MESEN_PATH [MESEN_ARGS...] <rom> --lua <generated.lua>
```

Default binary name: `Mesen`. Set `MESEN_PATH` to the Mesen **2** executable.

Lua lives in `src/lua/`:

- `mesen_input.lua` — Start button (`emu.setInput`). Override here if your build differs.
- `mesen_capture.lua` — on `startFrame`, if `$0100=$14` and `$71=0`, arm a one-shot `cpuExec` callback. That callback calls `emu.createSavestate()` (only legal from exec), writes a temp `mesen.mss`, dumps coprocessor RAM Lua can see, writes `done`. Fallback: `read32` dumps + `getState` whitelist if savestate fails.
- `mesen_apply.lua` — **one** `cpuExec`: `emu.loadSavestate` of a synthesized temp `.mss`, RAM poke if load fails, then `emu.setState` (bools + clocks + PPU/HDMA) and `emu.resetAccessCounters`. Emulation does not run guest instructions until the callback returns.

Node parses `mesen.mss` (`MSS` + zlib `key\0 size_le value`) into portable `.rhstate1` maps/sections and **deletes** the `.mss`. Launch synthesizes a new temp `.mss` from that portable file. Mesen keys and `.mss` blobs are never stored in RHSTATE1.

Dump directory (temp): `mesen.mss` (deleted after parse), `wram.bin` / coprocessor bins (fallback), `cpu.json`, `chips.json`, `meta.json`, `done`.

## Limits

- Capture is at an instruction boundary after `startFrame` (vblank-ish). Mid-scanline PPU shift registers / mid-DMA are not snapshotted.
- Synth `.mss` keys must match Mesen `NormalizeName` (e.g. `ppu.layers[0].tilemapAddress`, not `TilemapAddress`). Missing keys leave **boot** PPU/HDMA/clocks in place.
- DSP voice keys must match C++ widths (`int32` `envVolume`/`envMode`, `uint16` `brrOffset`, 24-byte `sampleBuffer`). Shorter values are ignored and voices stay silent.
- `emu.loadSavestate` from Lua does not fire `StateLoaded`, so uninit-read tracking stays on unless `resetAccessCounters` runs after `masterClock` is restored.
- Do not `setState` captured `spc.cycle` after load. Mesen `Spc::Run()` skips the APU when cycle ≥ masterClock×ratio−1; the stored counter is usually a few ticks ahead, and `UpdateClockRatio` only corrects gaps >20. Synth stores cycle 8 ticks behind; apply snaps with a Lua integer (floats are ignored for uint64).
- Synth must include `spc.clockRatio` (IEEE double), `spc.internalSpeed`/`externalSpeed` (0 is valid), and DSP mixer latches. If `dsp_state` is missing, launch infers them from the 128-byte `dsp` section.
- Apply overlays ARAM after load and checks a canary (`$1015`). `write32` pcall success is not proof — boot IPL in ARAM looks like “no programming.”
- One-frame HDMA/audio hitch is acceptable if Mesen fills scheduler internals with defaults (same as s9x_mss).
- `--level` on an `in_level` capture only pokes `$13BF` / `$0F`; it does not re-run level init.
- `--out` is a `rhboot1-sfc` flag (WRAM + reset stub). `rhlaunch1-mesen` rejects it.

If `--lua` is rejected, pass the equivalent via `MESEN_ARGS` and file a note; the Node waiter only needs `done` in the dump dir.

Required: Mesen 2 Lua with `emu.addMemoryCallback` / `callbackType.exec` / `createSavestate` / `loadSavestate`. `emu.read` / `emu.memType.snesWorkRam` remain the fallback path.
