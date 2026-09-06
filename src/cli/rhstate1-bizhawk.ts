#!/usr/bin/env -S node --import tsx
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parsePlaybackArgs, wantHelp } from './args.ts';
import { getSectionDecoded } from '../rhstate1/codec.ts';
import { defaultOutFromRom, loadMutatedState, refuseCrossCoreOut } from '../export/playback.ts';
import { assertBizhawkStateZip } from '../export/identify.ts';
import { resolveBizhawkPath, writeBizhawkApplyScript } from '../export/bizhawk.ts';

const HELP = `rhstate1-bizhawk - Technique C: materialize a BizHawk 2.11.1 BSNES .state zip

Usage:
  rhstate1-bizhawk --rom <file.sfc> --state <file.rhstate1> [--out file.state] [mutations]

Options:
  --rom PATH           Original SFC (loaded by EmuHawk; not a boot ROM)
  --state PATH         .rhstate1 capture
  --out PATH           Output zip (default: ROM basename + .bizhawk.state)
  --level HEX          Mutate translevel ($13BF / $0F) before Lua apply
  --ow-submap N --ow-x N --ow-y N
  --timeout-sec N      Kill EmuHawk after N seconds (default 120)
  --help, -h

Spawns pinned BizHawk BSNES (BIZHAWK_PATH = EmuHawk / EmuHawkMono.sh) with a Lua
applier that pokes WRAM/VRAM/CGRAM/OAM/APURAM + CPU regs, then savestate.save.
DMA/HDMA/PPU MMIO/DSP voices stay at whatever the core had at save time — not a
full Mesen MSS rewrite. Pin 2.11.1; a 2.10 Core lump will not load.

Environment:
  BIZHAWK_PATH
`;

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv, [{ name: '--timeout-sec', hasValue: true }]);
  const { rom, st } = loadMutatedState(p);
  const out = p.out || defaultOutFromRom(rom, '.bizhawk.state');
  refuseCrossCoreOut('bizhawk', out);
  const hawk = resolveBizhawkPath();
  if (!hawk) throw new Error('BIZHAWK_PATH is unset or the file is missing');
  const timeoutSec = p.extra['--timeout-sec'] ? Number(p.extra['--timeout-sec']) : 120;
  const wram = getSectionDecoded(st, 'wram');
  if (!wram) throw new Error('missing wram');
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-bizhawk-'));
  const lua = writeBizhawkApplyScript(dir, {
    outPath: out,
    wram,
    vram: getSectionDecoded(st, 'vram'),
    cgram: getSectionDecoded(st, 'cgram'),
    oam: getSectionDecoded(st, 'oam'),
    apuram: getSectionDecoded(st, 'spc_aram'),
    cpu: st.cpu,
  });
  const r = spawnSync(hawk, [`--lua=${lua}`, rom], {
    encoding: 'utf8',
    timeout: Math.max(5, timeoutSec) * 1000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, RHSTATE1_APPLY_DIR: dir, RHSTATE1_OUT: out },
  });
  if (r.error) {
    const err = r.error as NodeJS.ErrnoException;
    if (err.code === 'ETIMEDOUT') throw new Error('BizHawk timed out before savestate.save');
    throw r.error;
  }
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (!existsSync(out)) {
    throw new Error(`BizHawk exited ${r.status} without writing ${out}`);
  }
  const buf = readFileSync(out);
  assertBizhawkStateZip(buf);
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
