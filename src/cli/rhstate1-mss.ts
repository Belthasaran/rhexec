#!/usr/bin/env -S node --import tsx
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePlaybackArgs, wantHelp } from './args.ts';
import { encodePortableAsMss } from '../players/mesen-state-map.ts';
import { defaultOutFromRom, loadMutatedState, refuseCrossCoreOut } from '../export/playback.ts';
import { assertMssFile } from '../export/identify.ts';

const HELP = `rhstate1-mss - Technique C: write a Mesen 2 .mss from .rhstate1 (no Mesen process)

Usage:
  rhstate1-mss --rom <file.sfc> --state <file.rhstate1> [--out file.mss] [mutations]

Options:
  --rom PATH           Original SFC/SMC (used for the MSS ROM name)
  --state PATH         .rhstate1 capture
  --out PATH           Output .mss (default: ROM basename + .mss)
  --level HEX          Mutate translevel ($13BF / $0F) before encode
  --ow-submap N --ow-x N --ow-y N
  --help, -h

Synthesizes MSS magic / format 4 in-process via encodePortableAsMss.
Does not launch Mesen (see rhlaunch1-mesen). Mutations stay on RHSTATE1 WRAM.
`;

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv);
  const { rom, st } = loadMutatedState(p);
  const out = p.out || defaultOutFromRom(rom, '.mss');
  refuseCrossCoreOut('mss', out);
  const buf = encodePortableAsMss(st, basename(rom));
  assertMssFile(buf);
  writeFileSync(out, buf);
  process.stdout.write(`wrote ${out} (${buf.length} bytes)\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
