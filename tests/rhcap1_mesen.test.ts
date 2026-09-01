import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { mesenLooksPresent, resolveMesenPath } from '../src/capture/mesen-spawn.ts';

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
