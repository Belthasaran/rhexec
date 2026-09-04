# Programs

All commands from `rhexec/` after `npm install`. Node 20+. `--help` on every CLI.

Environment: `MESEN_PATH` (Mesen 2 binary, default `Mesen`), `MESEN_ARGS` (extra spawn args; put the headless flag here for the NMI probe), `SMW_SFC_PATH` (unheadered SMW for flips), `FLIPS_PATH` (optional; otherwise `flips` on PATH), `RHPLAY_ROOT` (optional neighbor tree for `fetchpatches.js`).

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

Technique A: new SFC with reset trampoline plus WRAM/VRAM/CGRAM/OAM/ARAM payload. Re-enables NMI (`$4200`) and unblanks INIDISP. SPC IPL plants a copier at `$FF80`, then the copier copies `$0000–$FF7F` (handshake tracks copier X, skip 0 after wrap, skip page0 `$F0–$FF`) and `JMP`s `$0386`. The trampoline restores CONTROL/DP/`$F8–$FC`, copies DSP regs, write-triggers KON from captured ENVX, signals `$F4=$A5`, arms N-SPC `$02`/`$06` from `$0DDA`, zeros flags `$0386–$0389`, then `JMP`s the timer wait. The SNES waits for that `$A5` before `$4200` and holds the song id on `$2142` (`$1DFB`/`$1DFF` stay 0 so AMK NMI cannot clobber it). No-`$AA` skip jumps IPL to STOP at `$0386`. Does not patch `$05D89B`/`$05DCDD`. SA-1 is not restored.

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
