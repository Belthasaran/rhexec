#!/usr/bin/env -S node --import tsx
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlaybackArgs, requireRomState, wantHelp } from './args.ts';
import { decodeRhState1, getSectionDecoded } from '../rhstate1/codec.ts';
import { applyMutations } from '../rhstate1/apply.ts';
import { writeApplyScript } from '../capture/write-lua.ts';
import { spawnMesen } from '../capture/mesen-spawn.ts';
import { encodePortableAsMss, portableToSetState, setStateToLua } from '../players/mesen-state-map.ts';

const HELP = `rhlaunch1-mesen - Technique C: launch Mesen and restore .rhstate1 atomically

Usage:
  rhlaunch1-mesen --rom <file.sfc> --state <file.rhstate1> [mutations]

Options:
  --rom PATH           Original SFC/SMC
  --state PATH         .rhstate1
  --level HEX          Mutate translevel ($13BF / $0F) before restore
  --ow-submap N --ow-x N --ow-y N
  --help, -h

--out is not supported here; use rhboot1-sfc to emit a patched SFC
(WRAM + reset stub only). This command synthesizes a throwaway Mesen
.mss and loadSavestate in one cpuExec callback.

Environment:
  MESEN_PATH, MESEN_ARGS
`;

function writeBin(dir: string, name: string, data: Uint8Array | null): string | null {
  if (!data) return null;
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

async function main(argv: string[]): Promise<number> {
  if (wantHelp(argv) || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const p = parsePlaybackArgs(argv);
  if (p.out) {
    throw new Error('--out is a rhboot1-sfc flag; rhlaunch1-mesen restores via Mesen loadSavestate');
  }
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
  if (!getSectionDecoded(st, 'vram') || !st.spc || !st.ppu) {
    process.stderr.write('warning: state is missing vram/spc/ppu; recapture with rhcap1-mesen for a full restore\n');
  }
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-'));
  const mssPath = join(dir, 'mesen.mss');
  writeFileSync(mssPath, encodePortableAsMss(st, basename(rom)));
  const lua = writeApplyScript(dir, {
    mssPath,
    wramPath: writeBin(dir, 'wram.bin', wram),
    vramPath: writeBin(dir, 'vram.bin', getSectionDecoded(st, 'vram')),
    cgramPath: writeBin(dir, 'cgram.bin', getSectionDecoded(st, 'cgram')),
    oamPath: writeBin(dir, 'oam.bin', getSectionDecoded(st, 'oam')),
    sramPath: writeBin(dir, 'sram.bin', getSectionDecoded(st, 'sram')),
    spcPath: writeBin(dir, 'spc_aram.bin', getSectionDecoded(st, 'spc_aram')),
    dspPath: writeBin(dir, 'dsp.bin', getSectionDecoded(st, 'dsp')),
    sa1IramPath: writeBin(dir, 'sa1_iram.bin', getSectionDecoded(st, 'sa1_iram')),
    fillramPath: writeBin(dir, 'fillram.bin', getSectionDecoded(st, 'fillram')),
    cpuPath: join(dir, 'cpu.json'),
    setStateLua: setStateToLua(portableToSetState(st)),
  });
  writeFileSync(join(dir, 'cpu.json'), JSON.stringify(st.cpu));
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
