#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parsePlaybackArgs, requireRomState, wantHelp } from './args.ts';
import { decodeRhState1 } from '../rhstate1/codec.ts';
import { applyMutations } from '../rhstate1/apply.ts';
import { maybeDecode } from '../rhstate1/rle0.ts';
import { buildBootRestoreRom } from '../boot/boot-restore.ts';

const HELP = `rhboot1-sfc - Technique A: emit a new SFC with boot-restore stub (no loader hijacks)

Usage:
  rhboot1-sfc --rom <file.sfc> --state <file.rhstate1> [--out file.sfc] [mutations]

Options:
  --rom PATH           Original SFC/SMC
  --state PATH         .rhstate1 capture
  --out PATH           Output SFC (default: ROM basename + -boot.sfc)
  --level HEX          Mutate translevel ($13BF / $0F), e.g. 105
  --ow-submap N        Overworld submap 0-6
  --ow-x N             Tile X 0-31
  --ow-y N             Tile Y 0-31
  --help, -h

Does not patch $05D89B / $05DCDD. APU and SA-1 restore are omitted in this PoC.
`;

function defaultOut(rom: string): string {
  return rom.replace(/\.(sfc|smc)$/i, '') + '-boot.sfc';
}

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv);
  const { rom, state } = requireRomState(p);
  if (!existsSync(rom)) throw new Error(`ROM not found: ${rom}`);
  if (!existsSync(state)) throw new Error(`state not found: ${state}`);
  const st = decodeRhState1(readFileSync(state));
  applyMutations(st, {
    level: p.level,
    owHave: p.owHave,
    owSubmap: p.owSubmap,
    owX: p.owX,
    owY: p.owY,
  });
  const wram = st.sections.find((s) => s.id === 'wram');
  if (!wram) throw new Error('missing wram');
  const raw = maybeDecode(wram.data, wram.encoding);
  const built = buildBootRestoreRom(new Uint8Array(readFileSync(rom)), raw, st.cpu);
  const out = p.out || defaultOut(rom);
  writeFileSync(out, built.rom);
  process.stdout.write(`wrote ${out} (${built.rom.length} bytes)\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
