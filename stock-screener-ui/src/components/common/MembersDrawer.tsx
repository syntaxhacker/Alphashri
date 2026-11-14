import { For, Show, type JSX } from "solid-js";
import { ActionIcon, Alert, Box, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import { Portal } from "@/ui/layout/Portal";
import { IconChartLine, IconX } from "./Icons";
import { SymbolTvLink } from "@/components/patterns/SymbolTvLink";
import * as palette from "@/ui/palette";

// `solid-js` does not re-export JSX.CSSProperties from its package root.
type CSSProperties = JSX.CSSProperties;


/**
 * Legacy testids. Each surface keeps its own naming scheme, so the ids are
 * passed as functions rather than assembled from a prefix.
 */
export interface MembersDrawerTestIds {
  drawer: string;
  close: string;
  search: string;
  /** Only set on surfaces that expose an error testid. */
  error?: string;
  row: (symbol: string) => string;
  tv: (symbol: string) => string;
  chart: (symbol: string) => string;
}

export interface MembersDrawerTextSx {
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  symbol?: unknown;
  loading?: unknown;
  empty?: unknown;
}

export interface MembersDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  description?: string;

  /** Already filtered by the caller — the drawer only renders. */
  symbols: string[];
  loading: boolean;
  error: string | null;
  emptyNote?: string;

  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder: string;

  closeLabel: string;
  closeIconSize?: number;

  ids: MembersDrawerTestIds;
  /** Footer slots are styled by the caller so their copy can stay surface-specific. */
  footerLeft?: JSX.Element;
  footerRight?: JSX.Element;

  width: number;
  gridMin: number;
  gridGap?: string;
  contentPx?: number;
  headerGap?: number;
  headerPy?: number;
  footerGap?: number;
  footerPy?: number;
  bodyPx?: number;
  /** Stack the filter input above the description (adds flex column + gap). */
  searchStacked?: boolean;
  rowBordered?: boolean;
  rowRadius?: number | string;
  symbolPy?: number;
}

/**
 * Presentational shell shared by the patterns index-members drawer and the
 * sector theme-members drawer. Data fetching, filtering and footer copy stay in
 * the surface wrappers; the drawer owns the frame, filter, states and rows.
 */
