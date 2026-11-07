import type { ReactNode } from "react";
import type { SxProps, Theme } from "@mui/material/styles";
import Drawer from "@mui/material/Drawer";
import { ActionIcon, Alert, Box, Loader, Text, TextInput, ToolbarRow } from "@/ui";
import { IconChartLine, IconX } from "@tabler/icons-react";
import { SymbolTvLink } from "@/components/patterns/SymbolTvLink";

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
  title?: SxProps<Theme>;
  subtitle?: SxProps<Theme>;
  description?: SxProps<Theme>;
  symbol?: SxProps<Theme>;
  loading?: SxProps<Theme>;
  empty?: SxProps<Theme>;
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
  textSx?: MembersDrawerTextSx;
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
  textSx,
}: MembersDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{ zIndex: 1300 }}
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: width },
            maxWidth: "100%",
            bgcolor: "background.paper",
            backgroundImage: "none",
            borderLeft: "1px solid",
            borderColor: "divider",
          },
        },
      }}
    >
      <Box
        data-testid={ids.drawer}
        sx={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}
      >
        <ToolbarRow
          justify="space-between"
          gap={headerGap}
          wrap={false}
          sx={{ px: 1, py: headerPy, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Text fw={700} truncate sx={textSx?.title}>
              {title}
            </Text>
            <Text c="dimmed" truncate sx={textSx?.subtitle}>
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

        <Box
          sx={{
            px: contentPx,
            py: 0.75,
            ...(searchStacked && { display: "flex", flexDirection: "column", gap: 0.75 }),
          }}
        >
          <TextInput
            value={query}
            onChange={onQueryChange}
            size="xs"
            placeholder={searchPlaceholder}
            data-testid={ids.search}
            style={{ width: "100%" }}
          />
          {description ? (
            <Text c="dimmed" lineClamp={2} sx={textSx?.description}>
              {description}
            </Text>
          ) : null}
        </Box>

        {error ? (
          <Box sx={{ px: contentPx, pb: 1 }}>
            <Alert color="error" data-testid={ids.error}>
              {error}
            </Alert>
          </Box>
        ) : null}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 1, pb: 1 }}>
          {loading ? (
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 0.75, py: 2, px: bodyPx }}
            >
              <Loader size="sm" />
              <Text size="xs" c="dimmed" sx={textSx?.loading}>
                Loading members…
              </Text>
            </Box>
          ) : symbols.length === 0 ? (
            <Text
              size="xs"
              c="dimmed"
              sx={textSx?.empty ?? { display: "block", py: 2, px: bodyPx }}
            >
              {query.trim() ? "No matching symbols" : (emptyNote ?? "No members available")}
            </Text>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))`,
                gap: gridGap,
              }}
            >
              {symbols.map((symbol) => (
                <Box
                  key={symbol}
                  data-testid={ids.row(symbol)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    borderRadius: rowRadius,
                    minWidth: 0,
                    ...(rowBordered
                      ? {
                          border: "1px solid",
                          borderColor: "divider",
                          bgcolor: "background.default",
                          "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                        }
                      : { "&:hover": { bgcolor: "action.hover" } }),
                  }}
                >
                  <SymbolTvLink
                    symbol={symbol}
                    testId={ids.tv(symbol)}
                    sx={{ flex: 1, px: 0.5, py: symbolPy }}
                  >
                    <Text fw={600} truncate sx={textSx?.symbol}>
                      {symbol}
                    </Text>
                  </SymbolTvLink>
                  <Box
                    component="a"
                    href={`/chart/${encodeURIComponent(symbol)}`}
                    title={`Open ${symbol} chart`}
                    data-testid={ids.chart(symbol)}
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      flexShrink: 0,
                      color: "text.secondary",
                      "&:hover": { color: "primary.main" },
                    }}
                  >
                    <IconChartLine size={13} />
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <ToolbarRow
          justify="space-between"
          gap={footerGap}
          wrap={false}
          sx={{ px: contentPx, py: footerPy, borderTop: "1px solid", borderColor: "divider" }}
        >
          {footerLeft}
          {footerRight}
        </ToolbarRow>
      </Box>
    </Drawer>
  );
}
