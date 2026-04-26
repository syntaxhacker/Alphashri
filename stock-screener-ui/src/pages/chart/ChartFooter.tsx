import type { ChartPreviewData } from "../../api/chartPreview";

interface ChartFooterProps {
  data: ChartPreviewData;
  timeframe: number;
  orMinutes: number;
}

export function ChartFooter({ data, timeframe, orMinutes }: ChartFooterProps) {
  return (
    <div className="chart-view-footer" id="chart-footer" data-testid="chart-footer">
      <span>{data.candles.length} candles</span>
      <span>•</span>
      <span>TF: {timeframe}m</span>
      <span>•</span>
      <span>OR: {orMinutes}m</span>
      {data.high_52w && (
        <>
          <span>•</span>
          <span>52W High: ₹{data.high_52w.toFixed(2)}</span>
        </>
      )}
    </div>
  );
}
