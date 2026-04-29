import { forwardRef } from "react";

interface ChartBodyProps {
  loading: boolean;
  error: string | null;
  chartError: string | null;
  hasData: boolean;
}

export const ChartBody = forwardRef<HTMLDivElement, ChartBodyProps>(
  ({ loading, error, chartError, hasData }, ref) => {
    const displayError = error || chartError;

    return (
      <div className="chart-view-body" id="chart-body" data-testid="chart-body">
        {loading && (
          <div className="chart-loading" data-testid="chart-loading">
            <p>Loading chart...</p>
          </div>
        )}

        {displayError && !loading && (
          <div className="chart-error" data-testid="chart-error">
            <p>{displayError}</p>
            <button
              onClick={() => window.location.reload()}
              data-testid="chart-retry-btn"
              className="retry-btn"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !displayError && hasData && (
          <div
            ref={ref}
            className="chart-container-full"
            data-testid="candlestick-chart"
            id="candlestick-chart"
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>
    );
  },
);

ChartBody.displayName = "ChartBody";
