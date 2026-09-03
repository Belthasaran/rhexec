import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** rhexec package root (parent of tests/). */
export const RHEXEC_ROOT = join(here, '..', '..');

/** Default cache for Akogare 1.21 BPS/SFC (SFC is gitignored). */
export const AKOGARE_MATERIALS_DIR = join(here, 'akogare');

export const AKOGARE_GAMEID = '18612';
export const AKOGARE_BPS_SHA256 = '0532c022c466b3826125fff19b6ae9cf5caa9a6d57666a80eb14422bdbe6d6e0';
export const AKOGARE_SFC_SHA256 = 'e58746665b0f445df1228e4adc217689f7458c98f94896045786b4fdc62df073';

/** Neighboring RHPlay tree that has enode.sh + jstools/fetchpatches.js. */
export function rhplayRoot(): string {
  return process.env.RHPLAY_ROOT || join(RHEXEC_ROOT, '..');
}
