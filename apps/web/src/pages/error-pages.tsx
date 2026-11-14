import { ArrowLeft, Compass, LayoutDashboard, LifeBuoy, RefreshCw, ShieldX, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { Seo } from '@/components/seo';
import { Button } from '@/components/ui/button';

function ErrorFrame({
  code,
  icon: Icon,
  title,
  description,
  actions,
  footer,
}: {
  code: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" aria-hidden />
      <div className="pointer-events-none absolute inset-0 hero-glow" aria-hidden />

      <header className="relative container flex h-16 items-center justify-between">
        <Link to="/" aria-label="WattNexa home">
          <BrandLogo className="h-9 w-[162px]" />
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Error {code}
        </span>
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-soft">
            <Icon className="h-6 w-6" />
          </span>
          <p className="metric mt-6 text-[64px] font-semibold leading-none text-primary/25 sm:text-[80px]">{code}</p>
          <h1 className="display mt-1 text-2xl font-semibold sm:text-3xl">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{actions}</div>
          {footer ? <div className="mt-6 text-[11px] leading-relaxed text-muted-foreground">{footer}</div> : null}
        </div>
      </main>

      <footer className="relative container flex flex-col gap-1 border-t border-border/70 py-5 text-[10px] text-muted-foreground sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} WattNexa</span>
        <span>Bill figures in the app are estimates, not your provider&apos;s official bill.</span>
      </footer>
    </div>
  );
}

export function NotFound() {
  return (
    <>
      <Seo
        title="Page not found · WattNexa"
        description="This page does not exist. Return to WattNexa, open your dashboard or explore the product."
        path="/404"
        noindex
      />
      <ErrorFrame
        code="404"
        icon={Compass}
        title="This page does not exist"
        description="The link may be outdated, or the route may have moved. Nothing about your household data has changed."
        actions={
          <>
            <Button asChild>
              <Link to="/dashboard">
                <LayoutDashboard />
                Open dashboard
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft />
                Back home
              </Link>
            </Button>
          </>
        }
        footer={
          <span>
            Looking for the product?{' '}
            <Link to="/features" className="font-medium text-primary hover:underline">
              Explore features
            </Link>{' '}
            or{' '}
            <Link to="/contact" className="font-medium text-primary hover:underline">
              contact support
            </Link>
            .
          </span>
        }
      />
    </>
  );
}

export function Forbidden() {
  return (
    <>
      <Seo
        title="Access denied · WattNexa"
        description="Your account does not have permission to open this workspace."
        path="/403"
        noindex
      />
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-primary shadow-soft">
          <ShieldX className="h-6 w-6" />
        </span>
        <p className="metric mt-6 text-[56px] font-semibold leading-none text-primary/25">403</p>
        <h1 className="display mt-2 text-2xl font-semibold">You do not have access to this workspace</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          This area is limited to platform administrators and support staff. Your household dashboard, devices and
          billing remain available.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/dashboard">
              <LayoutDashboard />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/contact">
              <LifeBuoy />
              Contact support
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}

export function ServerError({ detail }: { detail?: string }) {
  return (
    <>
      <Seo
        title="Something went wrong · WattNexa"
        description="WattNexa could not render this view. Reload the app or return home."
        path="/500"
        noindex
      />
      <ErrorFrame
        code="500"
        icon={TriangleAlert}
        title="Something broke on our side"
        description="This view could not be rendered. Your stored readings are safe. Reload the app; if it keeps happening, send support the time this occurred."
        actions={
          <>
            <Button onClick={() => window.location.reload()}>
              <RefreshCw />
              Reload the app
            </Button>
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft />
                Back home
              </Link>
            </Button>
          </>
        }
        footer={
          <span>
            Still blocked?{' '}
            <Link to="/contact" className="font-medium text-primary hover:underline">
              Contact support
            </Link>
            .
            {import.meta.env.DEV && detail ? (
              <span className="mt-2 block break-words font-mono text-[10px] text-destructive">{detail}</span>
            ) : null}
          </span>
        }
      />
    </>
  );
}
