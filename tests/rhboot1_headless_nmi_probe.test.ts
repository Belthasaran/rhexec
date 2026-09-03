import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnMesen } from '../src/capture/mesen-spawn.ts';
import { writeBootProbeScript } from '../src/capture/write-lua.ts';
import { prepareAkogare121 } from './test-materials/prepare-akogare-1.21.ts';
import { liveBootProbeSkipReason } from './test-materials/prereqs.ts';
import { RHEXEC_ROOT } from './test-materials/paths.ts';

const here = dirname(fileURLToPath(import.meta.url));
const STATE = join(here, 'test-materials', 'akogare', 'akogare.rhstate1');
const TIMEOUT_FRAMES = 600;
const WAIT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDone(dir: string, child: ReturnType<typeof spawn>, timeoutMs: number): Promise<'ok' | 'timeout' | 'exit'> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(join(dir, 'done')) || existsSync(join(dir, 'nmi_probe.json'))) return 'ok';
    if (existsSync(join(dir, 'failed'))) return 'ok';
    if (child.exitCode != null || child.killed) return 'exit';
    await sleep(200);
  }
  return 'timeout';
}

function runRhboot1(rom: string, state: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      join(RHEXEC_ROOT, 'src', 'cli', 'rhboot1-sfc.ts'),
      '--rom',
      rom,
      '--state',
      state,
      '--out',
      out,
    ], { cwd: RHEXEC_ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`rhboot1-sfc exit ${code}`));
    });
  });
}

const skip = liveBootProbeSkipReason() || (!existsSync(STATE) && 'missing tests/test-materials/akogare/akogare.rhstate1');

test('rhboot1-sfc headless: $7E0010 becomes non-zero', { skip: skip || false, timeout: WAIT_MS + 60_000 }, async () => {
  const prepared = await prepareAkogare121();
  const work = mkdtempSync(join(tmpdir(), 'rhboot1-nmi-'));
  const bootSfc = join(work, 'akogare-boot.sfc');
  const probeDir = join(work, 'probe');
  try {
    await runRhboot1(prepared.sfc, STATE, bootSfc);
    assert.ok(existsSync(bootSfc), 'rhboot1-sfc wrote a boot ROM');
    const lua = writeBootProbeScript(probeDir, TIMEOUT_FRAMES);
    const chunks: Buffer[] = [];
    const child = spawnMesen({ rom: bootSfc, lua, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.stderr?.on('data', (d: Buffer) => chunks.push(d));
    const flag = await waitForDone(probeDir, child, WAIT_MS);
    if (child.exitCode == null) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    const log = Buffer.concat(chunks).toString('utf8');
    const resultPath = join(probeDir, 'nmi_probe.json');
    if (!existsSync(resultPath)) {
      throw new Error(`probe result missing (${flag}); Mesen exit=${child.exitCode}\n${log}`);
    }
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as {
      ok: boolean;
      frame: number;
      last_10: number;
      pc: number;
    };
    const pcHex = result.pc.toString(16).toUpperCase().padStart(6, '0');
    assert.ok(
      result.ok && result.last_10 !== 0,
      `$7E0010 stayed ${result.last_10} after ${result.frame} frames (PC $${pcHex})`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
