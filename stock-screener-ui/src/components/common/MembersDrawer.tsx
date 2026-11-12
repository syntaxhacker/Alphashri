import type { ReactNode } from "react";
import { ActionIcon, Alert, Box, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import { Portal } from "@/ui/layout/Portal";
import { IconChartLine, IconX } from "@tabler/icons-react";
import { SymbolTvLink } from "@/components/patterns/SymbolTvLink";
import * as palette from "@/ui/palette";

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

/** Per-surface typography; every other class of style is structural. */
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
  footerLeft?: ReactNode;
  footerRight?: ReactNode;

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
export function MembersDrawer({
  open,
  onClose,
  title,
  subtitle,
  description,
  symbols,
  loading,
  error,
  emptyNote,
  query,
  onQueryChange,
  searchPlaceholder,
  closeLabel,
  closeIconSize = 16,
  ids,
  footerLeft,
  footerRight,
  width,
  gridMin,
  gridGap = "4px",
  contentPx = 1,
  headerGap = 8,
  headerPy = 0.75,
  footerGap = 8,
  footerPy = 0.75,
  bodyPx = 0,
  searchStacked = false,
  rowBordered = true,
  rowRadius = 0.5,
  symbolPy = 0.5,
}: MembersDrawerProps) {
  if (!open) return null;

  const pad = (n: number) => `${n * 8}px`;
  const radius = typeof rowRadius === "number" ? `${rowRadius}px` : String(rowRadius);

  const drawerStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    right: 0,
    width,
    "max-width": "100%",
    height: "100%",
    "background-color": palette.SURFACE,
    borderLeft: `1px solid ${palette.BORDER}`,
    display: "flex",
    "flex-direction": "column",
    "min-width": 0,
    "z-index": 1300,
  };

  const headerStyle: React.CSSProperties = {
    "padding-left": pad(contentPx),
    "padding-right": pad(contentPx),
    "padding-top": pad(headerPy),
    "padding-bottom": pad(headerPy),
    borderBottom: `1px solid ${palette.BORDER}`,
  };

  const contentStyle: React.CSSProperties = {
    "padding-left": pad(contentPx),
    "padding-top": 6,
    "padding-bottom": 6,
    ...(searchStacked && { display: "flex", "flex-direction": "column", gap: 6 }),
  };

  const errorStyle: React.CSSProperties = {
    "padding-left": pad(contentPx),
    "padding-bottom": 8,
  };

  const bodyStyle: React.CSSProperties = {
    flex: 1,
    "min-height": 0,
    "overflow-y": "auto",
    "padding-left": pad(contentPx),
    "padding-right": pad(contentPx),
    "padding-bottom": 8,
  };

  const loaderStyle: React.CSSProperties = {
    display: "flex",
    "align-items": "center",
    gap: 6,
    "padding-top": 16,
    "padding-left": pad(bodyPx),
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    "grid-template-columns": `repeat(auto-fill, minmax(${gridMin}px, 1fr))`,
    gap: gridGap,
  };

  const rowClasses = rowBordered
    ? "flex items-center min-w-0 rounded-sm border border-fin-border bg-fin-bg hover:border-fin-primary hover:bg-fin-surface-alt"
    : "flex items-center min-w-0 rounded-sm hover:bg-fin-surface-alt";

  return (
    <Portal>
      <div
        data-testid={ids.drawer}
        className="flex flex-col h-full min-w-0"
        style={drawerStyle}
      >
        <ToolbarRow
          justify="space-between"
          gap={headerGap}
          wrap={false}
          className="border-b border-fin-border"
          style={headerStyle}
          data-testid={ids.drawer + "-header"}
        >
          <Box className="min-w-0">
            <Text fw={700} truncate >
              {title}
            </Text>
            <Text c="dimmed" truncate >
              {subtitle}
            </Text>
          </Box>
          <ActionIcon
            variant="subtle"
            size="sm"
            aria-label={closeLabel}
            onClick={onClose}
            data-testid={ids.close}
          >
            <IconX size={closeIconSize} />
          </ActionIcon>
        </ToolbarRow>

        <Box style={contentStyle}>
          <TextInput
            value={query}
            onChange={onQueryChange}
            size="xs"
            placeholder={searchPlaceholder}
            data-testid={ids.search}
            style={{ width: "100%" }}
          />
          {description ? (
            <Text c="dimmed" lineClamp={2} >
              {description}
            </Text>
          ) : null}
        </Box>

        {error ? (
          <Box style={errorStyle}>
            <Alert color="error" data-testid={ids.error}>
              {error}
            </Alert>
          </Box>
        ) : null}

        <Box style={bodyStyle}>
          {loading ? (
            <Box style={loaderStyle}>
              <Loader size="sm" />
              <Text size="xs" c="dimmed" >
                Loading members…
              </Text>
            </Box>
          ) : symbols.length === 0 ? (
            <Text
              size="xs"
              c="dimmed"

            >
              {query.trim() ? "No matching symbols" : (emptyNote ?? "No members available")}
            </Text>
          ) : (
            <Box style={gridStyle}>
              {symbols.map((symbol) => (
                <div
                  key={symbol}
                  data-testid={ids.row(symbol)}
                  className={rowClasses}
                  style={{ "border-radius": radius }}
                >
                  <Box
                    className="min-w-0 flex-1"
                    style={{
                      "padding-left": 4,
                      "padding-right": 4,
                      "padding-top": pad(symbolPy),
                      "padding-bottom": pad(symbolPy),
                    }}
                  >
                    <SymbolTvLink
                      symbol={symbol}
                      testId={ids.tv(symbol)}
                    >
                      <Text fw={600} truncate >
                        {symbol}
                      </Text>
                    </SymbolTvLink>
                  </Box>
                  <a
                    href={`/chart/${encodeURIComponent(symbol)}`}
                    title={`Open ${symbol} chart`}
                    data-testid={ids.chart(symbol)}
                    style={{
                      display: "inline-flex",
                      "align-items": "center",
                      "justify-content": "center",
                      width: 22,
                      height: 22,
                      "flex-shrink": 0,
                      color: palette.TEXT_MUTED,
                    }}
                  >
                    <IconChartLine size={13} />
                  </a>
                </div>
              ))}
            </Box>
          )}
        </Box>

        <ToolbarRow
          justify="space-between"
          gap={footerGap}
          wrap={false}
          className="border-t border-fin-border"
          style={{
            "padding-left": pad(contentPx),
            "padding-right": pad(contentPx),
            "padding-top": pad(footerPy),
            "padding-bottom": pad(footerPy),
            "background-color": palette.TERM_HEADER,
          }}
        >
          {footerLeft}
          {footerRight}
        </ToolbarRow>
      </div>
    </Portal>
  );
}
