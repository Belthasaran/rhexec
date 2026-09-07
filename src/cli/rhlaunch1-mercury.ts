#!/usr/bin/env -S node --import tsx
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parsePlaybackArgs, wantHelp } from './args.ts';
import { loadMutatedState } from '../export/playback.ts';
import {
  buildMercuryLaunchArgs,
  resolveMercuryCore,
  resolveRetroarchPath,
  serializeRhState1ViaCore,
  writeMercuryAutoLoadBundle,
} from '../export/mercury.ts';

const HELP = `rhlaunch1-mercury - launch original ROM in RetroArch mercury and auto-load a temp BST

Usage:
  rhlaunch1-mercury --rom <file.sfc> --state <file.rhstate1> [mutations]

Options:
  --rom PATH           Original SFC (not a boot-restore ROM in the player's hands)
  --state PATH         .rhstate1 capture
  --level HEX          Mutate translevel ($13BF / $0F) before serialize
  --ow-submap N --ow-x N --ow-y N
  --max-frames N       retro_run cap while printing the BST (default 600)
  --skip-verify        Do not retro_unserialize against the original ROM
  --help, -h

--out is not supported (this stays in RetroArch). A throwaway BST is written
into a private savestate_directory and savestate_auto_load loads slot 0.
The player never picks Load State. The boot SFC is only used offline to print
the blob (libretro cannot poke CPU over SNI/NCI).

SNI is post-entry RAM only. After auto-load, poll $7E0100 before RAM tools.

Environment:
  RETROARCH_PATH       retroarch / retroarch.exe
  MERCURY_CORE         bsnes_mercury_balanced_libretro.so / .dll
  PYTHON / PYTHON3     python3 for scripts/lr_serialize.py
`;

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv, [
    { name: '--max-frames', hasValue: true },
    { name: '--skip-verify' },
  ]);
  if (p.out) {
    throw new Error('--out is a rhstate1-mercury flag; rhlaunch1-mercury stays in RetroArch');
  }
  const { rom, st } = loadMutatedState(p);
  const ra = resolveRetroarchPath();
  if (!ra) throw new Error('RETROARCH_PATH is unset or the file is missing');
  const core = resolveMercuryCore();
  if (!core) {
    throw new Error('MERCURY_CORE is unset and no bsnes_mercury_balanced_libretro core was found');
  }
  const maxFramesFlag = p.extra['--max-frames'] != null ? Number(p.extra['--max-frames']) : 600;
  const maxFrames = Number.isFinite(maxFramesFlag) && maxFramesFlag > 0 ? maxFramesFlag : 600;
  const skipVerify = Boolean(p.extra['--skip-verify']);
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-mercury-'));
  const bstPath = join(dir, 'core.bst');
  const ser = serializeRhState1ViaCore({
    romPath: rom,
    st,
    out: bstPath,
    maxFrames,
    skipVerify,
  });
  if (ser.stdout) process.stdout.write(ser.stdout);
  if (ser.stderr) process.stderr.write(ser.stderr);
  const bundle = writeMercuryAutoLoadBundle({
    dir,
    romPath: rom,
    bst: readFileSync(bstPath),
  });
  const child = spawn(ra, buildMercuryLaunchArgs({ cfgPath: bundle.cfgPath, core, rom }), {
    stdio: 'inherit',
    env: process.env,
  });
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
