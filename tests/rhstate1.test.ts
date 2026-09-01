import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';
import { decodeRle0, encodeRle0, maybeDecode } from '../src/rhstate1/rle0.ts';
import { decodeRhState1, encodeRhState1 } from '../src/rhstate1/codec.ts';
import { makeState } from './helpers.ts';

test('rle0 round-trips mixed zeros and literals', () => {
  const src = Uint8Array.from([1, 0, 0, 0, 2, 0, 3]);
  const enc = encodeRle0(src);
  assert.deepEqual(Array.from(decodeRle0(enc)), Array.from(src));
});

test('rle0 256 zeros uses two runs', () => {
  const src = new Uint8Array(256);
  const enc = encodeRle0(src);
  assert.equal(enc[0], 0);
  assert.equal(enc[1], 255);
  assert.equal(enc[2], 0);
  assert.equal(enc[3], 1);
  assert.equal(decodeRle0(enc).length, 256);
});

test('RHSTATE1 magic + msgpack round-trip keeps unknown keys', () => {
  const wram = new Uint8Array(64);
  wram[3] = 9;
  const st = makeState(wram, { extra_note: 'keep-me' } as never);
  const buf = encodeRhState1(st, 'raw');
  assert.equal(buf.subarray(0, 8).toString('ascii'), 'RHSTATE1');
  const back = decodeRhState1(buf);
  assert.equal(back.v, 1);
  assert.equal(back.sections[0].id, 'wram');
  assert.equal(back.sections[0].data[3], 9);
  assert.equal((back as { extra_note?: string }).extra_note, 'keep-me');
});

test('rle0 encoding round-trips through the file codec', () => {
  const wram = new Uint8Array(128);
  wram[10] = 0xaa;
  const st = makeState(wram);
  const buf = encodeRhState1(st, 'rle0');
  const back = decodeRhState1(buf);
  assert.equal(back.sections[0].encoding, 'rle0');
  const raw = maybeDecode(back.sections[0].data, back.sections[0].encoding);
  assert.equal(raw[10], 0xaa);
  assert.equal(raw.length, 128);
});

test('shared WRAM prefix deflates smaller than unique noise (zip goal)', () => {
  const shared = new Uint8Array(8192);
  for (let i = 0; i < shared.length; i += 1) shared[i] = i % 17;
  const a = makeState(shared);
  const b = makeState(shared);
  const fa = encodeRhState1(a, 'raw');
  const fb = encodeRhState1(b, 'raw');
  const together = deflateSync(Buffer.concat([fa, fb]));
  const noiseA = new Uint8Array(8192);
  const noiseB = new Uint8Array(8192);
  for (let i = 0; i < 8192; i += 1) {
    noiseA[i] = (i * 13 + 7) & 0xff;
    noiseB[i] = (i * 29 + 3) & 0xff;
  }
  const na = encodeRhState1(makeState(noiseA), 'raw');
  const nb = encodeRhState1(makeState(noiseB), 'raw');
  const unique = deflateSync(Buffer.concat([na, nb]));
  assert.ok(together.length < unique.length, `${together.length} !< ${unique.length}`);
});
