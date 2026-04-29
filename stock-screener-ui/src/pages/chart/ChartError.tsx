interface ChartErrorProps {
  onBackToScreener: () => void;
}

export function ChartError({ onBackToScreener }: ChartErrorProps) {
  return (
    <div className="chart-view-error" data-testid="chart-view-error">
      <p>No symbol specified</p>
      <button onClick={onBackToScreener} className="back-to-screener-btn">
        Back to Screener
      </button>
    </div>
  );
}
