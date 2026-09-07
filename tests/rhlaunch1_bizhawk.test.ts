import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeRhState1 } from '../src/rhstate1/codec.ts';
import { writeBizhawkApplyScript, writeBizhawkLaunchScript } from '../src/export/bizhawk.ts';
import { makeFixtureRom, makeState, runRhexecCli } from './helpers.ts';

test('rhlaunch1-bizhawk --help', () => {
  const r = runRhexecCli('rhlaunch1-bizhawk.ts', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /BIZHAWK_PATH/);
  assert.match(r.stdout, /--connector/);
});

test('rhlaunch1-bizhawk rejects --out', () => {
  const r = runRhexecCli('rhlaunch1-bizhawk.ts', ['--out', 'game.state']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--out is a rhstate1-bizhawk flag/);
});

test('rhlaunch1-bizhawk Lua pauses, pokes, unpauses; no save/exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-bizhawk-lua-'));
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  const cpu = makeState(wram).cpu;
  const lua = writeBizhawkLaunchScript(dir, { wram, cpu });
  const body = readFileSync(lua, 'utf8');
  const pauseAt = body.indexOf('client.pause()');
  const pokeAt = body.indexOf('memory.writebyte');
  const unpauseAt = body.indexOf('client.unpause()');
  assert.ok(pauseAt >= 0);
  assert.ok(pokeAt > pauseAt);
  assert.ok(unpauseAt > pokeAt);
  assert.match(body, /emu\.setregister/);
  assert.match(body, /CONNECTOR_PATH = nil/);
  assert.doesNotMatch(body, /savestate\.save/);
  assert.doesNotMatch(body, /client\.exit\(\)/);
});

test('rhlaunch1-bizhawk --connector dofiles Connector.lua after unpause', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-bizhawk-conn-'));
  const connector = join(dir, 'Connector.lua');
  writeFileSync(connector, '-- dummy SNI Connector\n');
  const wram = new Uint8Array(16);
  const lua = writeBizhawkLaunchScript(dir, {
    wram,
    cpu: makeState(wram).cpu,
    connectorPath: connector,
  });
  const body = readFileSync(lua, 'utf8');
  const unpauseAt = body.indexOf('client.unpause()');
  const dofileAt = body.indexOf('dofile(CONNECTOR_PATH)');
  assert.ok(unpauseAt >= 0);
  assert.ok(dofileAt > unpauseAt);
  assert.match(body, /CONNECTOR_PATH = /);
});

test('rhstate1-bizhawk apply Lua still pokes then savestate.save', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-bizhawk-apply-lua-'));
  const wram = new Uint8Array(16);
  const lua = writeBizhawkApplyScript(dir, {
    wram,
    cpu: makeState(wram).cpu,
    outPath: join(dir, 'out.state'),
  });
  const body = readFileSync(lua, 'utf8');
  const pokeAt = body.indexOf('memory.writebyte');
  const saveAt = body.indexOf('savestate.save');
  assert.ok(pokeAt >= 0);
  assert.ok(saveAt > pokeAt);
  assert.match(body, /client\.exit\(\)/);
  assert.doesNotMatch(body, /client\.pause\(\)/);
});

test('rhlaunch1-bizhawk does not spawn without BIZHAWK_PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-bizhawk-nospawn-'));
  const rom = join(dir, 'game.sfc');
  const state = join(dir, 'game.rhstate1');
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  writeFileSync(rom, makeFixtureRom());
  writeFileSync(state, encodeRhState1(makeState(wram)));
  const r = runRhexecCli('rhlaunch1-bizhawk.ts', ['--rom', rom, '--state', state], { BIZHAWK_PATH: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /BIZHAWK_PATH/);
});
