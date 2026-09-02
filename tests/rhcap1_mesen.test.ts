import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mesenLooksPresent, resolveMesenPath } from '../src/capture/mesen-spawn.ts';
import { writeCaptureScript } from '../src/capture/write-lua.ts';

test('rhcap1-mesen live capture skipped without MESEN_PATH binary', { skip: !mesenLooksPresent() }, () => {
  assert.ok(existsSync(resolveMesenPath()));
});

test('MESEN_PATH defaults to Mesen', () => {
  const prev = process.env.MESEN_PATH;
  delete process.env.MESEN_PATH;
  try {
    assert.equal(resolveMesenPath(), 'Mesen');
  } finally {
    if (prev != null) process.env.MESEN_PATH = prev;
  }
});

test('capture lua coerces getState booleans and is one-shot exec', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lua', 'mesen_capture.lua'), 'utf8');
  assert.match(src, /n == true/);
  assert.match(src, /as_num/);
  assert.match(src, /if captured or busy then return end/);
  assert.match(src, /need_fallback/);
  assert.doesNotMatch(src, /emu\.breakExecution\s*\(/);
  const dir = mkdtempSync(join(tmpdir(), 'rhcap-lua-'));
  const lua = readFileSync(writeCaptureScript(dir, 'manual', 10), 'utf8');
  assert.match(lua, /createSavestate/);
  assert.match(lua, /callbackType\.exec/);
});
