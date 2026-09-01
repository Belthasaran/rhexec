import { decode, encode } from '@msgpack/msgpack';
import { maybeDecode, maybeEncode } from './rle0.ts';
import { RHSTATE1_MAGIC, RHSTATE1_VERSION, normalizeCpu, type RhState1, type RhState1Section, type SectionEncoding } from './types.ts';

function assertUint8(data: unknown, label: string): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Buffer.isBuffer(data)) return new Uint8Array(data);
  throw new Error(`${label}: expected binary`);
}

export function encodeRhState1(state: RhState1, zeros: SectionEncoding = 'raw'): Buffer {
  const sections = state.sections.map((s) => {
    const decoded = maybeDecode(s.data, s.encoding);
    const encoding = zeros;
    return {
      id: s.id,
      bus: s.bus,
      encoding,
      data: maybeEncode(decoded, encoding),
    };
  });
  const doc = {
    ...state,
    v: state.v ?? RHSTATE1_VERSION,
    sections,
  };
  const packed = encode(doc);
  return Buffer.concat([RHSTATE1_MAGIC, Buffer.from(packed)]);
}

export function decodeRhState1(file: Uint8Array): RhState1 {
  if (file.length < 8) throw new Error('rhstate1: file too small');
  const magic = Buffer.from(file.subarray(0, 8));
  if (!magic.equals(RHSTATE1_MAGIC)) {
    throw new Error(`rhstate1: bad magic ${magic.toString('latin1')}`);
  }
  const doc = decode(file.subarray(8)) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object') throw new Error('rhstate1: expected msgpack map');
  const rawSections = Array.isArray(doc.sections) ? doc.sections : [];
  const sections: RhState1Section[] = rawSections.map((s: Record<string, unknown>) => {
    const encoding = (s.encoding === 'rle0' ? 'rle0' : 'raw') as SectionEncoding;
    return {
      id: String(s.id) as RhState1Section['id'],
      bus: Number(s.bus) || 0,
      encoding,
      data: assertUint8(s.data, String(s.id)),
    };
  });
  return {
    ...(doc as object),
    v: Number(doc.v) || 0,
    profile: (doc.profile as RhState1['profile']) || 'in_level',
    rom: doc.rom as RhState1['rom'],
    host: doc.host as RhState1['host'],
    cpu: normalizeCpu(doc.cpu as RhState1['cpu']),
    trigger: doc.trigger as RhState1['trigger'],
    sections,
  } as RhState1;
}

export function getSectionDecoded(state: RhState1, id: string): Uint8Array | null {
  const sec = state.sections.find((s) => s.id === id);
  if (!sec) return null;
  return maybeDecode(sec.data, sec.encoding);
}

export function setSectionRaw(state: RhState1, id: RhState1Section['id'], bus: number, data: Uint8Array, encoding: SectionEncoding): void {
  const idx = state.sections.findIndex((s) => s.id === id);
  const sec: RhState1Section = { id, bus, encoding: 'raw', data };
  if (idx >= 0) state.sections[idx] = sec;
  else state.sections.push(sec);
  if (encoding === 'rle0') {
    const stored = state.sections[idx >= 0 ? idx : state.sections.length - 1];
    stored.encoding = 'rle0';
    stored.data = maybeEncode(data, 'rle0');
  }
}
