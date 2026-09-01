import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

export function resolveMesenPath(): string {
  return process.env.MESEN_PATH || 'Mesen';
}

export function spawnMesen(opts: { rom: string; lua: string; extraArgs?: string[] }): ChildProcess {
  const bin = resolveMesenPath();
  const extra = opts.extraArgs ?? (process.env.MESEN_ARGS ? process.env.MESEN_ARGS.split(/\s+/).filter(Boolean) : []);
  const args = [...extra, opts.rom, '--lua', opts.lua];
  return spawn(bin, args, { stdio: 'inherit' });
}

export function mesenLooksPresent(): boolean {
  const p = resolveMesenPath();
  if (p === 'Mesen' || p === 'Mesen-S') return false;
  return existsSync(p);
}
