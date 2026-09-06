export interface FlagSpec {
  name: string;
  hasValue?: boolean;
  alias?: string;
}

export function parseArgs(argv: string[], flags: FlagSpec[]): { flags: Record<string, string | boolean>; rest: string[] } {
  const byName = new Map<string, FlagSpec>();
  for (const f of flags) {
    byName.set(f.name, f);
    if (f.alias) byName.set(f.alias, f);
  }
  const out: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('-')) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    let key = a;
    let val: string | undefined;
    if (eq > 0) {
      key = a.slice(0, eq);
      val = a.slice(eq + 1);
    }
    const spec = byName.get(key);
    if (!spec) {
      throw new Error(`Unknown argument: ${a}`);
    }
    if (spec.hasValue) {
      if (val === undefined) {
        i += 1;
        if (i >= argv.length) throw new Error(`${spec.name} requires a value`);
        val = argv[i];
      }
      out[spec.name] = val;
    } else {
      out[spec.name] = true;
    }
  }
  return { flags: out, rest };
}

export function parseHexInt(s: string, label: string): number {
  const n = Number.parseInt(s.replace(/^\$/, ''), 16);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${label}: ${s}`);
  return n;
}

export function wantHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export interface SharedPlaybackFlags {
  rom?: string;
  state?: string;
  out?: string;
  level?: number | null;
  owSubmap?: number;
  owX?: number;
  owY?: number;
  owHave: boolean;
}

const PLAYBACK_SPECS: FlagSpec[] = [
  { name: '--rom', hasValue: true },
  { name: '--state', hasValue: true },
  { name: '--out', hasValue: true },
  { name: '--level', hasValue: true },
  { name: '--ow-submap', hasValue: true },
  { name: '--ow-x', hasValue: true },
  { name: '--ow-y', hasValue: true },
];

export function parsePlaybackArgs(argv: string[], extra: FlagSpec[] = []): SharedPlaybackFlags & { extra: Record<string, string | boolean> } {
  const { flags } = parseArgs(argv, [...PLAYBACK_SPECS, ...extra]);
  const owSubmap = flags['--ow-submap'] != null ? Number(flags['--ow-submap']) : undefined;
  const owX = flags['--ow-x'] != null ? Number(flags['--ow-x']) : undefined;
  const owY = flags['--ow-y'] != null ? Number(flags['--ow-y']) : undefined;
  const owHave = owSubmap != null || owX != null || owY != null;
  let level: number | null | undefined;
  if (typeof flags['--level'] === 'string') {
    level = parseHexInt(flags['--level'], '--level');
  }
  const extraFlags: Record<string, string | boolean> = {};
  for (const f of extra) {
    if (flags[f.name] != null) extraFlags[f.name] = flags[f.name]!;
  }
  return {
    rom: flags['--rom'] as string | undefined,
    state: flags['--state'] as string | undefined,
    out: flags['--out'] as string | undefined,
    level,
    owSubmap,
    owX,
    owY,
    owHave,
    extra: extraFlags,
  };
}

export function requireRomState(p: SharedPlaybackFlags): { rom: string; state: string } {
  if (!p.rom) throw new Error('--rom is required');
  if (!p.state) throw new Error('--state is required');
  return { rom: p.rom, state: p.state };
}
