#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { parsePlaybackArgs, requireRomState, wantHelp } from './args.ts';
import { decodeRhState1 } from '../rhstate1/codec.ts';
import { buildParCodes, formatSd2snesYml } from '../cheat/yml.ts';

const HELP = `rhcheat1-yml - Technique B: sd2snes/FXPAK Pro Action Replay YAML from a .rhstate1

Usage:
  rhcheat1-yml --rom <file.sfc> --state <file.rhstate1> [--out file.yml] [mutations]

Options:
  --rom PATH           Used for default basename
  --state PATH         .rhstate1 (WRAM mutations; ROM bytes are not patched)
  --out PATH           Output yml (default: {romBasename}.yml)
  --level HEX          Translevel
  --ow-submap N --ow-x N --ow-y N
  --help, -h

Emits WRAM PAR codes only. Refuses Game Genie / $05D800–$05DE00 loader patches.
`;

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv);
  const { rom, state } = requireRomState(p);
  if (!existsSync(state)) throw new Error(`state not found: ${state}`);
  decodeRhState1(readFileSync(state));
  const codes = buildParCodes(
    {
      level: p.level,
      owHave: p.owHave,
      owSubmap: p.owSubmap,
      owX: p.owX,
      owY: p.owY,
    },
    { includeLuigi: false, autoEnter: false },
  );
  const name = 'RHPlay rhstate1 entry';
  const yml = formatSd2snesYml(name, codes, true);
  const base = basename(rom).replace(/\.(sfc|smc)$/i, '');
  const out = p.out || `${base}.yml`;
  writeFileSync(out, yml);
  process.stdout.write(`wrote ${out} (${codes.length} PAR codes)\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
