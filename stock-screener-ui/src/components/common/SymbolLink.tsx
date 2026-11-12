import { Show, splitProps, type JSX, type CSSProperties } from "solid-js";
import { ActionIcon, Box, CopyButton, Text, Tooltip, cn } from "@/ui";
import { IconChartCandle, IconCheck, IconCopy, IconExternalLink } from "./Icons";
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
   * this fires on pointer enter and `onPreviewEnd` on leave. The native
   * mouseenter event is passed through so hosts can position a preview.
   */
  onPreview?: (symbol: string, event?: MouseEvent) => void;
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
  secondary?: JSX.Element;
  /** Optional custom content for the symbol text (overrides internal rendering). */
  children?: JSX.Element;
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
export function SymbolLink(props: SymbolLinkProps) {
  const [local] = splitProps(props, [
    "symbol",
    "market",
    "tvSymbol",
    "onOpen",
    "onPreview",
    "onPreviewEnd",
    "tvLink",
    "tvIcon",
    "showChart",
    "showCopy",
    "onTextClick",
    "testId",
    "chartTestId",
    "size",
    "weight",
    "secondary",
    "children",
    "ariaLabel",
    "stopPropagation",
    "className",
    "style",
    "textClassName",
  ]);
  const tvLink = () => local.tvLink ?? true;
  const stopPropagation = () => local.stopPropagation ?? true;
  const label = () => String(local.symbol ?? "");
  const dock = useSymbolDock();
  const openHandler = () => local.onOpen ?? dock.open;
  const previewHandler = () => local.onPreview ?? dock.preview;
  const previewEndHandler = () => local.onPreviewEnd ?? dock.endPreview;
  const tv = () => local.tvSymbol ?? tradingViewSymbol(label(), local.market);
  const tvUrl = () =>
    tvLink() && tv()
      ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tv()!)}`
      : "";

  const stop = (event: MouseEvent) => {
    if (stopPropagation()) event.stopPropagation();
  };

  const handlePreview = (event: MouseEvent) => previewHandler()(label(), event);
  const handlePreviewEnd = () => previewEndHandler()(label());

  const handleTextClick = (event: MouseEvent) => {
    stop(event);
    if (local.onTextClick) {
      local.onTextClick(label(), event);
    }
  };

  return (
    <Box
      data-testid={local.testId ? `${local.testId}-wrap` : undefined}
      onMouseEnter={handlePreview}
      onMouseLeave={handlePreviewEnd}
      className={cn("flex min-w-0 items-center gap-[2px]", local.className)}
      style={local.style}
    >
      <Box className="min-w-0 flex-1">
        <Show when={tvLink() && tvUrl()}>
          <Box
            component="a"
            href={tvUrl()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={local.ariaLabel ?? `Open ${label()} on TradingView`}
            data-testid={local.testId}
            onClick={stop}
            className="pattern-tv-link block min-w-0 overflow-hidden text-fin-text underline decoration-fin-border underline-offset-2 hover:text-fin-primary hover:decoration-fin-primary"
          >
            {local.children ?? <Text size={local.size ?? "sm"} fw={local.weight ?? 700} truncate className={local.textClassName}>{label()}</Text>}
          </Box>
        </Show>
        <Show when={!(tvLink() && tvUrl()) && local.onTextClick}>
          <Box
            component="button"
            type="button"
            aria-label={local.ariaLabel ?? `Open ${label()} chart`}
            data-testid={local.testId}
            onClick={handleTextClick}
            className={cn(
              "block min-w-0 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis border-0 bg-transparent p-0 text-fin-text no-underline hover:text-fin-primary",
              local.size === "xs" ? "text-xs" : local.size === "sm" || local.size === undefined ? "text-sm" : "text-base",
              local.textClassName,
            )}
            style={{ "font-weight": local.weight ?? 700 }}
          >
            {local.children ?? label()}
          </Box>
        </Show>
        <Show when={!(tvLink() && tvUrl()) && !local.onTextClick}>
          <Text size={local.size ?? "sm"} fw={local.weight ?? 700} truncate data-testid={local.testId} className={local.textClassName}>
            {local.children ?? label()}
          </Text>
        </Show>
        {local.secondary}
      </Box>

      <Show when={local.showCopy}>
        <CopyButton value={label()}>
          {({ copied, copy }) => (
            <ActionIcon
              variant="subtle"
              color={copied ? "info" : "secondary"}
              size="xs"
              style={{ width: "16px", height: "16px", "min-height": "16px", padding: "0px" }}
              onClick={(event) => {
                event.stopPropagation();
                copy();
              }}
              aria-label={`Copy ${label()}`}
              data-testid={`symbol-copy-${label()}`}
            >
              {copied ? <IconCheck size={10} /> : <IconCopy size={10} />}
            </ActionIcon>
          )}
        </CopyButton>
      </Show>

      <Show when={tvLink() && (local.tvIcon ?? false) && tvUrl()}>
        <Tooltip label={`${label()} on TradingView`}>
          <Box
            component="a"
            href={tvUrl()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label()} on TradingView`}
            onClick={stop}
            className="pattern-tv-link inline-flex flex-shrink-0 items-center text-fin-text-muted hover:text-fin-primary"
          >
            <IconExternalLink size={11} />
          </Box>
        </Tooltip>
      </Show>

      <Show when={(local.showChart ?? true) && openHandler()}>
        <Box
          component="button"
          type="button"
          aria-label={`Open ${label()} chart`}
          title={`Open ${label()} chart`}
          data-testid={local.chartTestId ?? `symbol-chart-${label()}`}
          onClick={(event) => {
            stop(event);
            openHandler()(label());
          }}
          className="inline-flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-fin-text-muted hover:bg-white/[0.08] hover:text-fin-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
        >
          <IconChartCandle size={12} />
        </Box>
      </Show>
    </Box>
  );
}
