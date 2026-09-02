/** Mesen 2 `Serializer::NormalizeName` — used for `.mss` keys and `emu.setState`. */

export function mesenNormalize(name: string, index = -1): string {
  let valName = name.charAt(0) === '_' ? name.slice(1) : name;
  if (valName.length > 6 && valName.startsWith('state.')) valName = valName.slice(6);
  const arr = [...valName];
  const len = arr.length;
  for (let i = 0; i < len; i += 1) {
    const c = arr[i]!;
    if (c >= 'A' && c <= 'Z') {
      arr[i] = c.toLowerCase();
    } else {
      const pos = arr.indexOf('.', i);
      if (pos < 0) break;
      i = pos;
    }
  }
  valName = arr.join('');
  if (index >= 0) {
    const pos = valName.indexOf('[i]');
    if (pos >= 0) {
      valName = `${valName.slice(0, pos)}[${index}]${valName.slice(pos + 3)}`;
    } else {
      valName += `[${index}]`;
    }
  }
  return valName;
}

export function mesenKey(prefix: string, name: string, index = -1): string {
  return prefix + mesenNormalize(name, index);
}
