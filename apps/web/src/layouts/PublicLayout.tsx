import { Menu, Moon, Sun, X } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/BrandLogo';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Seo } from '@/components/seo';
import { PageLoading } from '@/components/skeletons';
import { API_DOCS_URL, breadcrumbTrail, publicMeta, schemaForPath } from '@/lib/site';

const links = [
  { to: '/features', label: 'Features' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/blog', label: 'Resources' },
  { to: '/faq', label: 'FAQ' },
];

export function PublicLayout() {
  const { theme, toggle } = useTheme();
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const meta = publicMeta(location.pathname);
  const trail = breadcrumbTrail(location.pathname);
  const jsonLd = useMemo(() => schemaForPath(location.pathname), [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={meta.title}
        description={meta.description}
        path={location.pathname}
        type={location.pathname.startsWith('/blog/') ? 'article' : 'website'}
        jsonLd={jsonLd}
      />

      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-3 focus:py-2 focus:text-xs focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center" aria-label="WattNexa home">
            <BrandLogo className="h-9 w-[162px]" />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Public navigation">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
                    isActive && 'text-foreground',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            {isAuthenticated ? (
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">Get started</Link>
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setOpen((value) => !value)}
              aria-label="Toggle navigation"
              aria-expanded={open}
            >
              {open ? <X /> : <Menu />}
            </Button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-border bg-background md:hidden">
            <nav className="container flex flex-col py-2" aria-label="Public navigation">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          </div>
        ) : null}
      </header>

      {trail.length > 0 ? (
        <div className="border-b border-border/60">
          <div className="container py-2.5">
            <Breadcrumbs items={trail} />
          </div>
        </div>
      ) : null}

      <main id="main-content">
        <Suspense
          fallback={
            <div className="container py-12">
              <PageLoading label="Loading page" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <BrandLogo className="h-9 w-[162px]" />
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Know exactly where your electricity bill is going. Real-time monitoring, honest analytics and
              tariff-aware bill estimates.
            </p>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product</p>
            <ul className="space-y-2 text-sm">
              {['/features', '/how-it-works', '/pricing', '/faq'].map((to) => (
                <li key={to}>
                  <Link to={to} className="text-muted-foreground transition-colors hover:text-foreground">
                    {links.find((l) => l.to === to)?.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/about" className="text-muted-foreground hover:text-foreground">
                  About
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-muted-foreground hover:text-foreground">
                  Contact
                </Link>
              </li>
              <li>
                <Link to="/blog" className="text-muted-foreground hover:text-foreground">
                  Resources
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legal</p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-foreground">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-foreground">
                  Terms &amp; conditions
                </Link>
              </li>
              {API_DOCS_URL ? (
                <li>
                  <a
                    href={API_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    API documentation
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
        <div className="border-t border-border py-5">
          <div className="container flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} WattNexa. All rights reserved.</p>
            <p>Bill figures shown in the app are estimates, not your provider&apos;s official bill.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
