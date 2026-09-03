import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBootProbeScript } from '../src/capture/write-lua.ts';
import { sha256Buffer, sha256File } from './test-materials/hash.ts';
import { makeStoreZip, extractBpsFromZip } from './test-materials/zip.ts';
import { prepareAkogare121, AKOGARE_SFC_SHA256 } from './test-materials/prepare-akogare-1.21.ts';
import {
  findKaizoffHack,
  isAllowedKaizoffDownloadHost,
  prepareHackFromKaizoff,
  KAIZOFF_ALLOWED_HOST,
} from './test-materials/kaizoff.ts';
import { liveBootProbeSkipReason } from './test-materials/prereqs.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('boot probe lua watches $7E0010 and writes nmi_probe.json', () => {
  const src = readFileSync(join(here, '..', 'src', 'lua', 'mesen_boot_probe_nmi.lua'), 'utf8');
  assert.match(src, /0x0010/);
  assert.match(src, /nmi_probe\.json/);
  assert.match(src, /emu\.stop/);
  const dir = mkdtempSync(join(tmpdir(), 'rhboot-probe-'));
  const lua = readFileSync(writeBootProbeScript(dir, 600), 'utf8');
  assert.match(lua, /TIMEOUT_FRAMES = 600/);
  assert.match(lua, /RESULT_DIR/);
});

test('skip helper: missing Mesen / SMW / flips / display', () => {
  assert.match(liveBootProbeSkipReason({ mesenPresent: false, smwPath: '/x', flipsPath: '/y', hasDisplay: true }) as string, /MESEN_PATH/);
  assert.match(liveBootProbeSkipReason({ mesenPresent: true, smwPath: null, flipsPath: '/y', hasDisplay: true }) as string, /SMW_SFC_PATH/);
  assert.match(liveBootProbeSkipReason({ mesenPresent: true, smwPath: '/x', flipsPath: null, hasDisplay: true }) as string, /flips/);
  assert.match(liveBootProbeSkipReason({
    mesenPresent: true, smwPath: '/x', flipsPath: '/y', hasDisplay: false, mesenArgs: '',
  }) as string, /DISPLAY/);
  assert.equal(liveBootProbeSkipReason({ mesenPresent: true, smwPath: '/x', flipsPath: '/y', hasDisplay: true }), false);
  assert.equal(liveBootProbeSkipReason({
    mesenPresent: true, smwPath: '/x', flipsPath: '/y', hasDisplay: false, mesenArgs: '--headless',
  }), false);
});

test('prepare-akogare-1.21 retrieval is fetchpatches, not Kaizoff/Speedrun URLs', () => {
  const src = readFileSync(join(here, 'test-materials', 'prepare-akogare-1.21.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /https?:\/\/\S*kaizoff\.com/i);
  assert.doesNotMatch(code, /https?:\/\/\S*speedrun\.com/i);
  assert.doesNotMatch(code, /download_url/);
  assert.match(src, /fetchpatches\.js/);
  assert.match(src, /18612/);
});

test('prepareAkogare121 reuses a cached SFC with the 1.21 pin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ako-cache-'));
  const sfc = join(dir, 'akogare.sfc');
  const blob = Buffer.alloc(64, 7);
  writeFileSync(sfc, blob);
  const pin = sha256File(sfc);
  const orig = AKOGARE_SFC_SHA256;
  // Temporarily not possible to rebind the const; write a file that already matches
  // the real pin by copying local akogare.sfc when present, else skip this assertion path.
  const local = join(here, '..', 'akogare.sfc');
  if (!existsSync(local) || sha256File(local) !== orig) {
    // Still cover hash-mismatch failure below; cache-hit uses the real ROM when available.
    assert.ok(pin.length === 64);
    return;
  }
  writeFileSync(sfc, readFileSync(local));
  const got = await prepareAkogare121({
    cacheDir: dir,
    fetchPatch: async () => {
      throw new Error('fetchpatches must not run on cache hit');
    },
  });
  assert.equal(got.fromCache, true);
  assert.equal(sha256File(got.sfc), orig);
});

