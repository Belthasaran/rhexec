/**
 * rle0: 0x00 <len> means <len> zeros (len 1–255). Any other byte is literal.
 * Zip-friendly when left as raw; rle0 still round-trips identical RAM to identical encoding.
 */

export function encodeRle0(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] !== 0) {
      out.push(input[i]);
      i += 1;
      continue;
    }
    let n = 0;
    while (i < input.length && input[i] === 0 && n < 255) {
      n += 1;
      i += 1;
    }
    out.push(0, n);
  }
  return Uint8Array.from(out);
}

export function decodeRle0(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const b = input[i];
    if (b !== 0) {
      out.push(b);
      i += 1;
      continue;
    }
    if (i + 1 >= input.length) {
      throw new Error('rle0: truncated zero run');
    }
    const n = input[i + 1];
    if (n < 1) {
      throw new Error('rle0: zero run length must be 1–255');
    }
    for (let k = 0; k < n; k += 1) out.push(0);
    i += 2;
  }
  return Uint8Array.from(out);
}

export function maybeEncode(data: Uint8Array, encoding: 'raw' | 'rle0'): Uint8Array {
  return encoding === 'rle0' ? encodeRle0(data) : data;
}

export function maybeDecode(data: Uint8Array, encoding: 'raw' | 'rle0'): Uint8Array {
  return encoding === 'rle0' ? decodeRle0(data) : data;
}
