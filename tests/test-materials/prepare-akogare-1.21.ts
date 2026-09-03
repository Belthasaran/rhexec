/**
 * Prepare Akogare Mario World (gameid 18612) v1.21 source SFC for rhexec tests.
 *
 * Retrieval matches lmlevelinfo/test/get_hack.sh: neighboring RHPlay
 * `enode.sh jstools/fetchpatches.js mode3 -b gameid 18612 --query=patch`.
 *
 * Do not use Kaizoff / SMWC download_url for 18612 — that catalog BPS is older
 * than 1.21. Speedrun.com hosts 1.21 but Cloudflare blocks automated download.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyFlips } from './flips.ts';
import { assertSha256, sha256File } from './hash.ts';
import {
  AKOGARE_BPS_SHA256,
  AKOGARE_GAMEID,
  AKOGARE_MATERIALS_DIR,
  AKOGARE_SFC_SHA256,
  RHEXEC_ROOT,
  rhplayRoot,
} from './paths.ts';

export {
  AKOGARE_BPS_SHA256,
  AKOGARE_GAMEID,
  AKOGARE_SFC_SHA256,
};

export interface PrepareAkogareOpts {
  cacheDir?: string;
  smwSfcPath?: string;
  flipsPath?: string;
  rhplayRoot?: string;
  /** Override fetchpatches (tests). Writes the BPS to `bpsPath`. */
  fetchPatch?: (bpsPath: string) => Promise<void>;
  /** Override flips --apply (tests). */
  applyPatch?: (bpsPath: string, smwPath: string, outSfc: string) => Promise<void>;
  /** Test-only pin overrides. Production callers must omit these. */
  expectedBpsSha256?: string;
  expectedSfcSha256?: string;
}

export interface PreparedAkogare {
  sfc: string;
  bps: string;
  fromCache: boolean;
}

function existingMatchingSfc(cacheSfc: string, cacheDir: string): string | null {
  const candidates = [cacheSfc];
  if (cacheDir === AKOGARE_MATERIALS_DIR) {
    candidates.push(join(RHEXEC_ROOT, 'akogare.sfc'));
  }
  for (const p of candidates) {
    if (existsSync(p) && sha256File(p) === AKOGARE_SFC_SHA256) return p;
  }
  return null;
}

function runFetchpatches(bpsPath: string, root: string): Promise<void> {
  const enode = join(root, 'enode.sh');
  const script = join(root, 'jstools', 'fetchpatches.js');
  if (!existsSync(enode) || !existsSync(script)) {
    throw new Error(
      `fetchpatches requires a neighboring RHPlay tree (enode.sh + jstools/fetchpatches.js). Looked in ${root}. Set RHPLAY_ROOT.`,
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(enode, [
      script,
      'mode3',
      '-b',
      'gameid',
      AKOGARE_GAMEID,
      '--query=patch',
      `--output=${bpsPath}`,
    ], { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`fetchpatches.js exit ${code} (gameid ${AKOGARE_GAMEID})`));
    });
  });
}

export async function prepareAkogare121(opts: PrepareAkogareOpts = {}): Promise<PreparedAkogare> {
  const cacheDir = opts.cacheDir || AKOGARE_MATERIALS_DIR;
  mkdirSync(cacheDir, { recursive: true });
  const sfc = join(cacheDir, 'akogare.sfc');
  const bps = join(cacheDir, 'akogare.bps');

  const hit = existingMatchingSfc(sfc, cacheDir);
  if (hit) {
    if (hit !== sfc) copyFileSync(hit, sfc);
    return { sfc, bps, fromCache: true };
  }

  const smw = opts.smwSfcPath || process.env.SMW_SFC_PATH;
  if (!smw || !existsSync(smw)) {
    throw new Error('SMW_SFC_PATH is required to apply the Akogare 1.21 BPS');
  }

  const fetchPatch = opts.fetchPatch || ((dest) => runFetchpatches(dest, opts.rhplayRoot || rhplayRoot()));
  await fetchPatch(bps);
  if (!existsSync(bps)) throw new Error(`fetchpatches did not write ${bps}`);
  assertSha256(bps, opts.expectedBpsSha256 || AKOGARE_BPS_SHA256, 'Akogare 1.21 BPS');

  const apply = opts.applyPatch || (async (b, s, o) => {
    applyFlips(b, s, o, opts.flipsPath);
  });
  await apply(bps, smw, sfc);
  if (!existsSync(sfc)) throw new Error(`flips did not write ${sfc}`);
  assertSha256(sfc, opts.expectedSfcSha256 || AKOGARE_SFC_SHA256, 'Akogare 1.21 SFC');
  return { sfc, bps, fromCache: false };
}
