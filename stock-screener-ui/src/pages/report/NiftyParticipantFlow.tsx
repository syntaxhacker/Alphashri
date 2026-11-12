import { memo, useMemo } from "react";
import { Box, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel, CompactStat } from "@/components/common/compact";
import { EmptyState } from "@/components/common/states";
import {
  buildParticipantFlow,
  type ParticipantFlowBucket,
  type ParticipantFlowRow,
} from "./niftyParticipantFlow";

/**
 * Stacked horizontal bars of writer vs buyer flow per clock bucket.
 *
 * Each bucket shows two bars — calls (CE) and puts (PE) — split into
 * writers (red), buyers (green) and cover (teal, stacked on the buy side).
 * Segment widths are shares of that leg's bucket total; the signed net
 * imbalance (`buyers + cover − writers`) is printed per bucket and summed
 * in the header stats.
 */

interface NiftyParticipantFlowProps {
  rows: ParticipantFlowRow[];
  bucketMin?: number;
}

/** Compact ₹: `2.69 Cr`, `18.4 L`, else Indian grouping. */
export function formatFlowRupees(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export function flowTone(v: number): string {
  if (v > 0) return palette.POSITIVE;
  if (v < 0) return palette.NEGATIVE;
  return palette.TEXT_MUTED;
}

/** Segment shares (0–100) of a leg's writers / buyers / cover total. */
export function legShares(
  writers: number,
  buyers: number,
  cover: number,
): { writers: number; buyers: number; cover: number } {
  const total = writers + buyers + cover;
  if (!(total > 0)) return { writers: 0, buyers: 0, cover: 0 };
  return {
    writers: (writers / total) * 100,
    buyers: (buyers / total) * 100,
    cover: (cover / total) * 100,
  };
}

function LegBar({
  leg,
  writers,
  buyers,
  cover,
}: {
  leg: "ce" | "pe";
  writers: number;
  buyers: number;
  cover: number;
}) {
  const shares = legShares(writers, buyers, cover);
  const empty = shares.writers + shares.buyers + shares.cover <= 0;
  return (
    <Box className="flex items-center gap-[8px] min-w-0">
      <Text
        size="xs"
        span
        fw={700}
        c="dimmed"
        style={{ width: 22, flexShrink: 0, fontSize: 10 }}
      >
        {leg.toUpperCase()}
      </Text>
      <Box
        data-testid={`nifty-participant-flow-bar-${leg}`}
        title={`${leg.toUpperCase()} writers ${formatFlowRupees(writers)} · buyers ${formatFlowRupees(buyers)} · cover ${formatFlowRupees(cover)}`}
        className="flex-1 min-w-0 h-[10px] rounded-[8px] overflow-hidden flex items-stretch"
        style={{ backgroundColor: "rgba(139, 148, 158, 0.15)" }}
      >
        {!empty && shares.writers > 0 ? (
          <span
            data-testid={`nifty-participant-flow-${leg}-writers`}
            data-pct={Math.round(shares.writers)}
            className="block"
            style={{ width: `${shares.writers}%`, backgroundColor: palette.NEGATIVE }}
          />
        ) : null}
        {!empty && shares.buyers > 0 ? (
          <span
            data-testid={`nifty-participant-flow-${leg}-buyers`}
            data-pct={Math.round(shares.buyers)}
            className="block"
            style={{ width: `${shares.buyers}%`, backgroundColor: palette.POSITIVE }}
          />
        ) : null}
        {!empty && shares.cover > 0 ? (
          <span
            data-testid={`nifty-participant-flow-${leg}-cover`}
            data-pct={Math.round(shares.cover)}
            className="block"
            style={{ width: `${shares.cover}%`, backgroundColor: palette.TERM_GAMMA }}
          />
        ) : null}
      </Box>
    </Box>
  );
}

function NiftyParticipantFlowInner({ rows, bucketMin = 30 }: NiftyParticipantFlowProps) {
  const buckets: ParticipantFlowBucket[] = useMemo(
    () => buildParticipantFlow(rows, { bucketMin }),
    [rows, bucketMin],
  );

  const totals = useMemo(() => {
    let writers = 0;
    let buyers = 0;
    let net = 0;
    for (const b of buckets) {
      writers += b.ceWriters + b.peWriters;
      buyers += b.ceBuyers + b.ceCover + b.peBuyers + b.peCover;
      net += b.net;
    }
    return { writers, buyers, net };
  }, [buckets]);

  if (buckets.length === 0) {
    return (
      <CompactPanel title="Participant flow" testId="nifty-participant-flow">
        <EmptyState
          data-testid="nifty-participant-flow-empty"
          title="No tape yet"
          description="Participant flow builds once the option tape records."
        />
      </CompactPanel>
    );
  }

  return (
    <CompactPanel title="Participant flow — writers vs buyers" testId="nifty-participant-flow">
      <Box className="flex flex-col gap-[8px] min-w-0">
        <Box
          className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-[4px] w-full min-w-0"
        >
          <CompactStat
            data-testid="nifty-participant-flow-total-buyers"
            dense
            label="Buyers + cover"
            value={formatFlowRupees(totals.buyers)}
            tone={palette.POSITIVE}
          />
          <CompactStat
            data-testid="nifty-participant-flow-total-writers"
            dense
            label="Writers"
            value={formatFlowRupees(totals.writers)}
            tone={palette.NEGATIVE}
          />
          <CompactStat
            data-testid="nifty-participant-flow-total-net"
            dense
            label="Net imbalance"
            value={formatFlowRupees(totals.net)}
            tone={flowTone(totals.net)}
          />
        </Box>
        <Box
          data-testid="nifty-participant-flow-legend"
          className="flex items-center gap-[10px] flex-wrap min-w-0"
        >
          {[
            { name: "Writers", color: palette.NEGATIVE },
            { name: "Buyers", color: palette.POSITIVE },
            { name: "Cover", color: palette.TERM_GAMMA },
          ].map((e) => (
            <Box key={e.name} className="inline-flex items-center gap-[4px]">
              <span
                component="span"
                aria-hidden
                className="block w-[8px] h-[8px] rounded-[8px]"
                style={{ backgroundColor: e.color }}
              />
              <Text size="xs" span c="dimmed">
                {e.name}
              </Text>
            </Box>
          ))}
        </Box>
        <Box className="flex flex-col gap-[6px] min-w-0">
          {buckets.map((b) => (
            <Box
              key={b.label}
              data-testid="nifty-participant-flow-row"
              className="flex flex-col gap-[2px] min-w-0"
            >
              <Box className="flex items-baseline gap-[8px] min-w-0">
                <Text size="xs" span fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {b.label}
                </Text>
                <Text
                  data-testid="nifty-participant-flow-net"
                  size="xs"
                  span
                  fw={700}
                  style={{ color: flowTone(b.net), fontVariantNumeric: "tabular-nums" }}
                >
                  {formatFlowRupees(b.net)}
                </Text>
              </Box>
              <LegBar
                leg="ce"
                writers={b.ceWriters}
                buyers={b.ceBuyers}
                cover={b.ceCover}
              />
              <LegBar
                leg="pe"
                writers={b.peWriters}
                buyers={b.peBuyers}
                cover={b.peCover}
              />
            </Box>
          ))}
        </Box>
      </Box>
    </CompactPanel>
  );
}

export const NiftyParticipantFlow = memo(NiftyParticipantFlowInner);
NiftyParticipantFlow.displayName = "NiftyParticipantFlow";
