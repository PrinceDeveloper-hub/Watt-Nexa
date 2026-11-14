export { brand, env, isProduction, isTest } from '@wattnexa/config';

export const appConfig = {
  apiPrefix: '/api/v1',
  cookies: {
    access: 'wnx_at',
    refresh: 'wnx_rt',
  },
  /** Access tokens are short-lived; the refresh token carries the session. */
  accessTokenTtlSeconds: 15 * 60,
  maxPageSize: 100,
  defaultPageSize: 20,
  upload: {
    maxBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'],
  },
} as const;

/** Roles allowed into the admin workspace. */
export const ADMIN_ROLES = ['admin', 'super_admin', 'support_agent'] as const;
