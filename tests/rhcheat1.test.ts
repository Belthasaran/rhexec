import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoLoaderGg, buildParCodes, formatSd2snesYml } from '../src/cheat/yml.ts';

test('yml PAR lines for level + OW without Luigi stay under 26', () => {
  const codes = buildParCodes(
    { level: 0x105, owHave: true, owSubmap: 1, owX: 6, owY: 7 },
    { includeLuigi: false, autoEnter: false },
  );
  assert.ok(codes.length <= 26);
  assert.ok(codes.some((c) => c.startsWith('7E13BF')));
  assert.ok(codes.every((c) => /^[0-9A-F]{8}$/.test(c)));
  const yml = formatSd2snesYml('test', codes, true);
  assert.match(yml, /Enabled: True/);
  assert.match(yml, /7E1F11/);
});

test('refuses Game Genie style codes', () => {
  assert.throws(() => assertNoLoaderGg(['DEAD-C0DE']), /Game Genie/);
});

test('refuses loader-region PAR', () => {
  assert.throws(() => assertNoLoaderGg(['05D89BEA']), /loader-region/);
});
