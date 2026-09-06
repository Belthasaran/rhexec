import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
export const LR_SERIALIZE_PY = join(here, '..', '..', 'scripts', 'lr_serialize.py');

const CORE_NAMES = [
  'bsnes_mercury_balanced_libretro.so',
  'bsnes_mercury_balanced_libretro.dll',
  'bsnes_mercury_balanced_libretro.dylib',
];

export function resolveMercuryCore(): string | null {
  const env = process.env.MERCURY_CORE;
  if (env && existsSync(env)) return env;
  const ra = process.env.RETROARCH_PATH;
  if (ra) {
    const dir = existsSync(ra) && ra.endsWith('.so') ? dirname(ra) : dirname(ra);
    const roots = [dir, join(dir, 'cores'), join(dir, '..', 'cores')];
    for (const root of roots) {
      for (const name of CORE_NAMES) {
        const p = join(root, name);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of [
    '/usr/lib/libretro/bsnes_mercury_balanced_libretro.so',
    '/usr/lib/x86_64-linux-gnu/libretro/bsnes_mercury_balanced_libretro.so',
    '/usr/lib/aarch64-linux-gnu/libretro/bsnes_mercury_balanced_libretro.so',
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function mercuryLooksPresent(): boolean {
  return resolveMercuryCore() != null;
}

export function resolvePython(): string {
  return process.env.PYTHON || process.env.PYTHON3 || 'python3';
}

export function runMercurySerialize(opts: {
  core: string;
  rom: string;
  out: string;
  systemDir: string;
  saveDir: string;
  waitWramU8?: { addr: number; value: number };
  maxFrames: number;
  verifyRom?: string | null;
  timeoutMs: number;
}): { status: number; stdout: string; stderr: string } {
  if (!existsSync(LR_SERIALIZE_PY)) {
    throw new Error(`lr_serialize.py not found: ${LR_SERIALIZE_PY}`);
  }
  const args = [
    LR_SERIALIZE_PY,
    '--core',
    opts.core,
    '--rom',
    opts.rom,
    '--out',
    opts.out,
    '--system-dir',
    opts.systemDir,
    '--save-dir',
    opts.saveDir,
    '--max-frames',
    String(opts.maxFrames),
  ];
  if (opts.waitWramU8) {
    args.push('--wait-wram-u8', String(opts.waitWramU8.addr), String(opts.waitWramU8.value));
  }
  if (opts.verifyRom) {
    args.push('--verify-rom', opts.verifyRom);
  }
  const r = spawnSync(resolvePython(), args, {
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error) {
    const err = r.error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') throw new Error(`${resolvePython()} not found (set PYTHON)`);
    if (err.code === 'ETIMEDOUT') throw new Error('mercury serialize timed out');
    throw r.error;
  }
  return {
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}
