import type { ReactNode, MouseEvent } from "react";
import { Box, Text, Tooltip } from "@/ui";
import { IconChartCandle, IconExternalLink } from "@tabler/icons-react";
import { tradingViewSymbol } from "@/config/tvSymbols";
import { useSymbolDock } from "./symbolDockContext";

export interface SymbolLinkProps {
  symbol: string;
  /** Exchange for the TradingView symbol (defaults to NSE). */
  market?: string;
  /** Explicit TradingView symbol override (e.g. `NASDAQ:AAPL`). */
  tvSymbol?: string;
  /**
   * In-app chart handler (the trailing chart icon). Defaults to the app-wide
   * `SymbolDockProvider`; pass an explicit handler on pages that own a richer
   * chart surface (the Patterns dock with stepper/replay).
   */
  onOpen?: (symbol: string) => void;
  /**
   * Hover intent. The HOST owns the debounce (one place for the whole app);
   * this fires on pointer enter and `onPreviewEnd` on leave.
   */
  onPreview?: (symbol: string) => void;
  onPreviewEnd?: (symbol: string) => void;
  /** Render the symbol text as an external TradingView link (default true). */
  tvLink?: boolean;
  /** Show the external-link affordance next to the text (default false). */
  tvIcon?: boolean;
  /** Show the trailing chart icon (default true). Set false for TV-only links. */
  showChart?: boolean;
  /** Click handler for the symbol text when NOT a TV link (ClickableSymbol use case). */
  onTextClick?: (symbol: string, event: MouseEvent) => void;
  /** Test id for the TradingView link / text button (kept for existing contracts). */
  testId?: string;
  /** Test id for the chart icon (default `symbol-chart-<SYMBOL>`). */
  chartTestId?: string;
  /** Text size token. */
  size?: "xs" | "sm" | "md";
  /** Text weight. */
  weight?: number;
  /** Optional secondary line (company name, pattern name…). */
  secondary?: ReactNode;
  /** Optional custom content for the symbol text (overrides internal rendering). */
  children?: ReactNode;
  /** Explicit aria-label for the text link/button. */
  ariaLabel?: string;
  /** Extra wrapper layout only (flex/width); the link skin stays shared. */
  sx?: Record<string, unknown>;
  /** Stop row-click handlers (default true, matches the previous links). */
  stopPropagation?: boolean;
  /** Additional class on the wrapper. */
  className?: string;
  /** Additional class on the text element (link or button). */
  textClassName?: string;
}

/**
 * The app-wide symbol affordance.
 *
 * - Symbol text → TradingView (new tab) when `tvLink=true`, preserving the existing patterns
 *   contract (`patterns-*-tv-*` test ids).
 * - When `tvLink=false` and `onTextClick` is provided, the text renders as a button
 *   with the custom click handler (ClickableSymbol use case).
 * - Trailing chart icon → the in-app right-side chart (`onOpen`); the host
 *   decides whether that is a dock, a widget or a route. Controlled by `showChart`.
 * - Hover → `onPreview`; the host debounces and decides whether a preview is
 *   allowed (e.g. desktop only, and not while a chart is pinned).
 *
 * Router-free by design: it renders only when `onOpen` is supplied, so
 * presentational tests and storybook don't need a navigation context.
 */
export function SymbolLink({
  symbol,
  market,
  tvSymbol,
  onOpen,
  onPreview,
  onPreviewEnd,
  tvLink = true,
  tvIcon = false,
  showChart = true,
  onTextClick,
  testId,
  chartTestId,
  size = "sm",
  weight = 700,
  secondary,
  children,
  ariaLabel,
  sx,
  stopPropagation = true,
  className,
  textClassName,
}: SymbolLinkProps) {
  const label = String(symbol ?? "");
  const dock = useSymbolDock();
  const openHandler = onOpen ?? dock.open;
  const previewHandler = onPreview ?? dock.preview;
  const previewEndHandler = onPreviewEnd ?? dock.endPreview;
  const tv = tvSymbol ?? tradingViewSymbol(label, market);
  const tvUrl =
    tvLink && tv
      ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv)}`
      : "";

  const stop = (event: MouseEvent) => {
    if (stopPropagation) event.stopPropagation();
  };

  const handlePreview = () => previewHandler(label);
  const handlePreviewEnd = () => previewEndHandler(label);

  const handleTextClick = (event: MouseEvent) => {
    stop(event);
    if (onTextClick) {
      onTextClick(label, event);
    }
  };

  return (
    <Box
      className={className}
      data-testid={testId ? `${testId}-wrap` : undefined}
      onMouseEnter={handlePreview}
      onMouseLeave={handlePreviewEnd}
      sx={{ display: "flex", alignItems: "center", gap: "2px", minWidth: 0, ...sx }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        {tvLink && tvUrl ? (
          <Box
            component="a"
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={ariaLabel ?? `Open ${label} on TradingView`}
            data-testid={testId}
            className="pattern-tv-link"
            onClick={stop}
            sx={{
              display: "block",
              minWidth: 0,
              overflow: "hidden",
              color: "text.primary",
              textDecoration: "underline",
              textDecorationColor: "divider",
              textUnderlineOffset: "2px",
              "&:hover": { color: "primary.main", textDecorationColor: "primary.main" },
            }}
          >
            {children ?? <Text size={size} fw={weight} truncate className={textClassName}>{label}</Text>}
          </Box>
        ) : onTextClick ? (
          <Box
            component="button"
            type="button"
            aria-label={ariaLabel ?? `Open ${label} chart`}
            data-testid={testId}
            onClick={handleTextClick}
            className={textClassName}
            sx={{
              display: "block",
              minWidth: 0,
              overflow: "hidden",
              color: "text.primary",
              textDecoration: "none",
              background: "transparent",
              border: 0,
              padding: 0,
              font: "inherit",
              cursor: "pointer",
              fontWeight: weight,
              fontSize: size === "xs" ? "0.75rem" : size === "sm" ? "0.875rem" : "1rem",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              "&:hover": { color: "primary.main" },
            }}
          >
            {children ?? label}
          </Box>
        ) : (
          <Text size={size} fw={weight} truncate data-testid={testId} className={textClassName}>
            {children ?? label}
          </Text>
        )}
        {secondary}
      </Box>

      {tvLink && tvIcon && tvUrl ? (
        <Tooltip label={`${label} on TradingView`}>
          <Box
            component="a"
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label} on TradingView`}
            className="pattern-tv-link"
            onClick={stop}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              flexShrink: 0,
              color: "text.secondary",
              "&:hover": { color: "primary.main" },
            }}
          >
            <IconExternalLink size={11} />
          </Box>
        </Tooltip>
      ) : null}

      {showChart && openHandler ? (
        <Box
          component="button"
          type="button"
          aria-label={`Open ${label} chart`}
          title={`Open ${label} chart`}
          data-testid={chartTestId ?? `symbol-chart-${label}`}
          onClick={(event) => {
            stop(event);
            openHandler(label);
          }}
          sx={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            width: 18,
            height: 18,
            p: 0,
            border: 0,
            borderRadius: "4px",
            bgcolor: "transparent",
            color: "text.secondary",
            cursor: "pointer",
            "&:hover": { color: "primary.main", bgcolor: "action.hover" },
            "&:focus-visible": {
              outline: "2px solid var(--mui-palette-primary-main)",
              outlineOffset: 1,
            },
          }}
        >
          <IconChartCandle size={12} />
        </Box>
      ) : null}
    </Box>
  );
}
