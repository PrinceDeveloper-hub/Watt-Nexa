import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('hex');

/** Six digits, zero-padded, cryptographically random. */
export const randomNumericCode = (): string =>
  String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Constant-time-ish comparison for equal-length secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
