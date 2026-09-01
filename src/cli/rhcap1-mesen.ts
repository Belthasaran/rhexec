#!/usr/bin/env -S node --import tsx
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs, wantHelp } from './args.ts';
import { writeCaptureScript } from '../capture/write-lua.ts';
import { spawnMesen } from '../capture/mesen-spawn.ts';
import { dumpDirToState } from '../capture/dump-to-state.ts';
import { encodeRhState1 } from '../rhstate1/codec.ts';
import { rhstate1OutPath } from '../rhstate1/rom-info.ts';
import type { CaptureMode, SectionEncoding } from '../rhstate1/types.ts';

const HELP = `rhcap1-mesen - capture SNES execution state with Mesen 2 into a .rhstate1 file

Usage:
  rhcap1-mesen --rom <file.sfc|file.smc> --mode auto|manual [options]

Options:
  --rom PATH         SFC/SMC to launch and capture (required)
  --mode MODE        auto (inject Start) or manual (wait for in-level) (required)
  --out PATH         Output .rhstate1 (default: ROM path with .rhstate1 extension)
  --zeros raw|rle0   Section encoding (default: raw, zip-friendly)
  --timeout-sec N    Give up after N seconds (default: 600 manual, 60 auto)
  --keep-dump        Leave the temp dump directory
  --help, -h         Show this help

Environment:
  MESEN_PATH         Mesen 2 binary (default: Mesen)
  MESEN_ARGS         Extra args prepended before the ROM
`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFlag(dir: string, timeoutMs: number): Promise<'ok' | 'timeout' | 'failed'> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(join(dir, 'done'))) return 'ok';
    if (existsSync(join(dir, 'failed'))) return 'failed';
    await sleep(250);
  }
  return 'timeout';
}

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const { flags } = parseArgs(argv, [
    { name: '--rom', hasValue: true },
    { name: '--mode', hasValue: true },
    { name: '--out', hasValue: true },
    { name: '--zeros', hasValue: true },
    { name: '--timeout-sec', hasValue: true },
    { name: '--keep-dump' },
  ]);
  const rom = flags['--rom'] as string | undefined;
  const mode = flags['--mode'] as CaptureMode | undefined;
  if (!rom) throw new Error('--rom is required');
  if (mode !== 'auto' && mode !== 'manual') throw new Error('--mode must be auto or manual');
  if (!existsSync(rom)) throw new Error(`ROM not found: ${rom}`);
  const zeros = ((flags['--zeros'] as string) || 'raw') as SectionEncoding;
  if (zeros !== 'raw' && zeros !== 'rle0') throw new Error('--zeros must be raw or rle0');
  const timeoutSec = flags['--timeout-sec']
    ? Number(flags['--timeout-sec'])
    : mode === 'auto' ? 60 : 600;
  const out = (flags['--out'] as string) || rhstate1OutPath(rom);
  const dumpDir = mkdtempSync(join(tmpdir(), 'rhcap1-'));
  const lua = writeCaptureScript(dumpDir, mode, timeoutSec);
  const romBuf = new Uint8Array(readFileSync(rom));
  const child = spawnMesen({ rom, lua });
  const result = await waitForFlag(dumpDir, timeoutSec * 1000 + 5000);
  if (child.exitCode == null) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
  if (result !== 'ok') {
    if (!flags['--keep-dump']) rmSync(dumpDir, { recursive: true, force: true });
    throw new Error(`capture ${result} (never reached in-level $0100=$14)`);
  }
  const state = dumpDirToState({ dumpDir, romBuf, mode });
  const packed = encodeRhState1(state, zeros);
  mkdirSync(dirname(out) || '.', { recursive: true });
  writeFileSync(out, packed);
  if (!flags['--keep-dump']) rmSync(dumpDir, { recursive: true, force: true });
  process.stdout.write(`wrote ${out} (${packed.length} bytes)\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (c) => process.exit(c),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  },
);
