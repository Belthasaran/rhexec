import { existsSync } from 'node:fs';
import { mesenLooksPresent } from '../../src/capture/mesen-spawn.ts';
import { resolveFlipsPath } from './flips.ts';

export function smwSfcPath(): string | null {
  const p = process.env.SMW_SFC_PATH;
  if (p && existsSync(p)) return p;
  return null;
}

export interface SkipOverrides {
  mesenPresent?: boolean;
  smwPath?: string | null;
  flipsPath?: string | null;
  hasDisplay?: boolean;
  mesenArgs?: string | null;
}

/** False = run the live test. String = skip reason for node:test `{ skip }`. */
export function liveBootProbeSkipReason(overrides: SkipOverrides = {}): false | string {
  const mesen = overrides.mesenPresent ?? mesenLooksPresent();
  if (!mesen) return 'MESEN_PATH does not point at a Mesen binary';
  const smw = overrides.smwPath !== undefined ? overrides.smwPath : smwSfcPath();
  if (!smw) return 'SMW_SFC_PATH is unset or the file is missing';
  const flips = overrides.flipsPath !== undefined ? overrides.flipsPath : resolveFlipsPath();
  if (!flips) return 'flips not found (FLIPS_PATH or PATH)';
  const display = overrides.hasDisplay ?? Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  const mesenArgs = overrides.mesenArgs !== undefined ? overrides.mesenArgs : process.env.MESEN_ARGS;
  if (!display && !mesenArgs) {
    return 'no DISPLAY/WAYLAND_DISPLAY and MESEN_ARGS is empty (Mesen needs a display or a headless flag)';
  }
  return false;
}
