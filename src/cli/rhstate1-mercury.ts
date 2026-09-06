#!/usr/bin/env -S node --import tsx
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlaybackArgs, wantHelp } from './args.ts';
import { buildBootRestoreRom } from '../boot/boot-restore.ts';
import { defaultOutFromRom, loadMutatedState, refuseCrossCoreOut } from '../export/playback.ts';
import { assertMercuryCoreBlob } from '../export/identify.ts';
import { resolveMercuryCore, runMercurySerialize } from '../export/mercury.ts';

const HELP = `rhstate1-mercury - Technique C: serialize bsnes-mercury balanced after a boot restore

Usage:
  rhstate1-mercury --rom <file.sfc> --state <file.rhstate1> [--out file.state] [mutations]

Options:
  --rom PATH           Original SFC (verify unserialize; boot SFC is built internally)
  --state PATH         .rhstate1 capture
  --out PATH           Raw core blob (default: ROM basename + .mercury.state)
  --level HEX          Mutate translevel ($13BF / $0F) before boot-restore
  --ow-submap N --ow-x N --ow-y N
  --max-frames N       retro_run cap while waiting for in-level $0100 (default 600)
  --skip-verify        Do not retro_unserialize against the original ROM
  --help, -h

Libretro has no CPU-register poke. This CLI builds a Technique A boot SFC, loads it
in mercury balanced, waits until $7E0100 matches the capture, then retro_serialize.
The on-disk file is BST1 + profile "balanced" (current mercury writes "Balanced"), not a BizHawk zip.

If the boot SFC is larger than the original (ROM expansion) and unserialize fails,
the error tells you to keep the state paired with the boot SFC rather than crash.

Environment:
  MERCURY_CORE         bsnes_mercury_balanced_libretro.so / .dll
  RETROARCH_PATH       optional; cores/ next to the binary is searched
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
  const { rom, st } = loadMutatedState(p);
  const out = p.out || defaultOutFromRom(rom, '.mercury.state');
  refuseCrossCoreOut('mercury', out);
  const core = resolveMercuryCore();
  if (!core) throw new Error('MERCURY_CORE is unset and no bsnes_mercury_balanced_libretro core was found');
  const maxFramesFlag = p.extra['--max-frames'] != null ? Number(p.extra['--max-frames']) : 600;
  const maxFrames = Number.isFinite(maxFramesFlag) && maxFramesFlag > 0 ? maxFramesFlag : 600;
  const skipVerify = Boolean(p.extra['--skip-verify']);
  const original = new Uint8Array(readFileSync(rom));
  const built = buildBootRestoreRom(original, st);
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-mercury-'));
  const bootPath = join(dir, 'boot.sfc');
  writeFileSync(bootPath, built.rom);
  const gameMode = st.trigger?.game_mode ?? 0x14;
  const r = runMercurySerialize({
    core,
    rom: bootPath,
    out,
    systemDir: dir,
    saveDir: dir,
    waitWramU8: { addr: 0x0100, value: gameMode },
    maxFrames,
    verifyRom: skipVerify ? null : rom,
    timeoutMs: Math.max(30, maxFrames) * 50 + 15_000,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 2) {
    throw new Error((r.stderr || r.stdout || 'mercury unserialize failed').trim());
  }
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `lr_serialize exited ${r.status}`).trim());
  }
  if (!existsSync(out)) throw new Error(`mercury serialize did not write ${out}`);
  const buf = readFileSync(out);
  const hdr = assertMercuryCoreBlob(buf);
  process.stdout.write(`wrote ${out} (${buf.length} bytes, profile ${hdr.profile})\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
