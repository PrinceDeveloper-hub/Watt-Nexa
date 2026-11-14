import { env } from '../config';

/**
 * Allowed browser origins. Entries are matched exactly, except patterns using
 * a leading wildcard label (`https://*.vercel.app`) which match any single or
 * multi-level subdomain — needed because every Vercel preview deployment gets
 * a fresh hostname.
 */
export function allowedOrigins(): string[] {
  return [...new Set([...env.CORS_ORIGINS, env.WEB_URL])];
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins().some((pattern) => {
    if (pattern === origin) return true;
    if (!pattern.includes('*')) return false;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(origin);
  });
}
