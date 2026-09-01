import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mutateWram, translevelBytes, owPixels } from '../src/rhstate1/mutate.ts';
import { applyMutations } from '../src/rhstate1/apply.ts';
import { maybeDecode } from '../src/rhstate1/rle0.ts';
import { makeState } from './helpers.ts';

test('translevel mapping matches 4lvno !anumber', () => {
  assert.deepEqual(translevelBytes(0x05), { anumber: 0x05, high: 0 });
  assert.deepEqual(translevelBytes(0x24), { anumber: 0x24, high: 0 });
  assert.deepEqual(translevelBytes(0x105), { anumber: (0x105 - 0xdc) & 0xff, high: 1 });
});

test('mutateWram writes $13BF $0F and OW tiles/pixels', () => {
  const wram = new Uint8Array(0x20000);
  mutateWram(wram, { level: 0x105, owHave: true, owSubmap: 1, owX: 6, owY: 7 });
  assert.equal(wram[0x13bf], (0x105 - 0xdc) & 0xff);
  assert.equal(wram[0x000f], 1);
  assert.equal(wram[0x1f11], 1);
  assert.equal(wram[0x1f12], 1);
  assert.equal(wram[0x13c3], 1);
  assert.equal(wram[0x1f1f], 6);
  assert.equal(wram[0x1f20], 0);
  assert.equal(wram[0x1f21], 7);
  assert.equal(wram[0x1f17], owPixels(6) & 0xff);
  assert.equal(wram[0x1f18], owPixels(6) >> 8);
});

test('applyMutations updates the wram section', () => {
  const st = makeState(new Uint8Array(0x20000));
  applyMutations(st, { level: 0x10 });
  const raw = maybeDecode(st.sections[0].data, st.sections[0].encoding);
  assert.equal(raw[0x13bf], 0x10);
});