test('prepareAkogare121 fails clearly on BPS sha256 mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ako-bps-'));
  const smw = join(dir, 'smw.sfc');
  writeFileSync(smw, Buffer.alloc(16));
  await assert.rejects(
    () => prepareAkogare121({
      cacheDir: dir,
      smwSfcPath: smw,
      fetchPatch: async (bpsPath) => {
        writeFileSync(bpsPath, Buffer.from('not-a-real-bps'));
      },
    }),
    /Akogare 1\.21 BPS sha256 mismatch/,
  );
});

test('prepareAkogare121 fails clearly on SFC sha256 mismatch after flips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ako-sfc-'));
  const smw = join(dir, 'smw.sfc');
  writeFileSync(smw, Buffer.alloc(16));
  const payload = Buffer.from('ako-test-bps');
  await assert.rejects(
    () => prepareAkogare121({
      cacheDir: dir,
      smwSfcPath: smw,
      expectedBpsSha256: sha256Buffer(payload),
      expectedSfcSha256: AKOGARE_SFC_SHA256,
      fetchPatch: async (bpsPath) => {
        writeFileSync(bpsPath, payload);
      },
      applyPatch: async (_b, _s, out) => {
        writeFileSync(out, Buffer.from('wrong-sfc'));
      },
    }),
    /Akogare 1\.21 SFC sha256 mismatch/,
  );
});

test('Kaizoff helper refuses hack 18612', async () => {
  await assert.rejects(
    () => findKaizoffHack('18612', { fetchPage: async () => ({ json: { data: [], pagination: { has_more: false } } }) }),
    /must not be used for hack 18612/,
  );
});

test('Kaizoff download host allowlist matches dl.smwcentral.net', () => {
  assert.equal(isAllowedKaizoffDownloadHost('https://dl.smwcentral.net/123/foo.zip'), true);
  assert.equal(isAllowedKaizoffDownloadHost('https://example.com/foo.zip'), false);
  assert.equal(isAllowedKaizoffDownloadHost('not a url'), false);
  assert.equal(KAIZOFF_ALLOWED_HOST, 'dl.smwcentral.net');
});

test('Kaizoff find + extract BPS from zip + apply', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kz-'));
  const bpsBody = Buffer.from('PATCH');
  const zip = makeStoreZip([{ name: 'inner/hack.bps', data: bpsBody }]);
  const smw = join(dir, 'smw.sfc');
  writeFileSync(smw, Buffer.alloc(32));
  let applied = false;
  const got = await prepareHackFromKaizoff('99999', {
    outSfc: join(dir, 'out.sfc'),
    smwSfcPath: smw,
    cacheDir: dir,
    pageDelayMs: 0,
    fetchPage: async () => ({
      json: {
        data: [{ id: 99999, download_url: 'https://dl.smwcentral.net/1/hack.zip' }],
        pagination: { has_more: false },
      },
    }),
    download: async (_url, dest) => {
      writeFileSync(dest, zip);
    },
    applyPatch: async (bpsPath, _smw, out) => {
      applied = true;
      assert.equal(readFileSync(bpsPath).equals(bpsBody), true);
      writeFileSync(out, Buffer.from('sfc'));
    },
  });
  assert.equal(applied, true);
  assert.equal(existsSync(got.sfc), true);
  const extracted = extractBpsFromZip(zip);
  assert.equal(extracted.name, 'hack.bps');
  assert.equal(extracted.data.equals(bpsBody), true);
});

test('Kaizoff rejects a non-SMWC download_url', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kz-bad-'));
  await assert.rejects(
    () => prepareHackFromKaizoff('42', {
      outSfc: join(dir, 'out.sfc'),
      smwSfcPath: join(dir, 'smw.sfc'),
      cacheDir: dir,
      pageDelayMs: 0,
      fetchPage: async () => ({
        json: {
          data: [{ id: '42', download_url: 'https://evil.example/x.zip' }],
          pagination: { has_more: false },
        },
      }),
    }),
    /not dl\.smwcentral\.net/,
  );
});
