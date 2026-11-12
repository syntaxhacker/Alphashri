import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Loader,
  SegmentedControl,
  Select,
  Text,
  ToolbarRow,
} from "@/ui";
import { CompactPanel } from "@/components/common/compact";
import { IconRefresh } from "@tabler/icons-react";
import { NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type {
  RotationKind,
  RotationPeriod,
  RotationRow,
  RotationStatus,
} from "../../types/rotation";
import { useRotationUrlState } from "../../hooks/useRotationUrlState";
import { useRotationData } from "../../hooks/useRotationData";
import { formatPercentage, formatTimeOnly } from "../../utils/ui-helpers";
import { RotationRrg } from "./RotationRrg";
import { RotationMatrix } from "./RotationMatrix";
import { RotationBoard } from "./RotationBoard";
import { RotationDetail } from "./RotationDetail";
import { ThemeMembersDrawer } from "./ThemeMembersDrawer";
import { ROTATION_STATUS_LABELS, ROTATION_STATUS_COLORS_PANEL } from "./rotationStatus";

const KIND_OPTIONS = [
  { label: "Sectors", value: "sector" },
  { label: "Themes", value: "theme" },
  { label: "Industries", value: "industry" },
];

const PERIOD_OPTIONS: { label: string; value: RotationPeriod }[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
].map((period) => ({ label: period, value: period as RotationPeriod }));

const MIN_OPTIONS = [1, 3, 5, 10].map((value) => ({
  label: `≥ ${value}`,
  value: String(value),
}));



const STATUS_ORDER: RotationStatus[] = ["booming", "heating", "cooling", "dumping", "neutral"];

function Divider() {
  return <Box className="h-3 w-px shrink-0 bg-fin-border" />;
}

function StripLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      c="dimmed"
      className="text-[9.5px] font-bold tracking-[0.5px] uppercase"
    >
      {children}
    </Text>
  );
}

function regimeTone(label: string): string {
  const upper = label.toUpperCase();
  if (upper.includes("OFF")) return NEGATIVE;
  if (upper.includes("ON")) return POSITIVE;
  return WARNING;
}

