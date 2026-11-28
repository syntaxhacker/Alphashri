import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Box, Button, Select, Skeleton, Text, ToolbarRow, useMediaQuery } from "@/ui";
import {
  alpha,
  VIZ_BG,
  VIZ_DOWN,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_TEXT,
  VIZ_UP,
} from "@/ui/palette";
import { TZ_IST } from "@/config/constants";
import { marketColorRampCss, marketTileColor } from "./marketTreemap";
import { fetchSectorGroups } from "@/api/sector";
import { fetchThemeDetail } from "@/api/rotation";
import type { SectorGroup, SectorPeriod } from "@/types/sector";
import type { MarketRow } from "@/types/marketScreener";
import type { ThemeDetailResponse } from "@/types/rotation";
import type { VisRenderProps } from "./MarketMapView";

export const THEME_PERIODS = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"] as const;
const PERIOD_OPTIONS = THEME_PERIODS.map((value) => ({ value, label: value }));
const PERIOD_SET = new Set<string>(THEME_PERIODS);

function isThemePeriod(value: unknown): value is SectorPeriod {
  return typeof value === "string" && PERIOD_SET.has(value);
}

/**
 * The backend's stable theme key. Sectors/industries have no slug, so there is
 * deliberately no name-derived fallback — that would request a URL the API
 * cannot resolve.
 */
export function themeSlug(group: SectorGroup): string | null {
  const slug = group.slug;
  return typeof slug === "string" && slug.trim() !== "" ? slug.trim() : null;
}

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * Heatmap-tab red → neutral → green ramp with a square-root move. A small
 * signed change stays visible beside a large one; zero is the ramp midpoint.
 * Bar *length* stays linear (themeBarGeometry) — only the fill is curved.
 */
export function themeBarColor(change: number, extent: number): string {
  const value = finite(change);
  const span = Number.isFinite(extent) && extent > 0 ? extent : 1;
  const curved = Math.sign(value) * span * Math.sqrt(Math.min(Math.abs(value) / span, 1));
  return marketTileColor(curved, -span, span);
}

/** Zero-centred bar: each half-track is 50% of the track, scaled to max |change|. */
export function themeBarGeometry(change: number, extent: number): { left: string; width: string } {
  const span = Number.isFinite(extent) && extent > 0 ? extent : 1;
  const t = Math.min(Math.abs(finite(change)) / span, 1);
  const width = `${(t * 50).toFixed(3)}%`;
  return finite(change) < 0
    ? { left: `${(50 - t * 50).toFixed(3)}%`, width }
    : { left: "50%", width };
}

/** Backend timestamps are UTC; the desk clock is IST, like every other UI time. */
export function asOfTime(raw: string | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: TZ_IST,
    }).format(date);
  } catch {
    return "—";
  }
}

const changeText = (value: number): string =>
  `${value > 0 ? "+" : ""}${finite(value).toFixed(2)}%`;

const breadthPct = (value: number | null | undefined): string =>
  typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "—";

const breadthText = (group: SectorGroup): string =>
  `H ${breadthPct(group.near_high_pct)} · L ${breadthPct(group.near_low_pct)}`;

const medianTip = (group: SectorGroup): string =>
  `median ${breadthPct(group.median_pos_52w)} of 52W range`;

const tooltipText = (group: SectorGroup): string =>
  `${group.name} · ${changeText(group.change)} · ${group.stock_count} stocks · ` +
  `${group.advances} advances / ${group.declines} declines`;

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Failed to load themes";

interface ThemeMember {
  symbol: string;
  name: string;
  change: number;
  cap: number | null;
  relVol: number | null;
}

const relVolText = (value: number | null): string =>
  value === null ? "—" : `${value.toFixed(1)}×`;

const relVolTip = (value: number | null): string =>
  value === null ? "rel vol n/a" : `rel vol ${value.toFixed(1)}×`;

/**
 * Market → Vis "Themes": a sorted, zero-centred diverging bar chart (the D3
 * horizontal-bar form, with ECharts-style negative bars). One fetch per period
 * with an AbortController; a superseded response is dropped even if it lands
 * last. Selection opens the constituents beside (wide) or above (narrow) the
 * chart, never instead of it, and the full name is always printed in the row.
 */
