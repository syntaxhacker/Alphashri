import { ChartControls } from "./ChartControls";

interface ChartHeaderProps {
  symbol: string;
  timeframe: number;
  orMinutes: number;
  showPivots: boolean;
  show52wHigh: boolean;
  onBack: () => void;
  onTimeframeChange: (value: number) => void;
  onOrMinutesChange: (value: number) => void;
  onPivotsChange: (checked: boolean) => void;
  on52wHighChange: (checked: boolean) => void;
}

export function ChartHeader({
  symbol,
  timeframe,
  orMinutes,
  showPivots,
  show52wHigh,
  onBack,
  onTimeframeChange,
  onOrMinutesChange,
  onPivotsChange,
  on52wHighChange,
}: ChartHeaderProps) {
  return (
    <div className="chart-view-header" id="chart-header" data-testid="chart-header">
      <button className="back-btn" onClick={onBack} data-testid="chart-back-btn">
        ← Back
      </button>
      <h2 className="chart-title" data-testid="chart-title">
        {symbol}
      </h2>

      <ChartControls
        timeframe={timeframe}
        orMinutes={orMinutes}
        showPivots={showPivots}
        show52wHigh={show52wHigh}
        onTimeframeChange={onTimeframeChange}
        onOrMinutesChange={onOrMinutesChange}
        onPivotsChange={onPivotsChange}
        on52wHighChange={on52wHighChange}
      />
    </div>
  );
}
