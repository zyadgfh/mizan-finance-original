import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { PillButton } from "@/components/finance/ui";
import { logSafeError } from "@/lib/finance/error-log";
import { tr } from "@/lib/finance/i18n";
import { getUiPrefs } from "@/lib/finance/prefs";
import { useFinance } from "@/lib/finance/store";

type ErrorBoundaryProps = {
  children: ReactNode;
  scopeName?: string;
  routeName?: string;
  tabName?: string;
  onGoHome?: () => void;
};

type ErrorBoundaryState = {
  hasError: boolean;
  refId: string;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, refId: "" };

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const knownPeople = useFinance.getState().people.map((p) => p.name);
    const safe = logSafeError(error, {
      boundary: this.props.scopeName ?? "app",
      route: this.props.routeName,
      tab: this.props.tabName,
      knownPeople,
    });
    this.setState({ refId: safe.id });
  }

  private reset = () => {
    this.setState({ hasError: false, refId: "" });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const lang = getUiPrefs().language;
    const dir = lang === "en" ? "ltr" : "rtl";

    return (
      <div
        dir={dir}
        role="alert"
        data-testid="mizan-error-boundary"
        className="flex min-h-[280px] flex-col items-center justify-center px-6 py-12 text-center"
      >
        <div className="surface-card w-full max-w-md rounded-card p-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-pill bg-expense/15 text-expense">
            <AlertTriangle size={24} />
          </div>
          <h2 className="mt-4 text-title3 font-bold text-label">{tr("errorTitle", lang)}</h2>
          <p className="mt-2 text-sub text-label-2">{tr("errorBody", lang)}</p>
          {this.state.refId ? (
            <p className="mt-3 text-caption text-label-3" dir="ltr">
              {tr("errorCodeLabel", lang)}: #{this.state.refId}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <PillButton onClick={this.reset}>
              <RotateCcw size={15} />
              <span>{tr("errorRetry", lang)}</span>
            </PillButton>
            {this.props.onGoHome ? (
              <PillButton
                tone="gray"
                onClick={() => {
                  this.reset();
                  this.props.onGoHome?.();
                }}
              >
                <Home size={15} />
                <span>{tr("errorGoHome", lang)}</span>
              </PillButton>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}
