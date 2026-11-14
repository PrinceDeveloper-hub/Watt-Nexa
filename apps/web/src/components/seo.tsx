import { useEffect } from 'react';
import { SITE_NAME, SOCIAL_IMAGE_PATH, absoluteUrl } from '@/lib/site';

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function upsertLink(rel: string, href: string) {
  let element = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

export interface SeoProps {
  title: string;
  description: string;
  /** Route path used for the canonical URL. Query strings are stripped. */
  path: string;
  noindex?: boolean;
  type?: 'website' | 'article';
  /** Absolute or site-relative image path. Defaults to the branded social card. */
  image?: string;
  jsonLd?: Record<string, unknown> | null;
}

/**
 * Head metadata is managed imperatively so the app needs no extra dependency.
 * Because this is a client-rendered SPA, index.html carries static defaults and
 * this component updates them per route.
 */
export function Seo({ title, description, path, noindex = false, type = 'website', image, jsonLd }: SeoProps) {
  useEffect(() => {
    document.title = title;

    const canonical = absoluteUrl(path);
    const socialImage = image ? (image.startsWith('http') ? image : `${absoluteUrl(image)}`) : `${absoluteUrl(SOCIAL_IMAGE_PATH)}`;

    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow');
    upsertLink('canonical', canonical);

    upsertMeta('property', 'og:site_name', SITE_NAME);
    upsertMeta('property', 'og:type', type);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', canonical);
    upsertMeta('property', 'og:image', socialImage);
    upsertMeta('property', 'og:image:alt', `${SITE_NAME} — ${title}`);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', socialImage);

    const existing = document.getElementById('wattnexa-jsonld');
    if (jsonLd) {
      const script = existing ?? document.createElement('script');
      script.id = 'wattnexa-jsonld';
      script.setAttribute('type', 'application/ld+json');
      script.textContent = JSON.stringify(jsonLd);
      if (!existing) document.head.appendChild(script);
    } else if (existing) {
      existing.remove();
    }
  }, [title, description, path, noindex, type, image, jsonLd]);

  return null;
}
