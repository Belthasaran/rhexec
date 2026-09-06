import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeRhState1 } from '../src/rhstate1/codec.ts';
import {
  assertMercuryCoreBlob,
  fakeMercuryHeader,
  identifyNativeState,
  parseMercuryHeader,
} from '../src/export/identify.ts';
import { refuseCrossCoreOut } from '../src/export/playback.ts';
import { zipStoreFiles } from '../src/export/zip-store.ts';
import { mercuryLooksPresent } from '../src/export/mercury.ts';
import { makeFixtureRom, makeState, runRhexecCli } from './helpers.ts';

test('rhstate1-mercury --help', () => {
  const r = runRhexecCli('rhstate1-mercury.ts', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /MERCURY_CORE/);
});

test('mercury higan-style header reads Balanced at offset 584', () => {
  const buf = Buffer.alloc(600);
  buf.write('BST1', 0);
  buf.writeUInt32LE(27, 4);
  buf.write('a'.repeat(64), 8);
  buf.write('Balanced', 584);
  assert.equal(parseMercuryHeader(buf).profile, 'balanced');
  assertMercuryCoreBlob(buf);
});

test('rhstate1-mercury refuses a BizHawk zip (and BizHawk names)', () => {
  const zip = zipStoreFiles([
    { name: 'BizState 1.0', data: Buffer.from('BizHawk') },
    { name: 'Core', data: Buffer.from('waterbox') },
  ]);
  assert.throws(() => assertMercuryCoreBlob(zip), /BizHawk ZIP/);
  assert.throws(() => refuseCrossCoreOut('mercury', 'game.bizhawk.state'), /BizHawk name/);
  assert.throws(() => assertMercuryCoreBlob(fakeMercuryHeader('accuracy')), /balanced/);
});

const liveSkip = mercuryLooksPresent() ? false : 'MERCURY_CORE is unset and no balanced mercury core was found';

test('rhstate1-mercury live serialize is BST1 + balanced', { skip: liveSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-mercury-live-'));
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  const rom = join(dir, 'game.sfc');
  const state = join(dir, 'game.rhstate1');
  const out = join(dir, 'game.mercury.state');
  writeFileSync(rom, makeFixtureRom());
  writeFileSync(state, encodeRhState1(makeState(wram)));
  const r = runRhexecCli('rhstate1-mercury.ts', [
    '--rom',
    rom,
    '--state',
    state,
    '--out',
    out,
    '--max-frames',
    '30',
    '--skip-verify',
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  const buf = readFileSync(out);
  const hdr = assertMercuryCoreBlob(buf);
  assert.equal(hdr.profile, 'balanced');
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'BST1');
});
