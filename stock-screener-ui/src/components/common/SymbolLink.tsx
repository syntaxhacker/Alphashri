import type { ReactNode, MouseEvent , CSSProperties} from "react";
import { ActionIcon, Box, CopyButton, Text, Tooltip, cn } from "@/ui";
import { IconChartCandle, IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
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
  /** Copy the symbol to the clipboard (default false). Rendered after the symbol text. */
  showCopy?: boolean;
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
  /** Stop row-click handlers (default true, matches the previous links). */
  stopPropagation?: boolean;
  /** Additional class on the wrapper. */
  className?: string;
  /** Inline style merge. */
  style?: CSSProperties;
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
  showCopy = false,
  onTextClick,
  testId,
  chartTestId,
  size = "sm",
  weight = 700,
  secondary,
  children,
  ariaLabel,
  stopPropagation = true,
  className,
  style,
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
      data-testid={testId ? `${testId}-wrap` : undefined}
      onMouseEnter={handlePreview}
      onMouseLeave={handlePreviewEnd}
      className={cn("flex min-w-0 items-center gap-[2px]", className)}
      style={style}
    >
      <Box className="min-w-0 flex-1">
        {tvLink && tvUrl ? (
          <Box
            component="a"
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={ariaLabel ?? `Open ${label} on TradingView`}
            data-testid={testId}
            onClick={stop}
            className="pattern-tv-link block min-w-0 overflow-hidden text-fin-text underline decoration-fin-border underline-offset-2 hover:text-fin-primary hover:decoration-fin-primary"
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
            className={cn(
              "block min-w-0 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis border-0 bg-transparent p-0 text-fin-text no-underline hover:text-fin-primary",
              size === "xs" ? "text-xs" : size === "sm" ? "text-sm" : "text-base",
              textClassName,
            )}
            style={{ "font-weight": weight }}
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

      {showCopy ? (
        <CopyButton value={label}>
          {({ copied, copy }) => (
            <ActionIcon
              variant="subtle"
              color={copied ? "info" : "secondary"}
              size="xs"
              style={{ width: 16, height: 16, "min-height": 16, padding: 0 }}
              onClick={(event) => {
                event.stopPropagation();
                copy();
              }}
              aria-label={`Copy ${label}`}
              data-testid={`symbol-copy-${label}`}
            >
              {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
            </ActionIcon>
          )}
        </CopyButton>
      ) : null}

      {tvLink && tvIcon && tvUrl ? (
        <Tooltip label={`${label} on TradingView`}>
          <Box
            component="a"
            href={tvUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label} on TradingView`}
            onClick={stop}
            className="pattern-tv-link inline-flex flex-shrink-0 items-center text-fin-text-muted hover:text-fin-primary"
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
          className="inline-flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-fin-text-muted hover:bg-white/[0.08] hover:text-fin-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
        >
          <IconChartCandle size={12} />
        </Box>
      ) : null}
    </Box>
  );
}
