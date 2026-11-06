import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/** Shows a way out instead of a blank page when something in the UI throws while rendering. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div role="alert" className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="text-sm text-slate-400">
            The game hit an unexpected error. Reloading usually fixes it, and if you were in a game you
            can rejoin it for a short while.
          </p>
          <button
            type="button"
            autoFocus
            onClick={() => location.reload()}
            className="rounded-lg bg-amber-400 px-5 py-2 font-semibold text-slate-950 hover:bg-amber-300"
          >
            Reload
          </button>
        </div>
      </main>
    );
  }
}
