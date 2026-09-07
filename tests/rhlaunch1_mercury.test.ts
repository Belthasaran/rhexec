import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeRhState1 } from '../src/rhstate1/codec.ts';
import { assertMercuryCoreBlob, fakeMercuryHeader } from '../src/export/identify.ts';
import {
  buildMercuryLaunchArgs,
  mercuryAutoLoadCfg,
  mercuryLooksPresent,
  serializeRhState1ViaCore,
  writeMercuryAutoLoadBundle,
} from '../src/export/mercury.ts';
import { makeFixtureRom, makeState, runRhexecCli } from './helpers.ts';

test('rhlaunch1-mercury --help', () => {
  const r = runRhexecCli('rhlaunch1-mercury.ts', ['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /RETROARCH_PATH/);
  assert.match(r.stdout, /savestate_auto_load/);
});

test('rhlaunch1-mercury rejects --out', () => {
  const r = runRhexecCli('rhlaunch1-mercury.ts', ['--out', 'game.state']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--out is a rhstate1-mercury flag/);
});

test('mercury auto-load cfg keys and slot-0 BST beside original ROM basename', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-mercury-bundle-'));
  const rom = join(dir, 'hack.sfc');
  writeFileSync(rom, makeFixtureRom());
  const bst = fakeMercuryHeader('balanced', 27);
  const bundle = writeMercuryAutoLoadBundle({ dir, romPath: rom, bst });
  assert.equal(bundle.statePath, join(dir, 'hack.state'));
  assert.ok(existsSync(bundle.statePath));
  assertMercuryCoreBlob(readFileSync(bundle.statePath));
  assert.match(bundle.cfg, /savestate_directory = "/);
  assert.match(bundle.cfg, /savestate_auto_load = "true"/);
  assert.match(bundle.cfg, /config_save_on_exit = "false"/);
  assert.equal(mercuryAutoLoadCfg(dir), bundle.cfg);
  const args = buildMercuryLaunchArgs({
    cfgPath: bundle.cfgPath,
    core: '/usr/lib/libretro/bsnes_mercury_balanced_libretro.so',
    rom,
  });
  assert.deepEqual(args.slice(0, 2), ['--appendconfig', bundle.cfgPath]);
  assert.equal(args[2], '-L');
  assert.equal(args[4], rom);
  assert.ok(!args.some((a) => a.endsWith('boot.sfc')));
});

test('rhlaunch1-mercury does not spawn without RETROARCH_PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-mercury-nospawn-'));
  const rom = join(dir, 'game.sfc');
  const state = join(dir, 'game.rhstate1');
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  writeFileSync(rom, makeFixtureRom());
  writeFileSync(state, encodeRhState1(makeState(wram)));
  const r = runRhexecCli(
    'rhlaunch1-mercury.ts',
    ['--rom', rom, '--state', state],
    { RETROARCH_PATH: '' },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /RETROARCH_PATH/);
});

const liveSkip = mercuryLooksPresent() ? false : 'MERCURY_CORE is unset and no balanced mercury core was found';

test('rhlaunch1-mercury serialize+prepare writes BST1 slot-0 without RetroArch', { skip: liveSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rhlaunch1-mercury-prepare-'));
  const wram = new Uint8Array(0x20000);
  wram[0x0100] = 0x14;
  const rom = join(dir, 'game.sfc');
  writeFileSync(rom, makeFixtureRom());
  const st = makeState(wram);
  const bstPath = join(dir, 'core.bst');
  serializeRhState1ViaCore({
    romPath: rom,
    st,
    out: bstPath,
    maxFrames: 30,
    skipVerify: true,
  });
  const bundle = writeMercuryAutoLoadBundle({
    dir,
    romPath: rom,
    bst: readFileSync(bstPath),
  });
  const buf = readFileSync(bundle.statePath);
  const hdr = assertMercuryCoreBlob(buf);
  assert.equal(hdr.profile, 'balanced');
  assert.match(bundle.cfg, /savestate_auto_load = "true"/);
  assert.equal(bundle.statePath, join(dir, 'game.state'));
});
