# Programs

All commands from `rhexec/` after `npm install`. Node 20+. `--help` on every CLI.

Environment: `MESEN_PATH` (Mesen 2 binary, default `Mesen`), `MESEN_ARGS` (extra spawn args; put the headless flag here for the NMI probe), `SMW_SFC_PATH` (unheadered SMW for flips), `FLIPS_PATH` (optional; otherwise `flips` on PATH), `RHPLAY_ROOT` (optional neighbor tree for `fetchpatches.js`), `BIZHAWK_PATH` (EmuHawk / `EmuHawkMono.sh` for `rhstate1-bizhawk`), `MERCURY_CORE` (`bsnes_mercury_balanced_libretro.so` / `.dll` for `rhstate1-mercury`), `RETROARCH_PATH` (optional core search), `PYTHON` / `PYTHON3`.

`npm test` includes a live headless probe that builds `rhboot1-sfc` for Akogare 1.21 and fails if `$7E0010` stays 0. Skipped when Mesen, `SMW_SFC_PATH`, or `flips` is missing. Source SFC is fetched like `lmlevelinfo/test/get_hack.sh` (not Kaizoff; that catalog BPS is older than 1.21).

---

### rhcap1-mesen

Capture in-level SNES state with Mesen 2 → portable `.rhstate1`.

On in-level (`$0100=$14`, `$71=0`) a one-shot `cpuExec` writes a temp Mesen `.mss`, which Node maps into hardware maps/sections and deletes.

```bash
npm run rhcap1-mesen -- --rom <file.sfc|file.smc> --mode auto|manual [--out path] [--zeros raw|rle0] [--timeout-sec N]
```

- **manual**: launch, wait until `$0100=$14` (in-level). Default timeout 600s.
- **auto**: inject Start at frames ~60/120/300, then wait for in-level. Default timeout 60s.
- Default `--out`: same path as the ROM with extension `.rhstate1`.

---

### rhboot1-sfc

Technique A: new SFC with reset trampoline plus WRAM/VRAM/CGRAM/OAM/ARAM payload. Re-enables NMI (`$4200`) and unblanks INIDISP. SPC IPL plants a copier at `$FF80`, then the copier copies `$0000–$FF7F` (handshake tracks copier X, skip 0 after wrap, skip page0 `$F0–$FF`) and `JMP`s the resume trampoline (`$0386` when that hole is long enough, else a captured ARAM zero run). N-SPC `$02`/`$06` / `$2142` hold only when ARAM has the timer-wait opcode. Does not patch `$05D89B`/`$05DCDD`. SA-1 is not restored. 4MB LoROM packs the stub into unused `$01–$7D` padding (FastROM `$80:8000` is a bank-0 mirror).

```bash
npm run rhboot1-sfc -- --rom <sfc> --state <rhstate1> [--out file-boot.sfc] [--level HEX] [--ow-submap N --ow-x N --ow-y N]
```

---

### rhcheat1-yml

Technique B: sd2snes/FXPAK YAML (WRAM PAR only).

```bash
npm run rhcheat1-yml -- --rom <sfc> --state <rhstate1> [--out basename.yml] [--level HEX] [--ow-submap N --ow-x N --ow-y N]
```

---

### rhlaunch1-mesen

Technique C: launch the original ROM in Mesen and restore CPU/PPU/SPC/WRAM from `.rhstate1` in **one** `cpuExec` (`loadSavestate` of a throwaway `.mss`, ARAM overlay with canary, then `setState` for clocks/HDMA). `--out` is not accepted (use `rhboot1-sfc`).

```bash
npm run rhlaunch1-mesen -- --rom <sfc> --state <rhstate1> [--level HEX] [--ow-submap N --ow-x N --ow-y N]
```

---

### rhstate1-mss

Technique C: write a Mesen 2 `.mss` from `.rhstate1` in-process (`encodePortableAsMss`, MSS magic / format 4). No Mesen process. Same mutation flags as `rhboot1-sfc`.

```bash
npm run rhstate1-mss -- --rom <sfc> --state <rhstate1> [--out game.mss] [--level HEX] [--ow-submap N --ow-x N --ow-y N]
```

Default `--out`: ROM basename + `.mss`. Load in Mesen with File → Load State. `rhlaunch1-mesen` stays a launcher and still rejects `--out`.

---

### rhstate1-bizhawk

Technique C: spawn BizHawk **2.11.1 BSNES** and print a native `.state` zip. Lua writes WRAM/VRAM/CGRAM/OAM/APURAM + CPU regs, then `savestate.save`. DMA/HDMA/PPU MMIO/DSP voices stay at save-time unless 2.11.1 Lua exposes more — weaker than a full Mesen MSS. Refuses mercury BST1 / mercury filenames.

```bash
npm run rhstate1-bizhawk -- --rom <sfc> --state <rhstate1> [--out game.bizhawk.state] [--level HEX]
```

Environment: `BIZHAWK_PATH`. Load with `EmuHawk --load-state=<path>`. Live tests skip without it.

---

### rhstate1-mercury

Technique C: serialize **bsnes-mercury balanced** after a Technique A boot-restore SFC (`scripts/lr_serialize.py` `dlopen`s the core; RetroArch GUI is not required). Waits for `$7E0100` then `retro_serialize`. Output is a raw BST1 blob with profile `balanced`, not a BizHawk zip. Then `retro_unserialize` against the **original** ROM; if the boot SFC was expanded and size mismatches, the CLI fails instead of a silent mercury crash — keep that state paired with the boot SFC. Not snes9x.

```bash
npm run rhstate1-mercury -- --rom <sfc> --state <rhstate1> [--out game.mercury.state] [--level HEX] [--max-frames N] [--skip-verify]
```

Environment: `MERCURY_CORE`, optional `RETROARCH_PATH`. Live tests skip without the core. RetroArch slot / `savestate_auto_load` beside the ROM is a later Electron wiring step.
