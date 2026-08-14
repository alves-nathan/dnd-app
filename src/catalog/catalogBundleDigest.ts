import type { DigestAdapter } from './types';

const rightRotate = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));

/** Pure TypeScript SHA-256 used on React Native without adding a native dependency. */
export const sha256Hex = (input: string): string => {
  const maxWord = 2 ** 32;
  const words: number[] = [];
  const ascii = unescape(encodeURIComponent(input));
  const bitLength = ascii.length * 8;
  const hash: number[] = [];
  const constants: number[] = [];
  const isComposite: Record<number, boolean> = {};
  let primeCounter = 0;

  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (isComposite[candidate]) continue;
    for (let multiple = candidate * candidate; multiple < 312; multiple += candidate) isComposite[multiple] = true;
    if (primeCounter < 8) hash[primeCounter] = (Math.sqrt(candidate) * maxWord) | 0;
    constants[primeCounter] = (Math.cbrt(candidate) * maxWord) | 0;
    primeCounter += 1;
  }

  let padded = `${ascii}\u0080`;
  while ((padded.length % 64) !== 56) padded += '\u0000';
  for (let index = 0; index < padded.length; index += 1) {
    const code = padded.charCodeAt(index);
    words[index >> 2] = (words[index >> 2] ?? 0) | (code << ((3 - (index % 4)) * 8));
  }
  words.push(Math.floor(bitLength / maxWord), bitLength);

  for (let offset = 0; offset < words.length; offset += 16) {
    const schedule = words.slice(offset, offset + 16);
    const working = hash.slice(0, 8);
    for (let index = 0; index < 64; index += 1) {
      const w15 = schedule[index - 15] ?? 0;
      const w2 = schedule[index - 2] ?? 0;
      const s0 = index < 16 ? 0 : rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = index < 16 ? 0 : rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      const word = index < 16 ? (schedule[index] ?? 0) : (((schedule[index - 16] ?? 0) + s0 + (schedule[index - 7] ?? 0) + s1) | 0);
      schedule[index] = word;
      const e = working[4] ?? 0;
      const a = working[0] ?? 0;
      const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & (working[5] ?? 0)) ^ (~e & (working[6] ?? 0));
      const temp1 = ((working[7] ?? 0) + sigma1 + choose + (constants[index] ?? 0) + word) | 0;
      const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & (working[1] ?? 0)) ^ (a & (working[2] ?? 0)) ^ ((working[1] ?? 0) & (working[2] ?? 0));
      const temp2 = (sigma0 + majority) | 0;
      working.unshift((temp1 + temp2) | 0);
      working[4] = ((working[4] ?? 0) + temp1) | 0;
      working.pop();
    }
    for (let index = 0; index < 8; index += 1) hash[index] = ((hash[index] ?? 0) + (working[index] ?? 0)) | 0;
  }

  return hash.slice(0, 8).map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
};

export const catalogDigestAdapter: DigestAdapter = {
  sha256: async (input: string) => sha256Hex(input)
};