export function RotationTab({ market }: { market: "india" | "america" }) {
  const { kind, period, minMembers, selectedId, setKind, setPeriod, setMinMembers, setSelectedId } =
    useRotationUrlState();
  const { data, loading, error, refresh } = useRotationData(market, kind);

  const [membersRow, setMembersRow] = useState<RotationRow | null>(null);

  const visible = useMemo(
    () => (data?.rows ?? []).filter((row) => row.members >= minMembers),
    [data, minMembers],
  );

  const selectedRow = useMemo(
    () => visible.find((row) => row.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  );

  const counts = useMemo(() => {
    const base: Record<RotationStatus, number> = {
      booming: 0,
      heating: 0,
      cooling: 0,
      dumping: 0,
      neutral: 0,
    };
    for (const row of visible) base[row.status] += 1;
    return base;
  }, [visible]);

  const regime = data?.regime ?? null;
  const updatedAt = data?.last_updated ? formatTimeOnly(data.last_updated) : "";

  return (
    <Box
      data-testid="rotation-tab"
      className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-fin-bg"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        data-testid="rotation-toolbar"
        className="overflow-x-auto overflow-y-hidden"
        style={{
          padding: "0 10px",
          "min-height": 34,
          height: 34,
          borderBottom: "1px solid var(--color-fin-border)",
          "flex-shrink": 0,
        }}
      >
        <Text fw={700} className="text-[12px] whitespace-nowrap">
          Rotation
        </Text>
        <SegmentedControl
          value={kind}
          onChange={(value) => setKind(value as RotationKind)}
          data={KIND_OPTIONS}
          size="xs"
          data-testid="rotation-kind"
        />
        <SegmentedControl
          value={period}
          onChange={(value) => setPeriod(value as RotationPeriod)}
          data={PERIOD_OPTIONS}
          size="xs"
          data-testid="rotation-period"
        />
        <StripLabel>Min</StripLabel>
        <Select
          value={String(minMembers)}
          onChange={(value) => setMinMembers(Number(value ?? 1))}
          data={MIN_OPTIONS}
          size="xs"
          w={74}
          aria-label="Minimum members"
          data-testid="rotation-min-members"
        />
        <Box className="flex-1 min-w-[8px]" />
        {loading && data ? (
          <Box className="flex items-center gap-1">
            <Loader size="xs" />
            <Text c="dimmed" className="text-[10px]">
              Updating
            </Text>
          </Box>
        ) : null}
        {updatedAt ? (
          <Text c="dimmed" className="text-[10px] whitespace-nowrap">
            {updatedAt}
          </Text>
        ) : null}
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label="Refresh rotation data"
          onClick={refresh}
          data-testid="rotation-refresh"
        >
          <IconRefresh size={15} />
        </ActionIcon>
      </ToolbarRow>

      {regime ? (
        <Box
          data-testid="rotation-regime"
          className="flex items-center gap-2 px-2 h-[26px] shrink-0 border-b border-fin-border overflow-hidden whitespace-nowrap"
        >
          <Box className="flex items-center gap-1 min-w-0">
            <StripLabel>{regime.benchmark}</StripLabel>
            <Text
              c={regime.benchmark_change >= 0 ? "success" : "error"}
              fw={600}
              className="text-[11px] tabular-nums"
            >
              {formatPercentage(regime.benchmark_change)}
            </Text>
          </Box>
          {regime.vix != null ? (
            <>
              <Divider />
              <Box className="flex items-center gap-1">
                <StripLabel>VIX</StripLabel>
                <Text className="text-[11px] tabular-nums">
                  {regime.vix.toFixed(2)}
                </Text>
                {regime.vix_change != null ? (
                  <Text
                    c={regime.vix_change <= 0 ? "success" : "error"}
                    fw={600}
                    className="text-[10.5px] tabular-nums"
                  >
                    {formatPercentage(regime.vix_change)}
                  </Text>
                ) : null}
              </Box>
            </>
          ) : null}
          <Divider />
          <Box className="flex items-center gap-1">
            <StripLabel>Breadth</StripLabel>
            <Text className="text-[11px] tabular-nums">
              {regime.breadth.toFixed(0)}%
            </Text>
          </Box>
          <Divider />
          <Box className="flex items-center gap-1">
            <Box
              className="size-[6px] rounded-full shrink-0"
              style={{ "background-color": regimeTone(regime.label) }}
            />
            <Text
              fw={700}
              className="text-[10px] tracking-[0.6px] uppercase"
              style={{ color: regimeTone(regime.label) }}
            >
              {regime.label}
            </Text>
          </Box>
          <Box className="flex-1" />
          <Box className="flex items-center gap-[10px]">
            {STATUS_ORDER.map((status) => {
              const label = ROTATION_STATUS_LABELS[status].short;
              const color = ROTATION_STATUS_COLORS_PANEL[status];
              return (
                <Box key={status} className="flex items-center gap-1">
                  <Box
                    className="size-[5px] rounded-full shrink-0"
                    style={{ "background-color": color }}
                  />
                  <Text c="dimmed" className="text-[9.5px] font-bold tracking-[0.3px]">
                    {label}
                  </Text>
                  <Text className="text-[10.5px] font-semibold tabular-nums">
                    {counts[status]}
                  </Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      ) : null}

      {error ? (
        <Box
          data-testid="rotation-error"
          className="flex-1 min-h-0 flex items-center justify-center p-2"
        >
          <Box
            className="w-full max-w-[520px] flex flex-col gap-2"
          >
            <Alert color="error" title="Rotation data unavailable">
              {error}
            </Alert>
            <Box>
              <Button variant="outline" size="xs" onClick={refresh}>
                Retry
              </Button>
            </Box>
          </Box>
        </Box>
      ) : loading || !data ? (
        <Box
          data-testid="rotation-loading"
          className="flex-1 min-h-0 flex items-center justify-center gap-2"
        >
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading rotation…
          </Text>
        </Box>
      ) : visible.length === 0 ? (
        <Box
          data-testid="rotation-empty"
          className="flex-1 min-h-0 flex items-center justify-center p-2"
        >
          <Text size="xs" c="dimmed">
            No {kind} groups with at least {minMembers} members.
          </Text>
        </Box>
      ) : (
        <Box
          className="flex-1 min-h-0 grid gap-[2px] p-[2px] overflow-hidden grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] grid-rows-[auto_auto_auto_auto] lg:grid-rows-[minmax(0,1.18fr)_minmax(0,0.82fr)]"
        >
          <CompactPanel
            testId="rotation-rrg-panel"
            scrollable
            flush
            padded={false}
            className="min-h-[300px] lg:min-h-0"
            title={
              <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                Relative rotation
              </Text>
            }
            description={
              <Text className="text-[9.5px] text-fin-text-muted">
                RS 1M vs momentum · 50 = benchmark
              </Text>
            }
          >
            <RotationRrg
              rows={visible}
              selectedId={selectedRow?.id ?? null}
              onSelect={setSelectedId}
            />
          </CompactPanel>
          <CompactPanel
            testId="rotation-matrix-panel"
            scrollable
            flush
            padded={false}
            className="min-h-[260px] lg:min-h-0"
            title={
              <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                Multi-period
              </Text>
            }
            description={<Text className="text-[9.5px] text-fin-text-muted">group returns</Text>}
          >
            <RotationMatrix
              rows={visible}
              selectedId={selectedRow?.id ?? null}
              onSelect={setSelectedId}
            />
          </CompactPanel>
          <CompactPanel
            testId="rotation-board-panel"
            scrollable
            flush
            padded={false}
            className="min-h-[320px] lg:min-h-0"
            title={
              <Text className="text-[9.5px] font-bold uppercase tracking-[0.5px] text-fin-text-muted">
                Rotation board
              </Text>
            }
            description={<Text className="text-[9.5px] text-fin-text-muted">sorted by {period}</Text>}
          >
            <RotationBoard
              rows={visible}
              selectedId={selectedRow?.id ?? null}
              onSelect={setSelectedId}
              period={period}
            />
          </CompactPanel>
          <CompactPanel
            testId="rotation-detail-panel"
            scrollable
            flush
            padded={false}
            className="min-h-[200px] lg:min-h-0"
          >
            <RotationDetail row={selectedRow} onOpenMembers={setMembersRow} />
          </CompactPanel>
        </Box>
      )}

      <ThemeMembersDrawer
        open={membersRow !== null}
        slug={membersRow?.slug ?? null}
        name={membersRow?.name ?? ""}
        onClose={() => setMembersRow(null)}
      />
    </Box>
  );
}
