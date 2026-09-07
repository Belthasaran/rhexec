import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildBootRestoreRom } from '../boot/boot-restore.ts';
import { assertMercuryCoreBlob } from './identify.ts';
import type { RhState1 } from '../rhstate1/types.ts';

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

export function resolveRetroarchPath(): string | null {
  const p = process.env.RETROARCH_PATH;
  if (p && existsSync(p)) return p;
  return null;
}

export function retroarchLooksPresent(): boolean {
  return resolveRetroarchPath() != null;
}

export function romStateBasename(romPath: string): string {
  return basename(romPath).replace(/\.(sfc|smc)$/i, '');
}

/** Slot-0 auto-load cfg. RetroArch loads `<savestate_directory>/<content>.state`. */
export function mercuryAutoLoadCfg(stateDir: string): string {
  const dir = stateDir.replace(/\\/g, '/');
  return [
    `savestate_directory = "${dir}"`,
    `savestate_auto_load = "true"`,
    `config_save_on_exit = "false"`,
    '',
  ].join('\n');
}

export function buildMercuryLaunchArgs(opts: { cfgPath: string; core: string; rom: string }): string[] {
  return ['--appendconfig', opts.cfgPath, '-L', opts.core, opts.rom];
}

export function writeMercuryAutoLoadBundle(opts: {
  dir: string;
  romPath: string;
  bst: Uint8Array;
}): { cfgPath: string; statePath: string; cfg: string } {
  mkdirSync(opts.dir, { recursive: true });
  const statePath = join(opts.dir, `${romStateBasename(opts.romPath)}.state`);
  writeFileSync(statePath, opts.bst);
  const cfg = mercuryAutoLoadCfg(opts.dir);
  const cfgPath = join(opts.dir, 'rhlaunch1-mercury.cfg');
  writeFileSync(cfgPath, cfg);
  return { cfgPath, statePath, cfg };
}

export function serializeRhState1ViaCore(opts: {
  romPath: string;
  st: RhState1;
  out: string;
  maxFrames?: number;
  skipVerify?: boolean;
}): { version: number; profile: string; stdout: string; stderr: string; bytes: number } {
  const core = resolveMercuryCore();
  if (!core) {
    throw new Error('MERCURY_CORE is unset and no bsnes_mercury_balanced_libretro core was found');
  }
  const maxFrames = opts.maxFrames && opts.maxFrames > 0 ? opts.maxFrames : 600;
  const original = new Uint8Array(readFileSync(opts.romPath));
  const built = buildBootRestoreRom(original, opts.st);
  const dir = mkdtempSync(join(tmpdir(), 'rhstate1-mercury-'));
  const bootPath = join(dir, 'boot.sfc');
  writeFileSync(bootPath, built.rom);
  const gameMode = opts.st.trigger?.game_mode ?? 0x14;
  const r = runMercurySerialize({
    core,
    rom: bootPath,
    out: opts.out,
    systemDir: dir,
    saveDir: dir,
    waitWramU8: { addr: 0x0100, value: gameMode },
    maxFrames,
    verifyRom: opts.skipVerify ? null : opts.romPath,
    timeoutMs: Math.max(30, maxFrames) * 50 + 15_000,
  });
  if (r.status === 2) {
    throw new Error((r.stderr || r.stdout || 'mercury unserialize failed').trim());
  }
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || `lr_serialize exited ${r.status}`).trim());
  }
  if (!existsSync(opts.out)) throw new Error(`mercury serialize did not write ${opts.out}`);
  const buf = readFileSync(opts.out);
  const hdr = assertMercuryCoreBlob(buf);
  return { ...hdr, stdout: r.stdout, stderr: r.stderr, bytes: buf.length };
}
