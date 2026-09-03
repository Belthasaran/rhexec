import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export function resolveFlipsPath(): string | null {
  const env = process.env.FLIPS_PATH;
  if (env && existsSync(env)) return env;
  const which = spawnSync('which', ['flips'], { encoding: 'utf8' });
  const p = (which.stdout || '').trim();
  if (which.status === 0 && p && existsSync(p)) return p;
  return null;
}

export function applyFlips(bpsPath: string, smwPath: string, outSfc: string, flipsPath?: string): void {
  const bin = flipsPath || resolveFlipsPath();
  if (!bin) throw new Error('flips not found (set FLIPS_PATH or install flips on PATH)');
  execFileSync(bin, ['--apply', bpsPath, smwPath, outSfc], { stdio: 'inherit' });
}
