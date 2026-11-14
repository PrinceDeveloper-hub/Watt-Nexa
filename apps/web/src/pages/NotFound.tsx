import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be outdated. Head back to the dashboard or the homepage.
      </p>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/">Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
