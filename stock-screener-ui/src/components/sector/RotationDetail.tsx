import { Box, Button, Text } from "@/ui";
import type { ReactNode } from "react";
import { IconUsers } from "@tabler/icons-react";
import { MONO, NEGATIVE, POSITIVE, TEXT_MUTED } from "@/ui/palette";
import type { RotationPeriod, RotationRow } from "../../types/rotation";
import { formatPercentage, getPnLTextColor } from "../../utils/ui-helpers";
import { ROTATION_STATUS_LABELS, ROTATION_STATUS_COLORS_PANEL } from "./rotationStatus";

const PERIODS: RotationPeriod[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y"];



function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text
      c="dimmed"
      sx={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.5,
        textTransform: "uppercase",
      }}
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
    <Box sx={{ minWidth: 0 }}>
      <Text
        c="dimmed"
        sx={{
          display: "block",
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        c={tone === "muted" ? "secondary" : tone}
        fw={600}
        truncate
        sx={{
          display: "block",
          fontFamily: MONO,
          fontSize: 10.5,
          fontVariantNumeric: "tabular-nums",
        }}
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
      sx={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Box sx={{ px: 1, py: 0.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          {status ? (
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: status.color,
                flexShrink: 0,
              }}
            />
          ) : null}
          <Text fw={700} truncate sx={{ fontSize: 11, minWidth: 0 }}>
            {row ? row.name : "Select a group"}
          </Text>
          <Box sx={{ flex: 1 }} />
          {status ? (
            <Text
              sx={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: status.color,
                whiteSpace: "nowrap",
              }}
            >
              {status.label}
            </Text>
          ) : null}
        </Box>
        <Text c="dimmed" truncate sx={{ display: "block", fontSize: 9 }}>
          {row
            ? `${row.category ? `${row.category} · ` : ""}${row.kind} · ${row.quadrant} · ${row.members} members`
            : "Pick a row in the board, matrix or rotation map."}
        </Text>
      </Box>

      {row ? (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
              gap: 0.5,
              px: 1,
              py: 0.5,
            }}
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

          <Box sx={{ px: 1, py: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
            <SectionLabel>Period returns</SectionLabel>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
                gap: 0.5,
                mt: 0.5,
              }}
            >
              {PERIODS.map((p) => {
                const value = row.returns[p];
                const height = Math.max(3, Math.min(36, Math.abs(value) * 2.2));
                return (
                  <Box
                    key={p}
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 0.25,
                      minWidth: 0,
                    }}
                  >
                    <Box
                      sx={{
                        height: 28,
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                      }}
                    >
                      <Box
                        sx={{
                          width: 12,
                          height,
                          bgcolor: value >= 0 ? POSITIVE : NEGATIVE,
                          borderRadius: "2px 2px 0 0",
                          opacity: 0.9,
                        }}
                      />
                    </Box>
                    <Text sx={{ fontSize: 8, color: TEXT_MUTED, lineHeight: 1 }}>{p}</Text>
                    <Text
                      sx={{
                        fontSize: 8.5,
                        fontFamily: MONO,
                        lineHeight: 1,
                        color: getPnLTextColor(value),
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {value.toFixed(1)}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.25,
              borderTop: "1px solid",
              borderColor: "divider",
            }}
          >
            <SectionLabel>Top movers</SectionLabel>
            <Box sx={{ flex: 1 }} />
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

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, px: 1, pb: 0.5 }}>
            {movers.length === 0 ? (
              <Text c="dimmed" sx={{ fontSize: 10 }}>
                No movers
              </Text>
            ) : (
              movers.map((mover) => (
                <Box
                  key={`${row.id}-${mover.symbol}`}
                  sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
                >
                  <Box
                    component="a"
                    href={`/chart/${encodeURIComponent(mover.symbol)}`}
                    sx={{
                      minWidth: 0,
                      color: "text.primary",
                      textDecoration: "none",
                      "&:hover": { color: "primary.main", textDecoration: "underline" },
                    }}
                  >
                    <Text truncate sx={{ fontSize: 10.5, fontWeight: 600 }}>
                      {mover.symbol}
                    </Text>
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  <Text
                    c={getPnLTextColor(mover.change)}
                    fw={600}
                    sx={{ fontFamily: MONO, fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}
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
