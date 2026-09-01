# rhexec

Proof-of-concept **SNES execution-state** capture and playback. Standalone from the RHPlay Electron app: capture an unpatched ROM in Mesen 2 as `.rhstate1`, then materialize Technique A (boot-restore SFC), B (sd2snes YAML), or C (Mesen WRAM apply).

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

## Why this exists

`4lvno` hijacks SMW’s level loader. Some hacks checksum those sites and crash. These tools record state after a **normal** in-level entry and play it back without patching `$05D89B` / `$05DCDD`.
