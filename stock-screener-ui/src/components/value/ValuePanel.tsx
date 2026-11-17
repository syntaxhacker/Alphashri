import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { IconDownload, IconRefresh } from "../common/Icons";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Divider,
  Loader,
  Select,
  Tab,
  Tabs,
  TabsList,
  Text,
  ToolbarRow,
} from "@/ui";
import { CompactPanel } from "../common/compact";
import { useValueScanSolid } from "./useValueScanSolid";
import {
  VALUE_MARKETS,
  VALUE_PRESETS,
  type ValueFilters,
  type ValueMarket,
  type ValueRow,
} from "../../api/valueScan";
import { ValueFilters as ValueFilterBar } from "./ValueFilters";
import { ValueTable } from "./ValueTable";
import { ValueDetailDrawer } from "./ValueDetailDrawer";
import { VALUE_CSV_HEADERS, buildChartHref, escapeCsvCell, valueRowToCsvRow } from "./valueColumns";

interface ValuePanelProps {
  initialFilters?: Partial<ValueFilters>;
  onRowClick?: (row: ValueRow) => void;
  sectorOptions?: string[];
  /** Embedded under another surface (e.g. the Market View switch). Drops the
   *  standalone market tabs so the host's universe selector is the only one. */
  embedded?: boolean;
  /** Controlled market. Overrides `initialFilters.market` and stays in sync
   *  with the host's universe. */
  market?: ValueMarket;
  /** Hide the self-contained market selector. Implied by `embedded`. */
  hideMarketSelect?: boolean;
}

const PRESET_OPTIONS = Object.entries(VALUE_PRESETS).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

