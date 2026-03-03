/**
 * Chart View Component
 *
 * Full page chart view at /chart/:symbol
 * Shows candlestick chart with timeframe and OR minutes controls.
 */

import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchChartPreview, ChartPreviewData } from "../../api/chartPreview";
import { buildChartOption } from "./chartRenderer";

const TIMEFRAMES = [
  { value: 1, label: "1m" },
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
];

const OR_MINUTES = [
  { value: 30, label: "OR 30m" },
  { value: 45, label: "OR 45m" },
  { value: 60, label: "OR 60m" },
];

const ChartView: React.FC = () => {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();

  const [data, setData] = useState<ChartPreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(15);
  const [orMinutes, setOrMinutes] = useState(45);
  const [showPivots, setShowPivots] = useState(true);

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
      size: "full",
      showPivots,
    });

    if (!chartOption) {
      setError("Failed to build chart");
      return;
    }

    // Initialize chart
    chartInstanceRef.current = (window as any).echarts.init(chartRef.current);
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
  }, [data, showPivots, loading]);

  if (!symbol) {
    return (
      <div className="chart-view-error">
        <p>No symbol specified</p>
        <button onClick={() => navigate("/")}>Back to Screener</button>
      </div>
    );
  }

  return (
    <div className="chart-view" data-testid="chart-view">
      <div className="chart-view-header">
        <button className="back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h2 className="chart-title">{symbol}</h2>

        <div className="chart-controls">
          <div className="control-group">
            <label>Timeframe:</label>
            <select value={timeframe} onChange={(e) => setTimeframe(parseInt(e.target.value))}>
              {TIMEFRAMES.map((tf) => (
                <option key={tf.value} value={tf.value}>
                  {tf.label}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label>OR:</label>
            <select value={orMinutes} onChange={(e) => setOrMinutes(parseInt(e.target.value))}>
              {OR_MINUTES.map((or) => (
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
              />
              Pivots
            </label>
          </div>
        </div>
      </div>

      <div className="chart-view-body">
        {loading && (
          <div className="chart-loading">
            <p>Loading chart...</p>
          </div>
        )}

        {error && (
          <div className="chart-error">
            <p>{error}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}

        {!loading && !error && data && (
          <div
            ref={chartRef}
            className="chart-container-full"
            data-testid="candlestick-chart"
            style={{ width: "100%", height: "100%" }}
          />
        )}
      </div>

      {data && (
        <div className="chart-view-footer">
          <span>{data.candles.length} candles</span>
          <span>•</span>
          <span>TF: {timeframe}m</span>
          <span>•</span>
          <span>OR: {orMinutes}m</span>
        </div>
      )}
    </div>
  );
};

export default ChartView;