export function ThemeBoard(props: VisRenderProps) {
  const [period, setPeriod] = createSignal<SectorPeriod>("1D");
  const [reload, setReload] = createSignal(0);
  const [groups, setGroups] = createSignal<SectorGroup[]>([]);
  const [lastUpdated, setLastUpdated] = createSignal<string | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<SectorGroup | null>(null);
  const [detail, setDetail] = createSignal<ThemeDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<string | null>(null);
  const [detailReload, setDetailReload] = createSignal(0);
  const [focusRequested, setFocusRequested] = createSignal(false);
  const desktop = useMediaQuery("(min-width: 900px)", true);

  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;

  /** Only an explicit selection moves focus; an initial render never does. */
  const selectTheme = (group: SectorGroup) => {
    setFocusRequested(true);
    setSelected(group);
  };

  createEffect(() => {
    const selectedPeriod = period();
    // Read to register the retry counter as a dependency; the value is not used.
    const _attempt = reload();
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    setLoading(true);
    setError(null);
    setSelected(null);
    setDetail(null);

    void fetchSectorGroups({
      classify: "theme",
      period: selectedPeriod,
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted || listController !== controller) return;
        setGroups(payload.groups ?? []);
        setLastUpdated(payload.last_updated);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || listController !== controller) return;
        setError(errorMessage(reason));
        setGroups([]);
        setLoading(false);
      });
  });

  createEffect(() => {
    const group = selected();
    const slug = group ? themeSlug(group) : null;
    const _attempt = detailReload();
    detailController?.abort();
    if (!slug) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    detailController = controller;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);

    void fetchThemeDetail(slug, controller.signal)
      .then((payload) => {
        if (controller.signal.aborted || detailController !== controller) return;
        setDetail(payload);
        setDetailLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || detailController !== controller) return;
        setDetailError(errorMessage(reason));
        setDetailLoading(false);
      });
  });

  createEffect(() => {
    const group = selected();
    if (!group) {
      setFocusRequested(false);
      return;
    }
    if (!focusRequested()) return;
    queueMicrotask(() => {
      document
        .querySelector<HTMLElement>('[data-testid="theme-board-detail-close"]')
        ?.focus();
    });
  });

  onCleanup(() => {
    listController?.abort();
    detailController?.abort();
  });

  const rows = createMemo(() =>
    [...groups()].sort(
      (a, b) => finite(b.change) - finite(a.change) || a.name.localeCompare(b.name),
    ),
  );
  const extent = createMemo(() =>
    Math.max(0.5, ...groups().map((group) => Math.abs(finite(group.change)))),
  );
  const selectedKey = () => {
    const group = selected();
    return group ? themeSlug(group) : null;
  };
  const themeName = () => detail()?.theme.name ?? selected()?.name ?? "";

  /** Rail filters must not turn real members into "no quote" rows. */
  const universe = () => props.allRows ?? props.rows;

  /** Join the theme's constituents to the unfiltered market snapshot. */
  const members = createMemo(() => {
    const bySymbol = new Map<string, MarketRow>();
    for (const row of universe() ?? []) {
      if (typeof row?.symbol === "string") bySymbol.set(row.symbol.trim().toUpperCase(), row);
    }
    const quoted: ThemeMember[] = [];
    const noQuote: string[] = [];
    for (const symbol of detail()?.constituents ?? []) {
      const row = bySymbol.get(String(symbol).trim().toUpperCase());
      if (!row) {
        noQuote.push(symbol);
        continue;
      }
      quoted.push({
        symbol,
        name: row.name || symbol,
        change: finite(row.change),
        cap: typeof row.marketCapCr === "number" && Number.isFinite(row.marketCapCr) ? row.marketCapCr : null,
        relVol:
          typeof row.relativeVolume === "number" && Number.isFinite(row.relativeVolume)
            ? row.relativeVolume
            : null,
      });
    }
    quoted.sort((a, b) => b.change - a.change || a.symbol.localeCompare(b.symbol));
    return { quoted, noQuote };
  });
  const memberExtent = createMemo(() =>
    Math.max(0.5, ...members().quoted.map((member) => Math.abs(member.change))),
  );

  // Real components: the registry panel polls `rows` every few seconds. Calling
  // these as functions inside JSX would re-run them on each poll, replace the
  // focused row/detail button and blur it (UX_PRINCIPLES §10).
  const BarChart = () => (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col overflow-auto gap-1 p-2"
      style={{ "background-color": VIZ_PANEL }}
      data-testid="theme-board"
    >
      <For each={rows()}>
        {(group, index) => {
          const key = () => themeSlug(group) ?? `no-slug-${index()}`;
          const marked = () => selectedKey() !== null && themeSlug(group) === selectedKey();
          const change = finite(group.change);
          const geometry = themeBarGeometry(change, extent());
          const rowClass = (clickable: boolean) =>
            `flex w-full items-center gap-2 rounded-fin border px-2 py-1 text-left ${
              clickable
                ? "cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-1"
                : "cursor-default"
            } ${marked() ? "ring-1 ring-fin-primary" : ""}`;
          const rowStyle = () => ({ "border-color": VIZ_GRID, "background-color": VIZ_BG });
          const title = tooltipText(group);
          const RowContent = () => (
            <>
              <Box
                className={`${desktop() ? "w-[160px]" : "w-[110px]"} flex-shrink-0 min-w-0`}
              >
                <Text
                  span
                  size="xs"
                  fw={600}
                  title={group.name}
                  data-testid={`theme-board-name-${key()}`}
                  class="block whitespace-normal break-words leading-tight"
                  c={VIZ_TEXT}
                >
                  {group.name}
                </Text>
                <Show when={!desktop()}>
                  <Text
                    span
                    size="xs"
                    class="block font-mono tabular-nums"
                    title={`${breadthText(group)} · ${medianTip(group)}`}
                    data-testid={`theme-board-breadth-narrow-${key()}`}
                    c={VIZ_MUTED}
                  >
                    {breadthText(group)}
                  </Text>
                </Show>
              </Box>
              <Box className="relative flex-1 min-w-0 h-4">
                <Box
                  className="absolute inset-y-0 w-px"
                  style={{ left: "50%", "background-color": VIZ_GRID }}
                />
                <Box
                  data-testid={`theme-board-bar-${key()}`}
                  className="absolute inset-y-1 rounded-fin"
                  style={{
                    left: geometry.left,
                    width: geometry.width,
                    "background-color": themeBarColor(change, extent()),
                  }}
                />
              </Box>
              <Text
                span
                size="xs"
                class="w-14 flex-shrink-0 text-right font-mono tabular-nums"
                c={change >= 0 ? VIZ_UP : VIZ_DOWN}
              >
                {changeText(change)}
              </Text>
              <Text
                span
                size="xs"
                class="flex-shrink-0 font-mono tabular-nums"
                title={`${group.advances} advances / ${group.declines} declines`}
                c={VIZ_MUTED}
              >
                {group.stock_count} · {group.advances}/{group.declines}
              </Text>
              <Show when={desktop()}>
                <Text
                  span
                  size="xs"
                  class="flex-shrink-0 font-mono tabular-nums"
                  title={medianTip(group)}
                  data-testid={`theme-board-breadth-${key()}`}
                  c={VIZ_MUTED}
                >
                  {breadthText(group)}
                </Text>
              </Show>
            </>
          );
          return themeSlug(group) ? (
            <button
              type="button"
              data-testid={`theme-board-row-${key()}`}
              title={title}
              aria-label={title}
              onClick={() => selectTheme(group)}
              className={rowClass(true)}
              style={rowStyle()}
            >
              <RowContent />
            </button>
          ) : (
            <div
              data-testid={`theme-board-row-${key()}`}
              title={title}
              className={rowClass(false)}
              style={rowStyle()}
            >
              <RowContent />
            </div>
          );
        }}
      </For>
    </Box>
  );

  const BoardView = () => (
    <>
      <Show
        when={!loading()}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-auto p-2"
            data-testid="theme-board-loading"
          >
            <For each={Array.from({ length: 12 }, (_, index) => index)}>
              {() => <Skeleton h={24} radius={6} />}
            </For>
          </Box>
        }
      >
        <Show
          when={!error()}
          fallback={
            <Box
              className="flex-1 min-w-0 min-h-0 flex flex-col items-center justify-center gap-3 p-4"
              role="alert"
              data-testid="theme-board-error"
            >
              <Text span size="sm" c={VIZ_DOWN}>
                {error()}
              </Text>
              <Button size="xs" onClick={() => setReload((value) => value + 1)} data-testid="theme-board-retry">
                Retry
              </Button>
            </Box>
          }
        >
          <Show
            when={groups().length > 0}
            fallback={
              <Box
                className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
                data-testid="theme-board-empty"
              >
                <Text span size="sm" c={VIZ_MUTED}>
                  No themes for this period.
                </Text>
              </Box>
            }
          >
            <BarChart />
          </Show>
        </Show>
      </Show>
      <Show
        when={desktop()}
        fallback={
          <Box
            className="flex flex-shrink-0 flex-col gap-1 border-t px-2 py-1"
            style={{ "border-color": VIZ_GRID }}
            data-testid="theme-board-legend"
          >
            <Box className="flex items-center gap-2">
              <Box
                className="h-2 w-24 rounded-fin"
                style={{ background: marketColorRampCss() }}
              />
              <Text
                span
                size="xs"
                class="whitespace-nowrap"
                c={VIZ_MUTED}
                data-testid="theme-board-legend-text"
              >
                loss ← 0 → gain
              </Text>
            </Box>
            <Text span size="xs" class="whitespace-nowrap" c={VIZ_MUTED}>
              bar = {period()} change · length = |change|
            </Text>
          </Box>
        }
      >
        <ToolbarRow
          gap={8}
          wrap={false}
          clip
          className="h-8 flex-shrink-0 border-t px-2"
          style={{ "border-color": VIZ_GRID }}
          data-testid="theme-board-legend"
        >
          <Box
            className="h-2 w-24 rounded-fin"
            style={{ background: marketColorRampCss() }}
          />
          <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-legend-text">
            loss ← 0 → gain
          </Text>
          <Box className="flex-1 min-w-0" />
          <Text span size="xs" c={VIZ_MUTED}>
            bar = {period()} change · length = |change|
          </Text>
        </ToolbarRow>
      </Show>
    </>
  );

  const DetailView = () => (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 p-2"
      style={{ "background-color": VIZ_PANEL }}
      data-testid="theme-board-detail"
    >
      <ToolbarRow gap={8} wrap={false} clip className="flex-shrink-0">
        <Button
          size="xs"
          variant="subtle"
          onClick={() => setSelected(null)}
          data-testid="theme-board-detail-close"
        >
          ← All themes
        </Button>
        <Box className="flex-1 min-w-0" />
        <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-detail-change">
          {changeText(finite(selected()?.change))}
        </Text>
      </ToolbarRow>
      <Text span size="sm" fw={700} c={VIZ_TEXT} data-testid="theme-board-detail-name">
        {selected()?.name ?? ""}
      </Text>
      <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-detail-count">
        {detail()?.theme.member_count ?? finite(selected()?.stock_count)} members
      </Text>
      <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-detail-breadth">
        H {breadthPct(selected()?.near_high_pct)} · L {breadthPct(selected()?.near_low_pct)} · median{" "}
        {breadthPct(selected()?.median_pos_52w)}
      </Text>
      <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-detail-asof">
        as of {asOfTime(lastUpdated())}
      </Text>

      <Show when={detailLoading()}>
        <Box className="flex flex-wrap gap-2" data-testid="theme-board-detail-loading">
          <For each={Array.from({ length: 6 }, (_, index) => index)}>
            {() => <Skeleton h={24} w={72} radius={6} />}
          </For>
        </Box>
      </Show>

      <Show when={detailError()}>
        <Box className="flex items-center gap-2" role="alert" data-testid="theme-board-detail-error">
          <Text span size="xs" c={VIZ_DOWN}>
            {detailError()}
          </Text>
          <Button size="xs" onClick={() => setDetailReload((value) => value + 1)} data-testid="theme-board-detail-retry">
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={detail()}>
        <Box className="flex flex-1 min-h-0 flex-col gap-1" data-testid="theme-board-member-heatmap">
          <Box className="flex flex-shrink-0 items-center gap-2" data-testid="theme-board-member-legend">
            <Box
              className="h-2 w-16 rounded-fin"
              style={{ background: marketColorRampCss() }}
            />
            <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-member-scale-note">
              loss ← 0 → gain
            </Text>
            <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-relvol-note">
              × = rel vol
            </Text>
          </Box>
          <Box
            className={
              desktop()
                ? "grid flex-1 min-h-0 grid-cols-2 gap-1"
                : "grid flex-1 min-h-0 grid-cols-3 gap-1"
            }
            style={{ "grid-auto-rows": desktop() ? "minmax(60px, 1fr)" : "44px" }}
            data-testid="theme-board-member-tiles"
          >
            {/* Index keeps the button nodes across a poll. `members()` returns
                fresh objects on every snapshot, so a keyed For would replace
                every tile and drop the keyboard focus mid-interaction. */}
            <Index each={members().quoted}>
              {(member) => {
                const fill = () => themeBarColor(member().change, memberExtent());
                const label = () =>
                  `${member().name} (${member().symbol}) · ${themeName()} · ${changeText(member().change)} · ${relVolTip(member().relVol)}`;
                return (
                  <button
                    type="button"
                    title={label()}
                    aria-label={label()}
                    data-testid={`theme-board-member-${member().symbol}`}
                    onClick={() => props.onSymbolClick?.(member().symbol)}
                    className={`flex w-full flex-col items-start justify-center rounded-fin border px-2 py-1 text-left hover:brightness-110 focus-visible:outline-none focus-visible:ring-1 ${
                      desktop() ? "min-h-[60px]" : "min-h-[44px]"
                    }`}
                    style={{
                      "background-color": fill(),
                      "border-color": VIZ_BG,
                    }}
                  >
                    <Box
                      className="flex w-full min-w-0 flex-wrap items-baseline gap-x-1 leading-tight"
                      data-testid={`theme-board-member-label-${member().symbol}`}
                      style={{
                        "background-color": alpha(VIZ_BG, 0.62),
                        "border-radius": "3px",
                        padding: "1px 3px",
                      }}
                    >
                      <Text span size="xs" fw={700} class="overflow-hidden break-words" style={{ color: VIZ_TEXT }}>
                        {member().symbol}
                      </Text>
                      <Text
                        span
                        size="xs"
                        class="font-mono tabular-nums overflow-hidden break-words"
                        style={{ color: VIZ_TEXT }}
                      >
                        {changeText(member().change)}
                      </Text>
                      <Text
                        span
                        size="xs"
                        class="font-mono tabular-nums overflow-hidden break-words"
                        style={{ color: VIZ_TEXT }}
                      >
                        · {relVolText(member().relVol)}
                      </Text>
                    </Box>
                  </button>
                );
              }}
            </Index>
          </Box>
          <Show when={members().noQuote.length > 0}>
            <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-no-quote">
              no quote: {members().noQuote.join(", ")}
            </Text>
          </Show>
        </Box>
      </Show>
    </Box>
  );

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
      data-testid="theme-board-view"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="h-10 flex-shrink-0 border-b px-2"
        style={{ "border-color": VIZ_GRID }}
        data-testid="theme-board-toolbar"
      >
        <Text span size="xs" c={VIZ_MUTED}>
          Period
        </Text>
        <Select
          size="xs"
          w={72}
          className="min-w-[72px]"
          value={period()}
          data={PERIOD_OPTIONS}
          onChange={(value: string | null) => {
            if (isThemePeriod(value)) setPeriod(value);
          }}
          aria-label="Theme period"
          data-testid="theme-board-period"
        />
        <Box className="flex-1 min-w-0" />
        <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-count">
          {groups().length} themes
        </Text>
        <Text span size="xs" c={VIZ_MUTED} data-testid="theme-board-asof">
          as of {asOfTime(lastUpdated())}
        </Text>
      </ToolbarRow>

      <Show
        when={desktop()}
        fallback={
          <Box className="flex-1 min-w-0 min-h-0 flex flex-col">
            <Show when={selected()}>
              {/* One surface per concept: a divider plus a background step,
                  not a second bordered card nested inside the board region. */}
              <Box
                className="flex-shrink-0 border-t"
                style={{ "border-color": VIZ_GRID, "background-color": VIZ_PANEL }}
                data-testid="theme-board-detail-card"
              >
                <DetailView />
              </Box>
            </Show>
            <Box className="flex-1 min-w-0 min-h-0 flex flex-col"><BoardView /></Box>
          </Box>
        }
      >
        <Box className="flex-1 min-w-0 min-h-0 flex flex-row">
          <Box className="flex-1 min-w-0 min-h-0 flex flex-col"><BoardView /></Box>
          <Show when={selected()}>
            <Box
              className="w-[320px] flex-shrink-0 min-h-0 flex flex-col border-l"
              style={{ "border-color": VIZ_GRID }}
              data-testid="theme-board-detail-pane"
            >
              <DetailView />
            </Box>
          </Show>
        </Box>
      </Show>
    </Box>
  );
}
