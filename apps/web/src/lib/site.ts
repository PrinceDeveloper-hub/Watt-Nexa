/**
 * Single source of truth for canonical URLs, public page metadata and the
 * JSON-LD graph. Everything derives from VITE_SITE_URL so a custom domain can
 * be adopted without touching pages.
 */

export const SITE_NAME = 'WattNexa';
export const SITE_TAGLINE = 'Know exactly where your electricity bill is going.';

const configuredSiteUrl = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();

function browserOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

export const SITE_URL = (configuredSiteUrl || browserOrigin() || 'https://wattnexa.example').replace(/\/+$/, '');

export const SOCIAL_IMAGE_PATH = '/branding/og-image.png';

export function absoluteUrl(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? '/';
  if (clean === '/' || clean === '') return `${SITE_URL}/`;
  return `${SITE_URL}${clean.startsWith('/') ? clean : `/${clean}`}`.replace(/\/+$/, '');
}

export const API_ORIGIN = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

export const API_DOCS_URL = `${API_ORIGIN}/docs`;

export interface PageMeta {
  title: string;
  description: string;
}

/**
 * Public metadata is unique per route. Descriptions deliberately say what the
 * page actually contains — no keyword stuffing.
 */
export const PUBLIC_META: Record<string, PageMeta> = {
  '/': {
    title: 'WattNexa — Know exactly where your electricity bill is going',
    description:
      'WattNexa monitors household electricity from a clamp-on sensor, prices every kWh with your own tariff slabs and explains what changed. Simulated data is always labelled.',
  },
  '/features': {
    title: 'Features · WattNexa',
    description:
      'Live power metrics, tariff-aware bill estimates, peak and base-load analysis, threshold alerts, exports and a grounded energy assistant — all scoped to your household.',
  },
  '/how-it-works': {
    title: 'How it works · WattNexa',
    description:
      'From a clamp-on CT sensor to rupees: install the sensor, pair the ESP32, stream readings over MQTT or HTTP, configure your tariff and compare the estimate with the real bill.',
  },
  '/pricing': {
    title: 'Pricing · WattNexa',
    description:
      'Compare WattNexa plans. Every plan measures the same values honestly; paid plans add longer history, WattBot message allowances and CSV/PDF exports.',
  },
  '/faq': {
    title: 'Frequently asked questions · WattNexa',
    description:
      'Answers on sensor installation, tariff configuration, estimated versus official bills, simulated data labelling, device security and how WattBot answers questions.',
  },
  '/about': {
    title: 'About · WattNexa',
    description:
      'WattNexa is built around one question: where is the money going? Read why unavailable readings stay empty and every cost figure is labelled as an estimate.',
  },
  '/contact': {
    title: 'Contact WattNexa',
    description:
      'Reach the WattNexa team about plans, hardware integration, support or partnerships. Messages go to a person, not a ticket black hole.',
  },
  '/blog': {
    title: 'Resources · WattNexa',
    description:
      'Short notes on electricity tariffs, clamp sensors, kWh-to-rupee arithmetic and the gap between what a meter measures and what a provider bills.',
  },
  '/privacy': {
    title: 'Privacy policy · WattNexa',
    description:
      'How WattNexa handles account details, household configuration, device metadata and telemetry, and the controls available for export, revocation and deletion.',
  },
  '/terms': {
    title: 'Terms & conditions · WattNexa',
    description:
      'The terms that apply to WattNexa: estimates rather than official bills, simulated data labelling, device safety, acceptable use and service availability.',
  },
};

const BREADCRUMB_LABELS: Record<string, string> = {
  '/features': 'Features',
  '/how-it-works': 'How it works',
  '/pricing': 'Pricing',
  '/faq': 'FAQ',
  '/about': 'About',
  '/contact': 'Contact',
  '/blog': 'Resources',
  '/privacy': 'Privacy policy',
  '/terms': 'Terms & conditions',
};

export function publicMeta(pathname: string): PageMeta {
  const clean = pathname !== '/' ? pathname.replace(/\/+$/, '') : '/';
  if (PUBLIC_META[clean]) return PUBLIC_META[clean];
  if (clean.startsWith('/blog/')) {
    return {
      title: 'Article · WattNexa Resources',
      description:
        'A WattNexa note on measuring household electricity honestly, reading tariff slabs and turning kWh into the amount you actually pay.',
    };
  }
  return {
    title: 'Page not found · WattNexa',
    description: 'The page you requested does not exist. Return to WattNexa or open your dashboard.',
  };
}

export function breadcrumbTrail(pathname: string): Array<{ name: string; path: string }> {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return [];
  if (clean.startsWith('/blog/')) {
    return [
      { name: 'Home', path: '/' },
      { name: 'Resources', path: '/blog' },
      { name: 'Article', path: clean },
    ];
  }
  const label = BREADCRUMB_LABELS[clean];
  if (!label) return [];
  return [
    { name: 'Home', path: '/' },
    { name: label, path: clean },
  ];
}

/**
 * Organization, WebSite and SoftwareApplication live statically in index.html so
 * non-JS crawlers receive them without executing the bundle. The client only
 * emits the route-specific BreadcrumbList, avoiding duplicate schema blocks.
 * No address, telephone, rating, review or price offer is declared because none
 * can be verified from this repository.
 */
export function schemaForPath(pathname: string): Record<string, unknown> | null {
  const trail = breadcrumbTrail(pathname);
  if (trail.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    '@id': `${absoluteUrl(pathname)}#breadcrumb`,
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}
