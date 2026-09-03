# rhexec

Proof-of-concept **SNES execution-state** capture and playback. Standalone from the RHPlay Electron app: capture an unpatched ROM in Mesen 2 as portable `.rhstate1`, then materialize Technique A (boot-restore SFC), B (sd2snes YAML), or C (atomic Mesen `loadSavestate`).

## Setup

```bash
cd rhexec
npm install
```

Requires Node 20+. Capture/launch need **Mesen 2** (`MESEN_PATH`).

## CLIs

```bash
npm run rhcap1-mesen -- --rom game.sfc --mode manual
npm run rhcap1-mesen -- --rom game.sfc --mode auto --zeros rle0
npm run rhboot1-sfc -- --rom game.sfc --state game.rhstate1 --out game-boot.sfc --level 105
npm run rhcheat1-yml -- --rom game.sfc --state game.rhstate1 --ow-submap 1 --ow-x 6 --ow-y 7
npm run rhlaunch1-mesen -- --rom game.sfc --state game.rhstate1 --level 105
```

Each tool supports `--help`. See [docs/PROGRAMS.md](docs/PROGRAMS.md) and [docs/RHSTATE1.md](docs/RHSTATE1.md).

## Tests

```bash
npm test
```

Live Mesen capture is skipped unless `MESEN_PATH` points at a real binary.

The boot-restore NMI probe (`tests/rhboot1_headless_nmi_probe.test.ts`) also needs `SMW_SFC_PATH`, `flips` (`FLIPS_PATH` or PATH), and `MESEN_ARGS` for Mesen's headless flag. Akogare 1.21 SFC is prepared at runtime via neighboring RHPlay `fetchpatches.js` (gameid 18612); BPS/SFC sha256 pins must match v1.21. Kaizoff is not used for 18612.

## Why this exists

`4lvno` hijacks SMW’s level loader. Some hacks have customized load procs and crash. These tools record state after a **normal** in-level entry and play it back without patching `$05D89B` / `$05DCDD`.
