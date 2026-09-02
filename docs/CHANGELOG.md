# Changelog

- **0.2.2:** Mesen launch: match Serializer key casing (`tilemapAddress`, `srcAddress`, `hscroll`, …), restore master/H clocks, and `emu.setState` + `resetAccessCounters` after load so HDMA/NMI run and uninit-read floods stop. Recapture `.rhstate1` (old files dropped PPU layer / DMA channel fields).
- **0.2.1:** Capture Lua: coerce Mesen `getState` booleans (fix `math.floor` crash), one-shot `cpuExec` so a Lua error cannot run on every instruction, defer fallback RAM dumps to `startFrame`, `emu.stop` instead of debugger `breakExecution`.
- **0.2.0:** Full Mesen restore: capture via temp `.mss` on `cpuExec`, portable RHSTATE1 (FillRAM, WAI/IRQ flags, WRAM port, DSP voices, coprocessors). `rhlaunch1-mesen` synthesizes a throwaway `.mss` and `loadSavestate` in one callback (no WRAM-only poke on a cold boot). `--out` belongs to `rhboot1-sfc`.
- **0.1.0:** Initial PoC: `.rhstate1` (magic + MessagePack, raw/rle0 sections), `rhcap1-mesen` (auto/manual), `rhboot1-sfc`, `rhcheat1-yml`, `rhlaunch1-mesen`. Tests without live Mesen.
