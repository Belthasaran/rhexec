import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function sha256Buffer(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

export function assertSha256(path: string, expected: string, label: string): void {
  const got = sha256File(path);
  if (got !== expected.toLowerCase()) {
    throw new Error(
      `${label} sha256 mismatch:\n  expected ${expected.toLowerCase()}\n  actual   ${got}\n  file     ${path}`,
    );
  }
}
