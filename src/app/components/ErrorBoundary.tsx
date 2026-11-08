import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches a render error anywhere below it and offers a way back, instead of
 * React unmounting the whole page and leaving a blank window mid-rescue.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Board crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="h-[100dvh] flex items-center justify-center bg-gray-950 text-gray-100 p-4">
        <div className="max-w-lg w-full space-y-4 rounded-lg border border-red-800 bg-gray-900 p-6">
          <h1 className="text-lg font-semibold text-red-400">The board hit an error</h1>
          <p className="text-sm text-gray-300">
            Try again to carry on. If it keeps happening, reload the page.
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-950 p-3 text-xs text-gray-400">
            {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-orange-600 px-4 py-2 text-sm font-medium hover:bg-orange-500"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              type="button"
              className="rounded border border-gray-600 px-4 py-2 text-sm hover:bg-gray-800"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
