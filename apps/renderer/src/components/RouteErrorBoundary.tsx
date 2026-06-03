import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Renderer-wide safety net. Before this, ANY uncaught error thrown while
// rendering a route unmounted the whole React tree → a totally blank window
// with no message. Now a crash is contained to the content area and shown as a
// legible card with the actual error text (so the user can report it) and a
// reload. Keyed by route so navigating away clears the error.

type Props = { children: ReactNode; fallbackTitle: string; reloadLabel: string };
type State = { error: Error | null };

class ErrorBoundaryInner extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaces in DevTools + the prospero debug log so a blank-page report has a
    // stack to act on.
    console.error("[renderer] uncaught render error:", error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-surface-card border border-surface-border rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-ink">{this.props.fallbackTitle}</h2>
          <pre className="mt-3 text-xs text-semantic-danger whitespace-pre-wrap break-words font-mono">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-5 px-4 py-2 bg-brand text-brand-fg text-sm rounded-lg font-semibold"
          >
            {this.props.reloadLabel}
          </button>
        </div>
      </div>
    );
  }
}

// Functional wrapper: re-keys the boundary on navigation so moving to another
// route clears a prior crash, and supplies i18n labels.
export const RouteErrorBoundary = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const { t } = useTranslation();
  return (
    <ErrorBoundaryInner
      key={location.pathname}
      fallbackTitle={t("errorBoundary.title")}
      reloadLabel={t("errorBoundary.reload")}
    >
      {children}
    </ErrorBoundaryInner>
  );
};
