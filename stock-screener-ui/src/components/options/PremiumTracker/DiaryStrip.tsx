import { useEffect, useMemo, useState } from "react";
import { Box, Button, Divider, NumberInput, Select, Text, TextInput, Textarea, ToolbarRow } from "@/ui";
import { TanStackTable } from "../../common/TanStackTable";
import { formatSignedPnl, getPnLTextColor } from "../../../utils/ui-helpers";
import {
  loadLesson,
  saveLesson,
  summarizeDay,
  tradePnl,
  tradePnlPct,
  uniqueDays,
  type Conviction,
  type PaperTrade,
} from "./paperTrades";
import type { ColumnDef } from "@tanstack/react-table";

interface DiaryStripProps {
  trades: PaperTrade[];
  onSetExit: (id: string, exitValue: number) => void;
  onDelete: (id: string) => void;
  onUpdateTrade: (id: string, patch: Partial<Omit<PaperTrade, "id">>) => void;
}

const CONVICTION_TONE: Record<Conviction, string> = {
  HIGH: "success.main",
  MEDIUM: "warning.main",
  LOW: "text.secondary",
};

export function DiaryStrip({ trades, onSetExit, onDelete, onUpdateTrade }: DiaryStripProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [day, setDay] = useState(today);
  const [lesson, setLesson] = useState(() => loadLesson(today));
  const [draftExits, setDraftExits] = useState<Record<string, string>>({});
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewConviction, setReviewConviction] = useState<Conviction>("MEDIUM");
  const [reviewText, setReviewText] = useState("");

  const options = useMemo(() => {
    const days = uniqueDays(trades).filter((d) => d !== today);
    return [today, ...days];
  }, [trades, today]);

  useEffect(() => {
    setLesson(loadLesson(day));
  }, [day]);

  const dayTrades = useMemo(() => trades.filter((t) => t.date === day), [trades, day]);
  const summary = useMemo(() => summarizeDay(trades, day), [trades, day]);
  const closedCount = useMemo(
    () => dayTrades.filter((t) => t.exit !== null && t.exit !== undefined).length,
    [dayTrades],
  );

  const columns = useMemo<ColumnDef<PaperTrade>[]>(
    () => [
      { header: "Date", accessorKey: "date", meta: { align: "left" } },
      { header: "Und", accessorKey: "underlying", meta: { align: "center" } },
      { header: "Side", accessorKey: "side", meta: { align: "center" } },
      { header: "Strike", accessorKey: "strike", meta: { align: "right" } },
      { header: "Qty", accessorKey: "qty", meta: { align: "right" } },
      { header: "Entry", accessorKey: "entry", meta: { align: "right" } },
      {
        header: "Exit",
        id: "exit",
        meta: { align: "right" },
        cell: ({ row }) => {
          const trade = row.original;
          if (trade.exit !== null && trade.exit !== undefined) {
            return <Text size="sm">{trade.exit}</Text>;
          }
          return (
            <ToolbarRow gap={4}>
              <NumberInput
                w={90}
                size="sm"
                value={draftExits[trade.id] ?? ""}
                onChange={(v) => setDraftExits((prev) => ({ ...prev, [trade.id]: String(v) }))}
                data-testid={`diary-exit-input-${trade.id}`}
              />
              <Button
                size="sm"
                onClick={() => {
                  const raw = draftExits[trade.id];
                  if (raw === undefined || raw === "") return;
                  onSetExit(trade.id, Number(raw));
                  setDraftExits((prev) => {
                    const next = { ...prev };
                    delete next[trade.id];
                    return next;
                  });
                }}
                data-testid={`diary-exit-set-${trade.id}`}
              >
                Set
              </Button>
            </ToolbarRow>
          );
        },
      },
      {
        header: "P&L",
        id: "pnl",
        meta: { align: "right" },
        cell: ({ row }) => {
          const pnl = tradePnl(row.original);
          if (pnl === null) {
            return (
              <Text size="sm" c="dimmed">
                open
              </Text>
            );
          }
          const pct = tradePnlPct(row.original);
          return (
            <Text size="sm" c={getPnLTextColor(pnl)} fw={600}>
              {formatSignedPnl(pnl)}
              {pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
            </Text>
          );
        },
      },
      {
        header: "Conv",
        id: "conviction",
        meta: { align: "center" },
        cell: ({ row }) => (
          <Text size="xs" fw={700} c={CONVICTION_TONE[row.original.conviction] ?? "text.secondary"}>
            {row.original.conviction}
          </Text>
        ),
      },
      {
        header: "",
        id: "actions",
        meta: { align: "center" },
        cell: ({ row }) => (
          <ToolbarRow gap={4}>
            <Button
              size="sm"
              onClick={() => {
                const t = row.original;
                setReviewId((prev) => (prev === t.id ? null : t.id));
                setReviewConviction(t.conviction);
                setReviewText(t.review);
              }}
              data-testid={`diary-review-${row.original.id}`}
            >
              Review
            </Button>
            <Button size="sm" onClick={() => onDelete(row.original.id)} data-testid={`diary-delete-${row.original.id}`}>
              Del
            </Button>
          </ToolbarRow>
        ),
      },
    ],
    [draftExits, onSetExit, onDelete],
  );

  const reviewTrade = useMemo(
    () => trades.find((t) => t.id === reviewId) ?? null,
    [trades, reviewId],
  );

  return (
    <Box w="100%" data-testid="diary-strip">
      <ToolbarRow gap={8} justify="space-between" data-testid="diary-day-row">
        <Select
          w={150}
          size="sm"
          label="Day"
          value={day}
          onChange={(v) => {
            if (v) setDay(v);
          }}
          data={options}
          data-testid="diary-day"
        />
        <Text size="xs" c="dimmed" data-testid="diary-summary">
          {closedCount === 0
            ? "No closed trades yet"
            : `${summary.wins}/${closedCount} wins · ${formatSignedPnl(summary.total)}`}
        </Text>
      </ToolbarRow>
      <Box w="100%" onBlur={() => saveLesson(day, lesson)}>
        <TextInput
          w="100%"
          size="sm"
          label="Today's lesson"
          value={lesson}
          onChange={(v) => setLesson(v)}
          data-testid="diary-lesson"
        />
      </Box>
      <Divider data-testid="diary-divider" />
      <TanStackTable
        data={dayTrades}
        columns={columns}
        dataTestId="diary-table"
        emptyMessage="No fills this day — paper trade from a strategy card above."
      />
      {reviewTrade && (
        <Box w="100%" data-testid={`diary-review-panel-${reviewTrade.id}`}>
          <Divider data-testid="diary-review-divider" />
          <ToolbarRow gap={8} data-testid="diary-review-header">
            <Text size="sm" fw={700}>
              Revisit: {reviewTrade.underlying} {reviewTrade.strike} {reviewTrade.side} @ {reviewTrade.entry}
            </Text>
            <Select
              w={130}
              size="sm"
              label="Conviction"
              value={reviewConviction}
              onChange={(v) => setReviewConviction(String(v) as Conviction)}
              data={["LOW", "MEDIUM", "HIGH"]}
              data-testid={`diary-conviction-${reviewTrade.id}`}
            />
          </ToolbarRow>
          {reviewTrade.plan ? (
            <Text size="xs" c="dimmed" data-testid={`diary-plan-${reviewTrade.id}`}>
              Plan was: {reviewTrade.plan}
            </Text>
          ) : null}
          <Textarea
            w="100%"
            size="sm"
            label="What happened? What went wrong?"
            value={reviewText}
            onChange={(v) => setReviewText(String(v))}
            data-testid={`diary-review-text-${reviewTrade.id}`}
          />
          <ToolbarRow gap={8}>
            <Button
              size="sm"
              onClick={() => {
                onUpdateTrade(reviewTrade.id, { review: reviewText, conviction: reviewConviction });
                setReviewId(null);
              }}
              data-testid={`diary-review-save-${reviewTrade.id}`}
            >
              Save review
            </Button>
          </ToolbarRow>
        </Box>
      )}
    </Box>
  );
}
