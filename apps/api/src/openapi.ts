export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'WattNexa API',
    version: '1.0.0',
    description:
      'IoT electricity monitoring platform API. All routes are versioned under /api/v1. Responses use { success, data } or { success, error }.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Auth' },
    { name: 'Homes' },
    { name: 'Devices' },
    { name: 'Telemetry' },
    { name: 'Energy' },
    { name: 'Billing' },
    { name: 'Alerts' },
    { name: 'WattBot' },
    { name: 'Admin' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'wnx_at' },
      deviceToken: { type: 'http', scheme: 'bearer' },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    '/auth/register': { post: { tags: ['Auth'], summary: 'Create an account and send a verification code' } },
    '/auth/login': { post: { tags: ['Auth'], summary: 'Sign in and set session cookies' } },
    '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate the refresh token' } },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke the current session' } },
    '/auth/verify-email': { post: { tags: ['Auth'], summary: 'Verify the email code' } },
    '/auth/forgot-password': { post: { tags: ['Auth'], summary: 'Request a reset link' } },
    '/auth/reset-password': { post: { tags: ['Auth'], summary: 'Reset a password with a token' } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user profile' } },
    '/homes': {
      get: { tags: ['Homes'], summary: 'List households' },
      post: { tags: ['Homes'], summary: 'Create a household' },
    },
    '/devices': { get: { tags: ['Devices'], summary: 'List devices with latest readings' } },
    '/devices/pair': { post: { tags: ['Devices'], summary: 'Redeem a pairing code' } },
    '/telemetry': {
      post: {
        tags: ['Telemetry'],
        summary: 'Ingest a device reading',
        security: [{ deviceToken: [] }],
        description:
          'Authenticated by a per-device bearer token. Omit measurements the hardware cannot sense; null is reported as unavailable, never zero.',
      },
    },
    '/energy/overview': { get: { tags: ['Energy'], summary: 'Dashboard totals, series, bill estimate and insights' } },
    '/energy/series': { get: { tags: ['Energy'], summary: 'Bucketed energy series' } },
    '/billing/estimate': { get: { tags: ['Billing'], summary: 'Progressive slab bill estimate' } },
    '/billing/tariffs': {
      get: { tags: ['Billing'], summary: 'List tariffs' },
      post: { tags: ['Billing'], summary: 'Create a tariff with slabs' },
    },
    '/alerts': { get: { tags: ['Alerts'], summary: 'List alerts' } },
    '/alerts/notifications': { get: { tags: ['Alerts'], summary: 'Notification centre' } },
    '/wattbot/messages': { post: { tags: ['WattBot'], summary: 'Ask WattBot a question' } },
    '/admin/overview': { get: { tags: ['Admin'], summary: 'Platform metrics' } },
    '/admin/users': { get: { tags: ['Admin'], summary: 'List users' } },
    '/admin/audit-logs': { get: { tags: ['Admin'], summary: 'Audit trail' } },
  },
} as const;
