import { Show, splitProps, type JSX } from "solid-js";
import { ActionIcon, Box, CopyButton, Text, Tooltip, cn } from "@/ui";
import { IconChartCandle, IconCheck, IconCopy, IconExternalLink, IconChartArea } from "./Icons";
import { displaySymbol, tradingViewChartUrl } from "@/config/tvSymbols";
import { isUsMarket, useSymbolDock, type SymbolDockMode } from "./symbolDockContext";

// `solid-js` does not re-export JSX.CSSProperties from its package root.
type CSSProperties = JSX.CSSProperties;


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
  /**
   * Invert the two destinations: the symbol **text** becomes the in-app action
   * (a focusable button; Enter works) and TradingView moves to the `↗` affordance.
   * The default stays `false` so legacy TV-on-text call sites are unaffected.
   */
  inAppText?: boolean;
  /** Show the external-link affordance next to the text (default false). Forced on by `inAppText`. */
  tvIcon?: boolean;
  /** Show the trailing chart icon (default true). Set false for TV-only links. */
  showChart?: boolean;
  /**
   * Show the options-chain icon (default true). Opens the dock's options mode.
   * Non-F&O symbols are not pre-checked in P1 — the panel owns its own
   * "No listed options" state.
   */
  showOptions?: boolean;
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

export function SymbolLink(props: SymbolLinkProps) {
  const [local] = splitProps(props, [
    "symbol",
    "market",
    "tvSymbol",
    "onOpen",
    "onPreview",
    "onPreviewEnd",
    "tvLink",
    "inAppText",
    "tvIcon",
    "showChart",
    "showOptions",
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
  const inAppText = () => local.inAppText ?? false;
  const stopPropagation = () => local.stopPropagation ?? true;
  const raw = () => String(local.symbol ?? "");
  const label = () => displaySymbol(raw());
  const dock = useSymbolDock();
  // Only US markets change the dock call: the provider ignores `market` for
  // India, so forwarding NSE would be noise and would break hosts/mocks that
  // assert the established `open(symbol)` / `open(symbol, "options")` shape.
  const openDock = (symbol: string, nextMode?: SymbolDockMode) => {
    const market = isUsMarket(local.market) ? local.market : undefined;
    if (market === undefined) {
      if (nextMode === undefined) dock.open(symbol);
      else dock.open(symbol, nextMode);
      return;
    }
    if (nextMode === undefined) dock.open(symbol, "chart", market);
    else dock.open(symbol, nextMode, market);
  };
  const openInApp = (symbol: string) => {
    if (local.onOpen) {
      local.onOpen(symbol);
      return;
    }
    openDock(symbol);
  };
  // Hover no longer opens the chart. A symbol only opens on click; pages that
  // want a preview opt in explicitly with onPreview.
  const previewHandler = () => local.onPreview;
  const previewEndHandler = () => local.onPreviewEnd;
  const tvUrl = () => {
    if (!tvLink()) return "";
    if (local.tvSymbol) {
      const override = local.tvSymbol.trim();
      return override
        ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(override)}`
        : "";
    }
    // The raw feed symbol keeps its own exchange tag (e.g. BSE:TATA) so the
    // canonical helper cannot re-tag it to the surface's default market.
    return tradingViewChartUrl(raw(), local.market);
  };

  const stop = (event: MouseEvent) => {
    if (stopPropagation()) event.stopPropagation();
  };

  const handlePreview = (event: MouseEvent) => previewHandler()?.(label(), event);
  const handlePreviewEnd = () => previewEndHandler()?.(label());

  const handleTextClick = (event: MouseEvent) => {
    stop(event);
    if (local.onTextClick) {
      local.onTextClick(label(), event);
    }
  };

  const handleInAppTextClick = (event: MouseEvent) => {
    // Stop the row handler so a symbol click navigates exactly once.
    stop(event);
    if (local.onTextClick) {
      local.onTextClick(label(), event);
    } else {
      openInApp(label());
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
        <Show when={inAppText()}>
          <Box
            component="button"
            type="button"
            aria-label={local.ariaLabel ?? `Open ${label()} chart`}
            data-testid={local.testId}
            onClick={handleInAppTextClick}
            className={cn(
              "block min-w-0 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis border-0 bg-transparent p-0 text-left text-fin-text no-underline hover:text-fin-primary hover:underline focus-visible:underline",
              local.size === "xs" ? "text-xs" : local.size === "sm" || local.size === undefined ? "text-sm" : "text-base",
              local.textClassName,
            )}
            style={{ "font-weight": local.weight ?? 700 }}
          >
            {local.children ?? label()}
          </Box>
        </Show>
        <Show when={!inAppText() && local.onTextClick}>
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
        <Show when={!inAppText() && !local.onTextClick && tvLink() && tvUrl()}>
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
        <Show when={!inAppText() && !local.onTextClick && !(tvLink() && tvUrl())}>
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
              onMouseEnter={() => local.onPreviewEnd?.(label())}
              onClick={(event) => {
                event.stopPropagation();
                copy();
              }}
              aria-label={`Copy ${label()}`}
              data-testid={`symbol-copy-${label()}`}
            >
              {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            </ActionIcon>
          )}
        </CopyButton>
      </Show>

      <Show when={tvLink() && ((local.tvIcon ?? false) || inAppText()) && tvUrl()}>
        <Tooltip label={`${label()} on TradingView`}>
          <Box
            component="a"
            href={tvUrl()}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${label()} on TradingView`}
            data-testid={`symbol-tv-${label()}`}
            onClick={stop}
            className="pattern-tv-link inline-flex flex-shrink-0 items-center text-fin-text-muted hover:text-fin-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
          >
            <IconExternalLink size={12} />
          </Box>
        </Tooltip>
      </Show>

      <Show when={(local.showChart ?? true) && openInApp}>
        <Box
          component="button"
          type="button"
          aria-label={`Open ${label()} chart`}
          title={`Open ${label()} chart`}
          data-testid={local.chartTestId ?? `symbol-chart-${label()}`}
          onClick={(event) => {
            stop(event);
            openInApp(label());
          }}
          className="inline-flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-fin-text-muted hover:bg-white/[0.08] hover:text-fin-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
        >
          <IconChartCandle size={12} />
        </Box>
      </Show>

      <Show when={(local.showOptions ?? local.showChart ?? true) && dock.open}>
        <Tooltip label={`Options chain for ${label()}`}>
          <Box
            component="button"
            type="button"
            aria-label={`Open ${label()} options chain`}
            data-testid={`symbol-options-${label()}`}
            onClick={(event) => {
              stop(event);
              openDock(label(), "options");
            }}
            className="inline-flex h-[18px] w-[18px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent p-0 text-fin-text-muted hover:bg-white/[0.08] hover:text-fin-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-fin-primary)]"
          >
            <IconChartArea size={12} />
          </Box>
        </Tooltip>
      </Show>
    </Box>
  );
}
