import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
  stack?: string;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Unknown render error',
      stack: error?.stack,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Keep console output for debugging in devtools.
    // eslint-disable-next-line no-console
    console.error('[AppErrorBoundary] Render crash caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 z-[999] bg-[#F3F5F9] p-4">
        <div className="mx-auto mt-8 w-full max-w-3xl rounded-xl border border-red-300 bg-red-50 p-4 text-red-900 shadow-xl">
          <div className="text-sm font-semibold">Application Render Error</div>
          <div className="mt-2 text-sm">{this.state.message}</div>
          {this.state.stack && (
            <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-red-100 p-3 text-xs leading-5">
{this.state.stack}
            </pre>
          )}
          <div className="mt-3 text-xs text-red-700">Please refresh the page after copying this error.</div>
        </div>
      </div>
    );
  }
}

