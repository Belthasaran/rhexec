# Mesen 2 capture (PoC)

`rhcap1-mesen` spawns:

```
$MESEN_PATH [MESEN_ARGS...] <rom> --lua <generated.lua>
```

Default binary name: `Mesen`. Set `MESEN_PATH` to the Mesen **2** executable (not Mesen-S unless the Lua API matches).

Lua lives in `src/lua/`:

- `mesen_input.lua` — Start button (`emu.setInput`). Override here if your build differs.
- `mesen_capture.lua` — poll `$0100==$14` and `$71==0`, dump WRAM/VRAM/…, write `done`, `emu.stop`.
- `mesen_apply.lua` — Technique C WRAM write.

Dump directory (temp): `wram.bin`, `cpu.json`, `meta.json`, `done`. Node packs these into `.rhstate1`.

If `--lua` is rejected, pass the equivalent via `MESEN_ARGS` and file a note; the Node waiter only needs `done` in the dump dir.

Required for PoC: Mesen 2 Lua with `emu.read` / `emu.addEventCallback` / `emu.memType.snesWorkRam` (fallbacks included).
