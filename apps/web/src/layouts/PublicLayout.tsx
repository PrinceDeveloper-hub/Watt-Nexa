import { Menu, Moon, Sun, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';
import { cn } from '@/lib/utils';

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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
              <Zap className="h-4 w-4 text-primary" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">WattNexa</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
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
                <Link to="/app">Dashboard</Link>
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
            <nav className="container flex flex-col py-2">
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

      <main>
        <Outlet />
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15">
                <Zap className="h-3.5 w-3.5 text-primary" />
              </span>
              <span className="font-bold">WattNexa</span>
            </div>
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
              <li>
                <a href="/docs" className="text-muted-foreground hover:text-foreground">
                  API documentation
                </a>
              </li>
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
