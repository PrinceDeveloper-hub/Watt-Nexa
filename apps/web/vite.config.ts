import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const PUBLIC_PATHS = [
  '/',
  '/features',
  '/how-it-works',
  '/pricing',
  '/faq',
  '/about',
  '/contact',
  '/blog',
  '/privacy',
  '/terms',
];

const PRIVATE_PATHS = [
  '/dashboard',
  '/devices',
  '/energy-analytics',
  '/billing',
  '/wattbot',
  '/alerts',
  '/settings',
  '/admin',
  '/app',
  '/login',
  '/register',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/api/',
];

/**
 * Emits sitemap.xml and robots.txt with absolute canonical URLs derived from
 * VITE_SITE_URL, and injects the site origin into index.html. The fallback
 * domain is the reserved `.example` TLD so a build can never accidentally
 * claim a domain we do not own.
 */
function wattnexaSeo(mode: string): Plugin {
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
  const env = loadEnv(mode, repoRoot, '');
  const configured = (env.VITE_SITE_URL || process.env.VITE_SITE_URL || '').trim();
  const fallback = mode === 'production' ? 'https://wattnexa.example' : 'http://localhost:5173';
  const siteUrl = (configured || fallback).replace(/\/+$/, '');

  if (!configured) {
    console.warn(
      `[wattnexa-seo] VITE_SITE_URL is not set. Canonical URLs and sitemap entries use ${siteUrl}. Set VITE_SITE_URL to the production origin before deploying.`,
    );
  }

  return {
    name: 'wattnexa-seo',
    transformIndexHtml(html) {
      return html.replace(/%SITE_URL%/g, siteUrl);
    },
    generateBundle() {
      const urls = PUBLIC_PATHS.map((path) => `  <url><loc>${siteUrl}${path === '/' ? '/' : path}</loc></url>`).join(
        '\n',
      );
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      const robots = [
        '# WattNexa — public marketing pages are crawlable; the application is not.',
        'User-agent: *',
        'Allow: /',
        '',
        '# Authenticated application and account flows',
        ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
        '',
        `Sitemap: ${siteUrl}/sitemap.xml`,
        '',
      ].join('\n');

      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), wattnexaSeo(mode)],
  // Load the repository-root .env so VITE_* values behave the same in dev and build.
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@wattnexa/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@wattnexa/types': fileURLToPath(new URL('../../packages/types/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('framer-motion')) return 'motion';
          return 'vendor';
        },
      },
    },
  },
}));
