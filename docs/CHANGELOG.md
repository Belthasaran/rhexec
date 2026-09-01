# Changelog

- **0.2.0:** Full Mesen restore: capture via temp `.mss` on `cpuExec`, portable RHSTATE1 (FillRAM, WAI/IRQ flags, WRAM port, DSP voices, coprocessors). `rhlaunch1-mesen` synthesizes a throwaway `.mss` and `loadSavestate` in one callback (no WRAM-only poke on a cold boot). `--out` belongs to `rhboot1-sfc`.
- **0.1.0:** Initial PoC: `.rhstate1` (magic + MessagePack, raw/rle0 sections), `rhcap1-mesen` (auto/manual), `rhboot1-sfc`, `rhcheat1-yml`, `rhlaunch1-mesen`. Tests without live Mesen.
