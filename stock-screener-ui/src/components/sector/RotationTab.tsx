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
  return <Box sx={{ width: "1px", height: 12, bgcolor: "divider", flexShrink: 0 }} />;
}

function StripLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      c="dimmed"
      sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase" }}
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
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        data-testid="rotation-toolbar"
        sx={{ overflowX: "auto", overflowY: "hidden" }}
        style={{
          padding: "0 10px",
          minHeight: 34,
          height: 34,
          borderBottom: "1px solid var(--mui-palette-divider)",
          flexShrink: 0,
        }}
      >
        <Text fw={700} sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
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
        <Box sx={{ flex: 1, minWidth: 8 }} />
        {loading && data ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Loader size="xs" />
            <Text c="dimmed" sx={{ fontSize: 10 }}>
              Updating
            </Text>
          </Box>
        ) : null}
        {updatedAt ? (
          <Text c="dimmed" sx={{ fontSize: 10, whiteSpace: "nowrap" }}>
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
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1,
            height: 26,
            flexShrink: 0,
            borderBottom: "1px solid",
            borderColor: "divider",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <StripLabel>{regime.benchmark}</StripLabel>
            <Text
              c={regime.benchmark_change >= 0 ? "success" : "error"}
              fw={600}
              sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
            >
              {formatPercentage(regime.benchmark_change)}
            </Text>
          </Box>
          {regime.vix != null ? (
            <>
              <Divider />
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <StripLabel>VIX</StripLabel>
                <Text sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                  {regime.vix.toFixed(2)}
                </Text>
                {regime.vix_change != null ? (
                  <Text
                    c={regime.vix_change <= 0 ? "success" : "error"}
                    fw={600}
                    sx={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}
                  >
                    {formatPercentage(regime.vix_change)}
                  </Text>
                ) : null}
              </Box>
            </>
          ) : null}
          <Divider />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <StripLabel>Breadth</StripLabel>
            <Text sx={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              {regime.breadth.toFixed(0)}%
            </Text>
          </Box>
          <Divider />
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: regimeTone(regime.label),
                flexShrink: 0,
              }}
            />
            <Text
              fw={700}
              sx={{
                fontSize: 10,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: regimeTone(regime.label),
              }}
            >
              {regime.label}
            </Text>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            {STATUS_ORDER.map((status) => {
              const label = ROTATION_STATUS_LABELS[status].short;
              const color = ROTATION_STATUS_COLORS_PANEL[status];
              return (
                <Box key={status} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box
                    sx={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      bgcolor: color,
                      flexShrink: 0,
                    }}
                  />
                  <Text c="dimmed" sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3 }}>
                    {label}
                  </Text>
                  <Text
                    sx={{ fontSize: 10.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
                  >
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
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 1,
          }}
        >
          <Box
            sx={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 1 }}
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
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
          }}
        >
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading rotation…
          </Text>
        </Box>
      ) : visible.length === 0 ? (
        <Box
          data-testid="rotation-empty"
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 1,
          }}
        >
          <Text size="xs" c="dimmed">
            No {kind} groups with at least {minMembers} members.
          </Text>
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gap: 0.25,
            p: 0.25,
            overflow: "hidden",
            gridTemplateAreas: {
              xs: '"rrg" "matrix" "board" "detail"',
              lg: '"rrg board" "matrix detail"',
            },
            gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1.15fr) minmax(0, 1fr)" },
            gridTemplateRows: { xs: "auto auto auto auto", lg: "minmax(0, 1.18fr) minmax(0, 0.82fr)" },
          }}
        >
          <CompactPanel
            testId="rotation-rrg-panel"
            scrollable
            flush
            padded={false}
            sx={{ gridArea: "rrg", minHeight: { xs: 300, lg: 0 } }}
            title={
              <Text sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" }}>
                Relative rotation
              </Text>
            }
            description={
              <Text sx={{ fontSize: 9.5, color: "text.disabled" }}>
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
            sx={{ gridArea: "matrix", minHeight: { xs: 260, lg: 0 } }}
            title={
              <Text sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" }}>
                Multi-period
              </Text>
            }
            description={<Text sx={{ fontSize: 9.5, color: "text.disabled" }}>group returns</Text>}
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
            sx={{ gridArea: "board", minHeight: { xs: 320, lg: 0 } }}
            title={
              <Text sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "text.secondary" }}>
                Rotation board
              </Text>
            }
            description={<Text sx={{ fontSize: 9.5, color: "text.disabled" }}>sorted by {period}</Text>}
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
            sx={{ gridArea: "detail", minHeight: { xs: 200, lg: 0 } }}
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
