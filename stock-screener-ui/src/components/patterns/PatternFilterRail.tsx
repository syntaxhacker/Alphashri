import { Box, Button, Chip, Divider, NumberInput, Select, Switch, Text } from "@/ui";
import type { PatternDef, PatternFilters, PatternHitDTO, TFSpec } from "@/types/chartPatterns";
import { TimeframeSelect } from "./TimeframeSelect";

const FAMILY_LABELS: Record<string, string> = {
  reversal: "Reversal",
  continuation: "Continuation",
  curve_cup: "Curve & Cup",
};

const FAMILY_ORDER = ["reversal", "continuation", "curve_cup"];
const FORMED_PRESETS = [1, 3, 5, 10];

export interface PatternFilterRailProps {
  patterns: PatternDef[];
  results: PatternHitDTO[];
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  resetFilters: () => void;
  timeframes: TFSpec[];
  timeframe: string;
  setTimeframe: (value: string) => void;
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      <Text size="xs" fw={700} style={{ textTransform: "uppercase" }} c="dimmed">
        {title}
      </Text>
      {children}
    </Box>
  );
}

/** Left filter rail: family, direction, timeframe, status, quality, formed-within, volume. */
export function PatternFilterRail({
  patterns,
  results,
  filters,
  setFilter,
  resetFilters,
  timeframes,
  timeframe,
  setTimeframe,
}: PatternFilterRailProps) {
  const familyOrder = Array.from(new Set([...FAMILY_ORDER, ...patterns.map((p) => p.family)]));
  const families = familyOrder.map((id) => ({
    id,
    label: FAMILY_LABELS[id] ?? id,
    count: results.filter((r) => r.family === id).length,
  }));

  const selectedFamilies = asArray(filters.family);
  const selectedDirections = asArray(filters.direction);
  const selectedStatuses = asArray(filters.status);
  const formedWithin = filters.formed_within_bars ?? null;

  return (
    <Box
      data-testid="patterns-filter-rail"
      sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
    >
      <Section title="Pattern family">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {families.map((f) => (
            <Chip
              key={f.id}
              size="sm"
              variant="light"
              checked={selectedFamilies.includes(f.id)}
              onChange={() => setFilter("family", toggle(selectedFamilies, f.id))}
              data-testid={`patterns-family-${f.id}`}
            >
              {f.label} ({f.count})
            </Chip>
          ))}
        </Box>
      </Section>

      <Divider />

      <Section title="Direction">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {(["bullish", "bearish"] as const).map((dir) => (
            <Chip
              key={dir}
              size="sm"
              variant="light"
              color={dir === "bullish" ? "success" : "error"}
              checked={selectedDirections.includes(dir)}
              onChange={() => setFilter("direction", toggle(selectedDirections, dir))}
              data-testid={`patterns-direction-${dir}`}
            >
              {dir === "bullish" ? "Bullish" : "Bearish"}
            </Chip>
          ))}
        </Box>
      </Section>

      <Divider />

      <Section title="Timeframe">
        <TimeframeSelect timeframes={timeframes} value={timeframe} onChange={setTimeframe} />
      </Section>

      <Divider />

      <Section title="Status">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {(["forming", "confirmed", "failed", "marginal"] as const).map((status) => (
            <Chip
              key={status}
              size="sm"
              variant="light"
              checked={selectedStatuses.includes(status)}
              onChange={() => setFilter("status", toggle(selectedStatuses, status))}
              data-testid={`patterns-status-filter-${status}`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Chip>
          ))}
        </Box>
      </Section>

      <Divider />

      <Section title="Shape quality">
        <Select
          data={[
            { value: "", label: "Any" },
            { value: "fair", label: "Fair+" },
            { value: "strong", label: "Strong+" },
            { value: "textbook", label: "Textbook" },
          ]}
          value={filters.quality ?? ""}
          onChange={(v) => setFilter("quality", v ? v : null)}
          size="sm"
          data-testid="patterns-quality-select"
        />
      </Section>

      <Divider />

      <Section title="Formed within (candles)">
        <NumberInput
          value={formedWithin ?? ""}
          onChange={(v: number | string) => setFilter("formed_within_bars", v === "" ? null : Number(v))}
          min={1}
          step={1}
          size="sm"
          placeholder="Any"
          w={110}
          data-testid="patterns-formed-within"
        />
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {FORMED_PRESETS.map((preset) => (
            <Chip
              key={preset}
              size="xs"
              variant="light"
              checked={formedWithin === preset}
              onChange={() => setFilter("formed_within_bars", formedWithin === preset ? null : preset)}
              data-testid={`patterns-formed-within-${preset}`}
            >
              {preset}
            </Chip>
          ))}
        </Box>
      </Section>

      <Divider />

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Switch
          label="Volume confirmed"
          size="sm"
          checked={Boolean(filters.volume_confirmed)}
          onChange={(e) => setFilter("volume_confirmed", e.target.checked ? true : null)}
          data-testid="patterns-volume-confirmed"
        />
        <Button
          size="xs"
          variant="outline"
          onClick={resetFilters}
          data-testid="patterns-reset"
        >
          Reset
        </Button>
      </Box>
    </Box>
  );
}
