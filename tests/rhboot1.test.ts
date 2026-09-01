import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBootRestoreRom, loromOffset } from '../src/boot/boot-restore.ts';
import { emptyCpu, makeFixtureRom } from './helpers.ts';

test('rhboot1-sfc leaves $05D89B loader bytes unchanged and retargets reset', () => {
  const rom = makeFixtureRom();
  const loader = loromOffset(0x05, 0xd89b);
  const before = Buffer.from(rom.subarray(loader, loader + 4));
  const wram = new Uint8Array(0x20000);
  const cpu = emptyCpu();
  cpu.pc = 0x808123;
  const { rom: out } = buildBootRestoreRom(rom, wram, cpu);
  const { body } = { body: out.length % 1024 === 512 ? out.subarray(512) : out };
  const after = Buffer.from(body.subarray(loader, loader + 4));
  assert.deepEqual(after, before);
  const rst = loromOffset(0, 0xfffc);
  const origRst = Buffer.from(rom.subarray(rst, rst + 2));
  const newRst = Buffer.from(body.subarray(rst, rst + 2));
  assert.notDeepEqual(newRst, origRst);
  assert.ok(body.length > rom.length);
});

test('boot-restore does not write $05DCDD either', () => {
  const rom = makeFixtureRom();
  const off = loromOffset(0x05, 0xdcdd);
  rom[off] = 0xab;
  rom[off + 1] = 0xcd;
  const { rom: out } = buildBootRestoreRom(rom, new Uint8Array(0x20000), emptyCpu());
  const body = out.length % 1024 === 512 ? out.subarray(512) : out;
  assert.equal(body[off], 0xab);
  assert.equal(body[off + 1], 0xcd);
});