export function MembersDrawer(props: MembersDrawerProps) {
  const pad = (n: number) => `${n * 8}px`;
  const closeIconSize = () => props.closeIconSize ?? 16;
  const contentPx = () => props.contentPx ?? 1;
  const headerGap = () => props.headerGap ?? 8;
  const headerPy = () => props.headerPy ?? 0.75;
  const footerGap = () => props.footerGap ?? 8;
  const footerPy = () => props.footerPy ?? 0.75;
  const bodyPx = () => props.bodyPx ?? 0;
  const gridGap = () => props.gridGap ?? "4px";
  const rowBordered = () => props.rowBordered ?? true;
  const searchStacked = () => props.searchStacked ?? false;
  const radius = () => {
    const r = props.rowRadius ?? 0.5;
    return typeof r === "number" ? `${r}px` : String(r);
  };

  const drawerStyle: CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    width: `${props.width}px`,
    "max-width": "100%",
    height: "100%",
    "background-color": palette.SURFACE,
    "border-left": `1px solid ${palette.BORDER}`,
    display: "flex",
    "flex-direction": "column",
    "min-width": 0,
    "z-index": 1300,
  };

  const headerStyle: CSSProperties = {
    "padding-left": pad(contentPx()),
    "padding-right": pad(contentPx()),
    "padding-top": pad(headerPy()),
    "padding-bottom": pad(headerPy()),
    "border-bottom": `1px solid ${palette.BORDER}`,
  };

  const contentStyle: CSSProperties = {
    "padding-left": pad(contentPx()),
    "padding-top": "6px",
    "padding-bottom": "6px",
    ...(searchStacked() ? { display: "flex", "flex-direction": "column", gap: "6px" } : {}),
  };

  const errorStyle: CSSProperties = {
    "padding-left": pad(contentPx()),
    "padding-bottom": "8px",
  };

  const bodyStyle: CSSProperties = {
    flex: 1,
    "min-height": 0,
    "overflow-y": "auto",
    "padding-left": pad(contentPx()),
    "padding-right": pad(contentPx()),
    "padding-bottom": "8px",
  };

  const loaderStyle: CSSProperties = {
    display: "flex",
    "align-items": "center",
    gap: "6px",
    "padding-top": "16px",
    "padding-left": pad(bodyPx()),
  };

  const gridStyle: CSSProperties = {
    display: "grid",
    "grid-template-columns": `repeat(auto-fill, minmax(${props.gridMin}px, 1fr))`,
    gap: gridGap(),
  };

  const rowClasses = () =>
    rowBordered()
      ? "flex items-center min-w-0 rounded-sm border border-fin-border bg-fin-bg hover:border-fin-primary hover:bg-fin-surface-alt"
      : "flex items-center min-w-0 rounded-sm hover:bg-fin-surface-alt";

  // Zero-arg render thunk, passed as an Element: `Show` only accepts a
  // parameterised render function, but calling the child lazily is what keeps
  // the `<Portal>` out of `document.body` while the drawer is closed.
  const body = (() => (
        <Portal>
          <div
            data-testid={props.ids.drawer}
            className="flex flex-col h-full min-w-0"
            style={drawerStyle}
          >
            <ToolbarRow
              justify="space-between"
              gap={headerGap()}
              wrap={false}
              className="border-b border-fin-border"
              style={headerStyle}
              data-testid={props.ids.drawer + "-header"}
            >
              <Box className="min-w-0">
                <Text fw={700} truncate >
                  {props.title}
                </Text>
                <Text c="dimmed" truncate >
                  {props.subtitle}
                </Text>
              </Box>
              <ActionIcon
                variant="subtle"
                size="sm"
                aria-label={props.closeLabel}
                onClick={props.onClose}
                data-testid={props.ids.close}
              >
                <IconX size={closeIconSize()} />
              </ActionIcon>
            </ToolbarRow>

            <Box style={contentStyle}>
              <TextInput
                value={props.query}
                onChange={props.onQueryChange}
                size="xs"
                placeholder={props.searchPlaceholder}
                data-testid={props.ids.search}
                style={{ width: "100%" }}
              />
              <Show when={props.description}>
                <Text c="dimmed" lineClamp={2} >
                  {props.description}
                </Text>
              </Show>
            </Box>

            <Show when={props.error}>
              <Box style={errorStyle}>
                <Alert color="error" data-testid={props.ids.error}>
                  {props.error}
                </Alert>
              </Box>
            </Show>

            <Box style={bodyStyle}>
              <Show
                when={props.loading}
                fallback={
                  <Show
                    when={props.symbols.length > 0}
                    fallback={
                      <Text size="xs" c="dimmed" >
                        {props.query.trim() ? "No matching symbols" : (props.emptyNote ?? "No members available")}
                      </Text>
                    }
                  >
                    <Box style={gridStyle}>
                      <For each={props.symbols}>
                        {(symbol) => (
                          <div
                            data-testid={props.ids.row(symbol)}
                            className={rowClasses()}
                            style={{ "border-radius": radius() }}
                          >
                            <Box
                              className="min-w-0 flex-1"
                              style={{
                                "padding-left": "4px",
                                "padding-right": "4px",
                                "padding-top": pad(props.symbolPy ?? 0.5),
                                "padding-bottom": pad(props.symbolPy ?? 0.5),
                              }}
                            >
                              <SymbolTvLink
                                symbol={symbol}
                                testId={props.ids.tv(symbol)}
                              >
                                <Text fw={600} truncate >
                                  {symbol}
                                </Text>
                              </SymbolTvLink>
                            </Box>
                            <a
                              href={`/chart/${encodeURIComponent(symbol)}`}
                              title={`Open ${symbol} chart`}
                              data-testid={props.ids.chart(symbol)}
                              style={{
                                display: "inline-flex",
                                "align-items": "center",
                                "justify-content": "center",
                                width: "22px",
                                height: "22px",
                                "flex-shrink": 0,
                                color: palette.TEXT_MUTED,
                              }}
                            >
                              <IconChartLine size={13} />
                            </a>
                          </div>
                        )}
                      </For>
                    </Box>
                  </Show>
                }
              >
                <Box style={loaderStyle}>
                  <Loader size="sm" />
                  <Text size="xs" c="dimmed" >
                    Loading members…
                  </Text>
                </Box>
              </Show>
            </Box>

            <ToolbarRow
              justify="space-between"
              gap={footerGap()}
              wrap={false}
              className="border-t border-fin-border"
              style={{
                "padding-left": pad(contentPx()),
                "padding-right": pad(contentPx()),
                "padding-top": pad(footerPy()),
                "padding-bottom": pad(footerPy()),
                "background-color": palette.TERM_HEADER,
              }}
            >
              {props.footerLeft}
              {props.footerRight}
            </ToolbarRow>
          </div>
        </Portal>
  )) as unknown as JSX.Element;

  return <Show when={props.open}>{body}</Show>;
}
