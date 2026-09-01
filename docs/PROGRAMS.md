# Programs

All commands from `rhexec/` after `npm install`. Node 20+. `--help` on every CLI.

Environment: `MESEN_PATH` (Mesen 2 binary, default `Mesen`), `MESEN_ARGS` (extra spawn args).

---

### rhcap1-mesen

Capture in-level SNES state with Mesen 2 → `.rhstate1`.

```bash
npm run rhcap1-mesen -- --rom <file.sfc|file.smc> --mode auto|manual [--out path] [--zeros raw|rle0] [--timeout-sec N]
```

- **manual**: launch, wait until `$0100=$14` (in-level). Default timeout 600s.
- **auto**: inject Start at frames ~60/120/300, then wait for in-level. Default timeout 60s.
- Default `--out`: same path as the ROM with extension `.rhstate1`.

---

### rhboot1-sfc

Technique A: new SFC with reset trampoline + WRAM payload. Does not patch `$05D89B`/`$05DCDD`.

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

Technique C: launch original ROM in Mesen and apply mutated WRAM from `.rhstate1`.

```bash
npm run rhlaunch1-mesen -- --rom <sfc> --state <rhstate1> [--level HEX] [--ow-submap N --ow-x N --ow-y N]
```
