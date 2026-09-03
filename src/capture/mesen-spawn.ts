import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync } from 'node:fs';

export function resolveMesenPath(): string {
  return process.env.MESEN_PATH || 'Mesen';
}

export function spawnMesen(opts: {
  rom: string;
  lua: string;
  extraArgs?: string[];
  stdio?: StdioOptions;
}): ChildProcess {
  const bin = resolveMesenPath();
  const extra = opts.extraArgs ?? (process.env.MESEN_ARGS ? process.env.MESEN_ARGS.split(/\s+/).filter(Boolean) : []);
  const args = [...extra, opts.rom, '--lua', opts.lua];
  return spawn(bin, args, { stdio: opts.stdio ?? 'inherit' });
}

export function mesenLooksPresent(): boolean {
  const p = resolveMesenPath();
  if (p === 'Mesen' || p === 'Mesen-S') return false;
  return existsSync(p);
}

/** SIGTERM then SIGKILL so Avalonia cannot keep `npm test` alive. */
export function stopMesen(child: ChildProcess, waitMs = 500): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode != null) {
      resolve();
      return;
    }
    const done = () => {
      try { child.stdout?.destroy(); } catch { /* ignore */ }
      try { child.stderr?.destroy(); } catch { /* ignore */ }
      try { child.unref(); } catch { /* ignore */ }
      resolve();
    };
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done();
    }, waitMs);
    child.once('exit', () => {
      clearTimeout(t);
      done();
    });
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  });
}
