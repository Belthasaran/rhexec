#!/usr/bin/env -S node --import tsx
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlaybackArgs, requireRomState, wantHelp } from './args.ts';
import { decodeRhState1, getSectionDecoded } from '../rhstate1/codec.ts';
import { applyMutations } from '../rhstate1/apply.ts';
import { writeApplyScript } from '../capture/write-lua.ts';
import { spawnMesen } from '../capture/mesen-spawn.ts';

const HELP = `rhlaunch1-mesen - Technique C: launch Mesen on the original ROM and apply .rhstate1 WRAM

Usage:
  rhlaunch1-mesen --rom <file.sfc> --state <file.rhstate1> [mutations]

Options:
  --rom PATH           Original SFC/SMC
  --state PATH         .rhstate1
  --level HEX          Mutate translevel before apply
  --ow-submap N --ow-x N --ow-y N
  --help, -h

Environment:
  MESEN_PATH, MESEN_ARGS
`;

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
  const wram = getSectionDecoded(st, 'wram');
  if (!wram) throw new Error('missing wram');
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-'));
  const wramPath = join(dir, 'wram.bin');
  const cpuPath = join(dir, 'cpu.json');
  writeFileSync(wramPath, wram);
  writeFileSync(cpuPath, JSON.stringify(st.cpu));
  const lua = writeApplyScript(dir, wramPath, cpuPath);
  const child = spawnMesen({ rom, lua });
  const code: number = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c ?? 0));
  });
  return code;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
