import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeRhState1 } from '../src/rhstate1/codec.ts';
import { assertBizhawkStateZip, fakeMercuryHeader, identifyNativeState } from '../src/export/identify.ts';
import { refuseCrossCoreOut } from '../src/export/playback.ts';
import { zipStoreFiles } from '../src/export/zip-store.ts';
import { bizhawkLooksPresent } from '../src/export/bizhawk.ts';
import { makeFixtureRom, makeState, runRhexecCli } from './helpers.ts';

test('rhstate1-bizhawk --help', () => {
  const r = runRhexecCli('rhstate1-bizhawk.ts', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /BIZHAWK_PATH/);
});

test('BizHawk zip has BizState 1.0 and Core', () => {
  const zip = zipStoreFiles([
    { name: 'BizState 1.0', data: Buffer.from('placeholder') },
    { name: 'Core', data: Buffer.from('not-a-real-waterbox-heap') },
    { name: 'Framebuffer', data: Buffer.from([0]) },
  ]);
  const names = assertBizhawkStateZip(zip);
  assert.ok(names.includes('BizState 1.0'));
  assert.ok(names.includes('Core'));
  assert.equal(identifyNativeState(zip), 'bizhawk');
});

test('rhstate1-bizhawk refuses raw BST1 (and mercury names)', () => {
  const bst = fakeMercuryHeader('balanced');
  assert.throws(() => assertBizhawkStateZip(bst), /BST1/);
  assert.throws(() => refuseCrossCoreOut('bizhawk', 'game.mercury.state'), /mercury name/);
});

function liveBizhawkSkip(): false | string {
  if (!bizhawkLooksPresent()) return 'BIZHAWK_PATH is unset or the file is missing';
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return 'no DISPLAY/WAYLAND_DISPLAY for EmuHawk';
  }
  return false;
}

test('rhstate1-bizhawk live zip has BizState 1.0', { skip: liveBizhawkSkip() }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-bizhawk-live-'));
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  const rom = join(dir, 'game.sfc');
  const state = join(dir, 'game.rhstate1');
  const out = join(dir, 'game.bizhawk.state');
  writeFileSync(rom, makeFixtureRom());
  writeFileSync(state, encodeRhState1(makeState(wram)));
  const r = runRhexecCli('rhstate1-bizhawk.ts', ['--rom', rom, '--state', state, '--out', out, '--timeout-sec', '90']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  assertBizhawkStateZip(readFileSync(out));
});
