import { useEffect, useState } from "react";
import Paper from "@mui/material/Paper";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { ActionIcon, Box, Button, Select, Skeleton, Text, ToolbarRow } from "@/ui";
import { BORDER, SURFACE } from "@/ui/palette";
import { fetchSectorGroups } from "../../api/sector";
import type { SectorClassify, SectorGroup, SectorPeriod } from "../../types/sector";
import { formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";

export const GROUP_PERFORMANCE_PERIODS: SectorPeriod[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
];

interface GroupPerformancePanelProps {
  width?: number;
  onSelectGroup?: (name: string) => void;
  defaultCollapsed?: boolean;
}

function sanitizeTestId(name: string): string {
  return name;
}

export function GroupPerformancePanel({
  width = 200,
  onSelectGroup,
  defaultCollapsed = false,
}: GroupPerformancePanelProps) {
  const [classify, setClassify] = useState<SectorClassify>("sector");
  const [period, setPeriod] = useState<SectorPeriod>("1D");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [minStocks, setMinStocks] = useState("3");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<SectorGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSectorGroups({ classify, period })
      .then((payload) => {
        if (cancelled) return;
        setGroups(Array.isArray(payload.groups) ? payload.groups : []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load groups");
        setGroups([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classify, period]);

  // Single/few-stock groups produce noisy outliers (e.g. an industry with one
  // name at +34%); default to hiding groups below the threshold.
  const threshold = Number(minStocks) || 1;
  const visible = groups.filter((g) => g.stock_count >= threshold);
  const maxAbs = visible.reduce((m, g) => Math.max(m, Math.abs(g.change)), 0);

  if (collapsed) {
    return (
      <Paper
        elevation={0}
        data-testid="group-performance-panel"
        data-collapsed="true"
        sx={{
          width: 32,
          flexShrink: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 1,
          border: 1,
          borderColor: BORDER,
          borderRadius: 2,
          bgcolor: SURFACE,
        }}
      >
        <ActionIcon
          size="xs"
          onClick={() => setCollapsed(false)}
          data-testid="group-performance-toggle"
          aria-label="Expand groups panel"
        >
          <IconChevronRight size={14} />
        </ActionIcon>
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      data-testid="group-performance-panel"
      data-collapsed="false"
      sx={{
        width,
        flexShrink: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: 1,
        borderColor: BORDER,
        borderRadius: 2,
        bgcolor: SURFACE,
      }}
    >
      <ToolbarRow gap={4} clip data-testid="group-performance-header" wrap={false}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0, px: 1, pt: 1, width: "100%" }}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" span sx={{ flexShrink: 0 }}>
            Groups
          </Text>
          <Box sx={{ flex: 1, minWidth: 0 }} />
          <ActionIcon
            size="xs"
            onClick={() => setCollapsed(true)}
            data-testid="group-performance-toggle"
            aria-label="Collapse groups panel"
          >
            <IconChevronLeft size={14} />
          </ActionIcon>
        </Box>
      </ToolbarRow>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 4, px: 1, pb: 1 }}>
        {GROUP_PERFORMANCE_PERIODS.map((p) => (
          <Button
            key={p}
            size="xs"
            variant={p === period ? "filled" : "subtle"}
            onClick={() => setPeriod(p)}
            data-testid={`group-performance-period-${p}`}
          >
            {p}
          </Button>
        ))}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, pb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Select
            value={classify}
            onChange={(v) => {
              if (v === "sector" || v === "industry" || v === "theme") setClassify(v);
            }}
            data={[
              { value: "sector", label: "Sector" },
              { value: "industry", label: "Industry" },
              { value: "theme", label: "Theme" },
            ]}
            size="xs"
            data-testid="group-performance-classify"
            aria-label="Classify"
          />
        </Box>
        <Select
          value={minStocks}
          onChange={(v) => setMinStocks(String(v ?? "3"))}
          data={[
            { value: "1", label: "All" },
            { value: "3", label: "3+" },
            { value: "5", label: "5+" },
            { value: "10", label: "10+" },
          ]}
          size="xs"
          w={72}
          data-testid="group-performance-min-stocks"
          aria-label="Minimum stocks"
        />
      </Box>
      {loading ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }} data-testid="group-performance-loading">
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
          <Skeleton h={16} />
        </Box>
      ) : error ? (
        <Box sx={{ p: 1 }} data-testid="group-performance-error">
          <Text size="xs" c="error">
            {error}
          </Text>
        </Box>
      ) : visible.length === 0 ? (
        <Box sx={{ p: 1 }} data-testid="group-performance-empty">
          <Text size="xs" c="dimmed">
            No groups found
          </Text>
        </Box>
      ) : (
        <Box
          sx={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", px: 1, pb: 1 }}
          data-testid="group-performance-list"
        >
          {visible.map((g) => {
            const pct = maxAbs > 0 ? (Math.abs(g.change) / maxAbs) * 100 : 0;
            const positive = g.change >= 0;
            return (
              <Box
                key={g.name}
                data-testid={`group-performance-row-${sanitizeTestId(g.name)}`}
                data-group={g.name}
                onClick={onSelectGroup ? () => onSelectGroup(g.name) : undefined}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  py: 1,
                  borderBottom: 1,
                  borderColor: "divider",
                  cursor: onSelectGroup ? "pointer" : "default",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                  <Text size="xs" truncate span sx={{ flex: 1, minWidth: 0 }} title={g.name}>
                    {g.name}
                  </Text>
                  <Text size="xs" c="dimmed" span sx={{ flexShrink: 0 }}>
                    {g.stock_count}
                  </Text>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0, height: 6, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
                    <Box
                      data-testid={`group-performance-bar-${sanitizeTestId(g.name)}`}
                      data-value={g.change}
                      data-positive={positive ? "true" : "false"}
                      sx={{ height: "100%", borderRadius: 1 }}
                      style={{
                        width: `${pct}%`,
                        backgroundColor: positive
                          ? "var(--mui-palette-success-main)"
                          : "var(--mui-palette-error-main)",
                      }}
                    />
                  </Box>
                  <Text
                    size="xs"
                    c={getPnLTextColor(g.change)}
                    span
                    ta="right"
                    sx={{ width: 56, flexShrink: 0 }}
                    data-testid={`group-performance-value-${sanitizeTestId(g.name)}`}
                  >
                    {formatPercentage(g.change)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}
