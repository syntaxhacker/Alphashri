import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMantineColorScheme } from "@mantine/core";
import { fetchChartPreview, ChartPreviewData } from "../../api/chartPreview";
import { buildChartOption } from "../../components/chart/chartRenderer";
import { TIMEFRAMES, OR_MINUTES_OPTIONS } from "../../config/constants";

const ChartView: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const [data, setData] = useState<ChartPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(15);
  const [orMinutes, setOrMinutes] = useState(45);
  const [showPivots, setShowPivots] = useState(true);
  const [show52wHigh, setShow52wHigh] = useState(true);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);

  // Fetch chart data
  useEffect(() => {
    if (!symbol) return;

    setLoading(true);
    setError(null);

    fetchChartPreview(symbol, timeframe, 5, orMinutes)
      .then((result) => {
        if (!result) {
          setError("No data available");
        } else if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load chart");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [symbol, timeframe, orMinutes]);

  // Render chart when data changes
  useEffect(() => {
    if (!data || !chartRef.current || loading) return;

    // Check if echarts is available
    if (!(window as any).echarts) {
      setError("ECharts not loaded");
      return;
    }

    // Dispose previous chart
    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
    }

    // Build chart option
    const chartOption = buildChartOption({
      symbol: data.symbol,
      candles: data.candles,
      orb_zones: data.orb_zones,
      pivot_levels: data.pivot_levels,
      high_52w: data.high_52w,
      size: "full",
      showPivots,
      show52wHigh,
      isDark,
    });

    if (!chartOption) {
      setError("Failed to build chart");
      return;
    }

    // Initialize chart
    chartInstanceRef.current = (window as any).echarts.init(
      chartRef.current,
      isDark ? "dark" : null,
    );
    chartInstanceRef.current.setOption(chartOption);

    // Handle resize
    const handleResize = () => {
      chartInstanceRef.current?.resize();
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartInstanceRef.current?.dispose();
    };
  }, [data, showPivots, show52wHigh, loading, isDark]);

  if (!symbol) {
    return (
      <div className="chart-view-error" data-testid="chart-view-error">
        <p>No symbol specified</p>
        <button onClick={() => navigate("/")}>Back to Screener</button>
      </div>
    );
  }

  return (
    <div className="chart-view" data-testid="chart-view" id="chart-view">
      <div className="chart-view-header" id="chart-header" data-testid="chart-header">
        <button className="back-btn" onClick={() => navigate(-1)} data-testid="chart-back-btn">
          ← Back
        </button>
        <h2 className="chart-title" data-testid="chart-title">
          {symbol}
        </h2>

        <div className="chart-controls" id="chart-controls" data-testid="chart-controls">
          <div className="control-group">
            <label>Timeframe:</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(parseInt(e.target.value))}
              data-testid="chart-timeframe-select"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf.value} value={tf.value}>
                  {tf.label}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>OR:</label>
            <select
              value={orMinutes}
              onChange={(e) => setOrMinutes(parseInt(e.target.value))}
              data-testid="chart-or-select"
            >
              {OR_MINUTES_OPTIONS.map((or) => (
                <option key={or.value} value={or.value}>
                  {or.label}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>
              <input
                type="checkbox"
                checked={showPivots}
                onChange={(e) => setShowPivots(e.target.checked)}
                data-testid="chart-pivots-checkbox"
              />
              Pivots
            </label>
          </div>

          <div className="control-group">
            <label>
              <input
                type="checkbox"
                checked={show52wHigh}
                onChange={(e) => setShow52wHigh(e.target.checked)}
                data-testid="chart-52w-checkbox"
              />
              52W High
            </label>
          </div>
        </div>
      </div>

      <div className="chart-view-body" id="chart-body" data-testid="chart-body">
        {loading && (
          <div className="chart-loading" data-testid="chart-loading">
            <p>Loading chart...</p>
          </div>
        )}

        {error && (
          <div className="chart-error" data-testid="chart-error">
            <p>{error}</p>
            <button onClick={() => window.location.reload()} data-testid="chart-retry-btn">
              Retry
            </button>
          </div>
        )}

        {!loading && !error && data && (
          <div
            ref={chartRef}
            className="chart-container-full"
            data-testid="candlestick-chart"
            id="candlestick-chart"
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>

      {data && (
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
      )}
    </div>
  );
};

export default ChartView;