export function ValuePanel(props: ValuePanelProps) {
  const navigate = useNavigate();
  const [filters, setFilters] = createSignal<ValueFilters>({
    market: "india",
    limit: 100,
    sort: "score",
    ...props.initialFilters,
    ...(props.market !== undefined ? { market: props.market } : {}),
  });
  // A host-owned market follows its owner without rebuilding the other filters.
  createEffect(() => {
    const market = props.market;
    if (market === undefined) return;
    setFilters((f) => (f.market === market ? f : { ...f, market }));
  });
  const [selected, setSelected] = createSignal<ValueRow | null>(null);
  const { data, rows, sectors, meta, isLoading, error, stale, refresh, warnings, lastUpdated } =
    useValueScanSolid(filters);

  const patch = (p: Partial<ValueFilters>): void => {
    setFilters((f) => ({ ...f, ...p }));
  };

  const handleRowClick = (row: ValueRow): void => {
    setSelected(row);
    props.onRowClick?.(row);
  };

  const exportCsv = (): void => {
    // Filename and content come from the same payload, so they can never
    // disagree about which market was exported.
    const frame = data();
    if (!frame || stale()) return;
    const lines = [
      VALUE_CSV_HEADERS.join(","),
      ...frame.rows.map((r) => valueRowToCsvRow(r).map(escapeCsvCell).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deep-value-${frame.market}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const showLoading = () => isLoading() && rows().length === 0;
  const showError = () => error() !== null;
  const showEmpty = () => !isLoading() && error() === null && rows().length === 0;
  const canExport = () => data() !== null && !stale();
  // The standalone tab owns a market selector; an embedded panel must not show
  // a second one — the host's universe selector drives `market` instead.
  const showMarketTabs = () => !props.embedded && props.hideMarketSelect !== true;
  // A payload whose own market disagrees with the tab cannot be presented as
  // the requested market — say which universe these rows are, never imply it.
  const marketMismatch = createMemo(() => {
    const d = data();
    return d !== null && d.market !== (filters().market ?? "india");
  });
  const sectorSummary = createMemo(() =>
    sectors()
      .slice(0, 5)
      .map((s) => `${s.name} (${s.count})`)
      .join(" · "),
  );

  return (
    <CompactPanel testId="value-panel">
      <Box className="flex flex-col gap-1">
        <ToolbarRow justify="space-between" data-testid="value-header">
          <ToolbarRow gap={8}>
            <Text size="sm" fw={700} data-testid="value-title">
              DEEP VALUE
            </Text>
            <Show when={showMarketTabs()}>
              <Tabs
                value={filters().market ?? "india"}
                onChange={(v) => patch({ market: (v ?? "india") as ValueFilters["market"] })}
                data-testid="value-market-tabs"
              >
                <TabsList>
                  <For each={VALUE_MARKETS}>{(m) => (
                    <Tab
                      value={m.value}
                      data-testid={`value-market-tab-${m.value}`}
                    >
                      {m.label}
                    </Tab>
                  )}</For>
                </TabsList>
              </Tabs>
            </Show>
            <Select
              placeholder="Preset"
              data={PRESET_OPTIONS}
              value={filters().preset ?? ""}
              onChange={(v) => patch({ preset: v ?? undefined })}
              w={150}
              size="sm"
              data-testid="value-preset-select"
            />
          </ToolbarRow>
          <ToolbarRow gap={8}>
            <Show when={lastUpdated()}>
              <Text size="xs" c="dimmed" data-testid="value-as-of">
                {`as of ${lastUpdated()}`}
              </Text>
            </Show>
            <ActionIcon
              size="sm"
              onClick={refresh}
              loading={isLoading()}
              data-testid="value-refresh"
              aria-label="Refresh"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </ToolbarRow>
        </ToolbarRow>

        <ValueFilterBar filters={filters()} onChange={patch} sectorOptions={props.sectorOptions} />
        <Divider />

        <Show when={showLoading()}>
          <Box
            data-testid="value-loading"
            className="flex items-center justify-center gap-2 py-8"
          >
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Scanning for deep value…
            </Text>
          </Box>
        </Show>
        <Show when={showError()}>
          <Alert color="error" data-testid="value-error">
            <div className="flex items-center justify-between gap-2">
              <Text size="sm">{`Value scan failed: ${error()?.message ?? "unknown error"}`}</Text>
              <Button
                variant="outline"
                color="error"
                size="xs"
                onClick={refresh}
                data-testid="value-retry"
              >
                Retry
              </Button>
            </div>
          </Alert>
        </Show>
        <Show when={marketMismatch()}>
          <Alert color="warning" data-testid="value-market-mismatch">
            {`Showing ${(data()?.market ?? "").toUpperCase()} results (${data()?.currency}) for the ${(filters().market ?? "india").toUpperCase()} request.`}
          </Alert>
        </Show>
        <Show when={showEmpty()}>
          <Box data-testid="value-empty" className="py-8 text-center">
            <Text size="sm" c="dimmed">
              No deep-value matches for these filters — loosen a gate or two.
            </Text>
          </Box>
        </Show>
        <Show when={!showEmpty()}>
          <ValueTable
            rows={rows()}
            loading={isLoading()}
            onRowClick={handleRowClick}
            // Exchange-gated in buildValueColumns: NSE/BSE/NSI and US listings
            // wire this to the in-app chart; buildChartHref adds `?market=usa`
            // for US rows so the chart picks the US provider.
            onSymbolClick={(sym, exchange) => navigate(buildChartHref(sym, exchange))}
          />
        </Show>

        <Divider />
        <ToolbarRow justify="space-between" data-testid="value-footer">
          <ToolbarRow gap={8}>
            <Text size="xs" c="dimmed" data-testid="value-summary">
              {`${rows().length} of ${meta()?.matched ?? rows().length} matches · scanned ${meta()?.scanned ?? 0}`}
            </Text>
            <Show when={sectorSummary()}>
              <Text size="xs" c="dimmed" data-testid="value-sectors">
                {`sectors: ${sectorSummary()}`}
              </Text>
            </Show>
          </ToolbarRow>
          <ToolbarRow gap={8}>
            <Show when={warnings().length > 0}>
              <Text size="xs" c="dimmed" data-testid="value-warnings">
                {warnings().join(" · ")}
              </Text>
            </Show>
            <ActionIcon
              size="sm"
              onClick={exportCsv}
              disabled={!canExport()}
              data-testid="value-export-csv"
              aria-label="Export CSV"
            >
              <IconDownload size={14} />
            </ActionIcon>
          </ToolbarRow>
        </ToolbarRow>
      </Box>
      <ValueDetailDrawer row={selected()} onClose={() => setSelected(null)} />
    </CompactPanel>
  );
}
