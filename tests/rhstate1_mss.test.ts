import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeRhState1 } from '../src/rhstate1/codec.ts';
import { translevelBytes } from '../src/rhstate1/mutate.ts';
import { parseMss, mssGet, MSS_FMT_VERSION, MSS_CONSOLE_SNES } from '../src/players/mss-format.ts';
import { makeFixtureRom, makeState, runRhexecCli } from './helpers.ts';

function fixtureFiles(): { dir: string; rom: string; state: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-mss-'));
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  wram[0x13bf] = 0x05;
  const rom = join(dir, 'game.sfc');
  const state = join(dir, 'game.rhstate1');
  writeFileSync(rom, makeFixtureRom());
  writeFileSync(state, encodeRhState1(makeState(wram)));
  return { dir, rom, state };
}

test('rhstate1-mss --help', () => {
  const r = runRhexecCli('rhstate1-mss.ts', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /--rom/);
});

test('rhstate1-mss writes MSS magic, SNES console, and WRAM', () => {
  const { dir, rom, state } = fixtureFiles();
  const out = join(dir, 'game.mss');
  const r = runRhexecCli('rhstate1-mss.ts', ['--rom', rom, '--state', state, '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const buf = readFileSync(out);
  assert.equal(buf.subarray(0, 3).toString('ascii'), 'MSS');
  const mss = parseMss(buf);
  assert.equal(mss.fmtVersion, MSS_FMT_VERSION);
  assert.equal(mss.consoleType, MSS_CONSOLE_SNES);
  const wram = mssGet(mss, 'memoryManager.workRam');
  assert.ok(wram);
  assert.ok(wram.length >= 0x13c0);
  assert.equal(wram[0x13bf], 0x05);
});

test('rhstate1-mss --level mutates $13BF inside the MSS', () => {
  const { dir, rom, state } = fixtureFiles();
  const out = join(dir, 'mut.mss');
  const r = runRhexecCli('rhstate1-mss.ts', ['--rom', rom, '--state', state, '--out', out, '--level', '105']);
  assert.equal(r.status, 0, r.stderr);
  const mss = parseMss(readFileSync(out));
  const wram = mssGet(mss, 'memoryManager.workRam');
  assert.ok(wram);
  assert.equal(wram[0x13bf], translevelBytes(0x105).anumber);
});
