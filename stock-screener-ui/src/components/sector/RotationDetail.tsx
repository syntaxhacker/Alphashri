import { NEGATIVE, POSITIVE, TEXT_MUTED } from "@/ui/palette";
import { Box, Button, Text } from "@/ui";
import type { ReactNode } from "react";
import { IconUsers } from "@tabler/icons-react";
import type { RotationPeriod, RotationRow } from "../../types/rotation";
import { formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { ROTATION_STATUS_LABELS, ROTATION_STATUS_COLORS_PANEL } from "./rotationStatus";

const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];



function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      c="dimmed"
      className="text-[9.5px] font-bold uppercase tracking-[0.5px]"
    >
      {children}
    </Text>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "error" | "muted";
}) {
  return (
    <Box className="min-w-0">
      <Text
        c="dimmed"
        className="block text-[9px] font-bold uppercase tracking-[0.4px]"
      >
        {label}
      </Text>
      <Text
        c={tone === "muted" ? "secondary" : tone}
        fw={600}
        truncate
        className="block font-mono text-[10.5px] tabular-nums"
      >
        {value}
      </Text>
    </Box>
  );
}

export interface RotationDetailProps {
  row: RotationRow | null;
  onOpenMembers: (row: RotationRow) => void;
}

export function RotationDetail({ row, onOpenMembers }: RotationDetailProps) {
  const status = row ? {
    label: ROTATION_STATUS_LABELS[row.status].long,
    color: ROTATION_STATUS_COLORS_PANEL[row.status],
  } : null;
  const movers = row ? row.top_movers.slice(0, 5) : [];
  const canOpenMembers = Boolean(row && row.kind === "theme" && row.slug);
  const monthly = row ? row.returns["1M"] : 0;

  return (
    <Box
      data-testid="rotation-detail"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <Box className="border-b border-fin-border px-2 py-1">
        <Box className="flex min-w-0 items-center gap-1.5">
          {status ? (
            <Box
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: status.color }}
            />
          ) : null}
          <Text fw={700} truncate className="min-w-0 text-[11px]">
            {row ? row.name : "Select a group"}
          </Text>
          <Box className="flex-1" />
          {status ? (
            <Text
              className="whitespace-nowrap text-[9.5px] font-bold tracking-[0.4px]"
              style={{ color: status.color }}
            >
              {status.label}
            </Text>
          ) : null}
        </Box>
        <Text c="dimmed" truncate className="block text-[9px]">
          {row
            ? `${row.category ? `${row.category} · ` : ""}${row.kind} · ${row.quadrant} · ${row.members} members`
            : "Pick a row in the board, matrix or rotation map."}
        </Text>
      </Box>

      {row ? (
        <>
          <Box
            className="grid grid-cols-4 gap-1 px-2 py-1"
          >
            <Metric label="1M" value={formatPercentage(monthly)} tone={getPnLTextColor(monthly)} />
            <Metric label="RS" value={row.rs_1m.toFixed(2)} tone={getPnLTextColor(row.rs_1m)} />
            <Metric
              label="Breadth"
              value={`${row.breadth.toFixed(0)}%`}
              tone={row.breadth >= 55 ? "success" : row.breadth <= 45 ? "error" : "muted"}
            />
            <Metric
              label="Volume"
              value={`${row.rel_volume.toFixed(1)}x`}
              tone={row.rel_volume >= 1.2 ? "success" : "muted"}
            />
          </Box>

          <Box className="border-t border-fin-border px-2 py-1">
            <SectionLabel>Period returns</SectionLabel>
            <Box
              className="mt-1 grid grid-cols-7 gap-1"
            >
              {PERIODS.map((p) => {
                const value = row.returns[p];
                const height = Math.max(3, Math.min(36, Math.abs(value) * 2.2));
                return (
                  <Box
                    key={p}
                    className="flex min-w-0 flex-col items-center gap-[2px]"
                  >
                    <Box
                      className="flex h-7 w-full items-end justify-center"
                    >
                      <Box
                        className="w-3 rounded-t-[2px] opacity-90"
                        style={{ height, backgroundColor: value >= 0 ? POSITIVE : NEGATIVE }}
                      />
                    </Box>
                    <Text className="text-[8px] leading-none" style={{ color: TEXT_MUTED }}>{p}</Text>
                    <Text
                      className="font-mono text-[8.5px] leading-none tabular-nums"
                      style={{ color: getPnLTextColor(value) }}
                    >
                      {value.toFixed(1)}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box
            className="flex items-center gap-1.5 border-t border-fin-border px-2 py-[2px]"
          >
            <SectionLabel>Top movers</SectionLabel>
            <Box className="flex-1" />
            {canOpenMembers ? (
              <Button
                data-testid="rotation-detail-members"
                variant="subtle"
                size="xs"
                leftSection={<IconUsers size={12} />}
                onClick={() => onOpenMembers(row)}
                style={{ minHeight: 20, paddingInline: 6, fontSize: 10 }}
              >
                Members
              </Button>
            ) : null}
          </Box>

          <Box className="flex flex-col gap-[2px] px-2 pb-1">
            {movers.length === 0 ? (
              <Text c="dimmed" className="text-[10px]">
                No movers
              </Text>
            ) : (
              movers.map((mover) => (
                <Box
                  key={`${row.id}-${mover.symbol}`}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <Box
                    component="a"
                    href={`/chart/${encodeURIComponent(mover.symbol)}`}
                    className="min-w-0 text-fin-text no-underline hover:text-fin-primary hover:underline"
                  >
                    <Text truncate className="text-[10.5px] font-semibold">
                      {mover.symbol}
                    </Text>
                  </Box>
                  <Box className="flex-1" />
                  <Text
                    c={getPnLTextColor(mover.change)}
                    fw={600}
                    className="font-mono text-[10.5px] tabular-nums"
                  >
                    {formatPercentage(mover.change)}
                  </Text>
                </Box>
              ))
            )}
          </Box>
        </>
      ) : null}
    </Box>
  );
}
