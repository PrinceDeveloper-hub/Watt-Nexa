import * as React from 'react';
import { ServerError } from '@/pages/error-pages';

interface State {
  error: Error | null;
}

/**
 * Catches render-time failures so users never see a blank screen or a raw
 * stack trace. Errors are still reported to the console for monitoring.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('WattNexa render error:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return <ServerError detail={this.state.error.message} />;
    }
    return this.props.children;
  }
}
