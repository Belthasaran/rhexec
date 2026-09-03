/**
 * Test-only Kaizoff download helper for later hacks.
 *
 * Do NOT use this for Akogare / gameid 18612: the public catalog BPS is older
 * than v1.21. That hack must go through prepare-akogare-1.21.ts (fetchpatches).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyFlips } from './flips.ts';
import { extractBpsFromZip } from './zip.ts';

export const KAIZOFF_HACKS_URL = 'https://kaizoff.com/api/public/v1/hacks';
export const KAIZOFF_ALLOWED_HOST = 'dl.smwcentral.net';
/** Catalog BPS for these ids is known-stale vs the version rhexec tests pin. */
export const KAIZOFF_FORBIDDEN_HACK_IDS = new Set(['18612']);

export interface KaizoffHack {
  id: string | number;
  download_url?: string;
  name?: string;
}

export type FetchPage = (page: number, limit: number) => Promise<{ json: unknown }>;

export interface PrepareKaizoffOpts {
  outSfc: string;
  smwSfcPath: string;
  cacheDir: string;
  flipsPath?: string;
  bpsName?: string;
  pageDelayMs?: number;
  fetchPage?: FetchPage;
  download?: (url: string, dest: string) => Promise<void>;
  applyPatch?: (bpsPath: string, smwPath: string, outSfc: string) => Promise<void>;
}

export function isAllowedKaizoffDownloadHost(urlStr: string): boolean {
  try {
    return new URL(urlStr).hostname === KAIZOFF_ALLOWED_HOST;
  } catch {
    return false;
  }
}

function defaultFetchPage(page: number, limit: number): Promise<{ json: unknown }> {
  return fetch(`${KAIZOFF_HACKS_URL}?page=${page}&limit=${limit}`, {
    headers: { Accept: 'application/json' },
  }).then(async (res) => {
    if (!res.ok) throw new Error(`Kaizoff HTTP ${res.status}`);
    return { json: await res.json() };
  });
}

function defaultDownload(url: string, dest: string): Promise<void> {
  return fetch(url, { redirect: 'follow' }).then(async (res) => {
    if (!res.ok) throw new Error(`download HTTP ${res.status} for ${url}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function findKaizoffHack(hackId: string, opts: {
  fetchPage?: FetchPage;
  pageDelayMs?: number;
  limit?: number;
} = {}): Promise<KaizoffHack> {
  const id = String(hackId);
  if (KAIZOFF_FORBIDDEN_HACK_IDS.has(id)) {
    throw new Error(
      `Kaizoff must not be used for hack ${id} (Akogare catalog BPS is older than v1.21). Use prepare-akogare-1.21.ts / fetchpatches.`,
    );
  }
  const fetchPage = opts.fetchPage || defaultFetchPage;
  const delayMs = opts.pageDelayMs ?? 200;
  const limit = opts.limit || 500;
  let page = 1;
  for (;;) {
    const { json } = await fetchPage(page, limit);
    const rec = json as { data?: KaizoffHack[]; pagination?: { has_more?: boolean } };
    const data = Array.isArray(rec?.data) ? rec.data : [];
    const hit = data.find((h) => String(h.id) === id);
    if (hit) return hit;
    if (!rec?.pagination?.has_more) {
      throw new Error(`Kaizoff catalog has no hack id ${id}`);
    }
    page += 1;
    if (delayMs > 0) await sleep(delayMs);
  }
}

export async function prepareHackFromKaizoff(hackId: string, opts: PrepareKaizoffOpts): Promise<{
  sfc: string;
  bps: string;
  zip: string;
}> {
  const hack = await findKaizoffHack(hackId, opts);
  const url = hack.download_url;
  if (!url || !String(url).startsWith('http')) {
    throw new Error(`Kaizoff hack ${hackId} has no download_url`);
  }
  if (!isAllowedKaizoffDownloadHost(url)) {
    throw new Error(`Kaizoff download host is not ${KAIZOFF_ALLOWED_HOST}: ${url}`);
  }
  mkdirSync(opts.cacheDir, { recursive: true });
  const zipPath = join(opts.cacheDir, `${hackId}.zip`);
  const download = opts.download || defaultDownload;
  await download(url, zipPath);
  if (!existsSync(zipPath)) throw new Error(`download did not write ${zipPath}`);
  const extracted = extractBpsFromZip(readFileSync(zipPath), opts.bpsName);
  const bpsPath = join(opts.cacheDir, extracted.name.endsWith('.bps') ? extracted.name : `${hackId}.bps`);
  writeFileSync(bpsPath, extracted.data);
  const apply = opts.applyPatch || (async (b, s, o) => {
    applyFlips(b, s, o, opts.flipsPath);
  });
  if (!opts.smwSfcPath || !existsSync(opts.smwSfcPath)) {
    throw new Error('SMW_SFC_PATH is required to apply a Kaizoff BPS');
  }
  await apply(bpsPath, opts.smwSfcPath, opts.outSfc);
  return { sfc: opts.outSfc, bps: bpsPath, zip: zipPath };
}
