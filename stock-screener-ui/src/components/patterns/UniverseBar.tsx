import type { ReactNode } from "react";
import { Box, Button, Chip, Text, ToolbarRow } from "@/ui";
import { IconPencil } from "@tabler/icons-react";
import type { JobDTO, Universe } from "@/types/chartPatterns";
import { JobStatus } from "./JobStatus";

export interface UniverseBarProps {
  universes: Universe[];
  universe: string;
  setUniverse: (value: string) => void;
  /** Reserved id of the custom symbol scope (e.g. `"custom"`). */
  customUniverse?: string;
  /** How many symbols the custom scope currently holds (drives the label). */
  customSymbolCount?: number;
  scan: () => void;
  scanning: boolean;
  job: JobDTO | null;
  queuePosition: number | null;
  error: string | null;
  /** Right-side controls rendered in the same toolbar row (timeframe, filters…). */
  actions?: ReactNode;
}

/**
 * Scan-scope bar: universe pills plus a "Custom" pill for a hand-picked symbol
 * set, a live job status and the scan action. The action label adapts to the
 * scope — "Scan again" for a universe, "Scan N symbols" for a custom set.
 * Borderless single row: the caller passes the results controls as `actions`
 * so universe + toolbar share one 48px `ToolbarRow`.
 */
export function UniverseBar({
  universes,
  universe,
  setUniverse,
  customUniverse = "custom",
  customSymbolCount = 0,
  scan,
  scanning,
  job,
  queuePosition,
  error,
  actions,
}: UniverseBarProps) {
  const customActive = universe === customUniverse;
  const customCount = customSymbolCount ?? 0;
  const scanDisabled = scanning || (customActive && customCount === 0);
  const scanLabel =
    customActive && customCount > 0
      ? `Scan ${customCount} symbol${customCount === 1 ? "" : "s"}`
      : "Scan again";

  return (
    <Box data-testid="patterns-universe-bar" sx={{ minWidth: 0 }}>
      <ToolbarRow justify="space-between" gap={8} style={{ rowGap: 8 }}>
        <ToolbarRow gap={6} style={{ flexWrap: "wrap", rowGap: 6 }}>
          {universes.map((u) => (
            <Chip
              key={u.id}
              size="sm"
              variant="light"
              checked={universe === u.id}
              onChange={() => setUniverse(u.id)}
              data-testid={`patterns-universe-${u.id}`}
            >
              {u.label}
              {u.count > 0 ? ` (${u.count.toLocaleString("en-IN")})` : ""}
            </Chip>
          ))}
          <Chip
            size="sm"
            variant="light"
            checked={customActive}
            onChange={() => setUniverse(customUniverse)}
            data-testid="patterns-universe-custom"
          >
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <IconPencil size={12} />
              Custom
            </Box>
          </Chip>
          <JobStatus job={job} queuePosition={queuePosition} scanning={scanning} />
          <Button
            size="xs"
            variant="filled"
            onClick={scan}
            loading={scanning}
            disabled={scanDisabled}
            data-testid="patterns-scan-again"
          >
            {scanLabel}
          </Button>
        </ToolbarRow>
        {actions ? (
          <ToolbarRow gap={8} justify="flex-end" style={{ flexWrap: "wrap", rowGap: 6 }}>
            {actions}
          </ToolbarRow>
        ) : null}
      </ToolbarRow>
      {error ? (
        <Box sx={{ mt: 0.5 }}>
          <Text size="xs" c="error" data-testid="patterns-status-line">
            {error}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
