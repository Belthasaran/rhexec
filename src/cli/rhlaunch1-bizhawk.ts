#!/usr/bin/env -S node --import tsx
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { parsePlaybackArgs, wantHelp } from './args.ts';
import { getSectionDecoded } from '../rhstate1/codec.ts';
import { loadMutatedState } from '../export/playback.ts';
import { resolveBizhawkPath, writeBizhawkLaunchScript } from '../export/bizhawk.ts';

const HELP = `rhlaunch1-bizhawk - launch original ROM in BizHawk 2.11.1 BSNES and restore .rhstate1

Usage:
  rhlaunch1-bizhawk --rom <file.sfc> --state <file.rhstate1> [mutations] [--connector Connector.lua]

Options:
  --rom PATH           Original SFC (not a boot-restore ROM)
  --state PATH         .rhstate1 capture
  --level HEX          Mutate translevel ($13BF / $0F) before poke
  --ow-submap N --ow-x N --ow-y N
  --connector PATH     After restore, dofile SNI Connector.lua (LuaBridge)
  --help, -h

--out is not supported (this stays in the emulator). Lua pauses, pokes
WRAM/VRAM/CGRAM/OAM/APURAM + CPU, then unpauses. DMA/HDMA/PPU MMIO/DSP
stay at cold-boot unless later Lua APIs appear. SNI is attached after
the poke, not used as the restore bus.

Environment:
  BIZHAWK_PATH         EmuHawk / EmuHawkMono.sh
`;

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv, [{ name: '--connector', hasValue: true }]);
  if (p.out) {
    throw new Error('--out is a rhstate1-bizhawk flag; rhlaunch1-bizhawk stays in the emulator');
  }
  const { rom, st } = loadMutatedState(p);
  const hawk = resolveBizhawkPath();
  if (!hawk) throw new Error('BIZHAWK_PATH is unset or the file is missing');
  const wram = getSectionDecoded(st, 'wram');
  if (!wram) throw new Error('missing wram');
  const connector = typeof p.extra['--connector'] === 'string' ? p.extra['--connector'] : null;
  if (connector && !existsSync(connector)) throw new Error(`Connector.lua not found: ${connector}`);
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-bizhawk-'));
  const lua = writeBizhawkLaunchScript(dir, {
    wram,
    vram: getSectionDecoded(st, 'vram'),
    cgram: getSectionDecoded(st, 'cgram'),
    oam: getSectionDecoded(st, 'oam'),
    apuram: getSectionDecoded(st, 'spc_aram'),
    cpu: st.cpu,
    connectorPath: connector,
  });
  const cwd = connector ? dirname(connector) : undefined;
  const child = spawn(hawk, [`--lua=${lua}`, rom], {
    stdio: 'inherit',
    cwd,
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
