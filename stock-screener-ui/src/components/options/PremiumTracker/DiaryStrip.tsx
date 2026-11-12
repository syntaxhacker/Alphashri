import { createEffect, createMemo, createSignal, Show } from "solid-js";
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
import type { TableColumnDef } from "../../common/TanStackTable";
import { FIELD_W, ROW_BUTTON_SX } from "./widths";

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

export function DiaryStrip(props: DiaryStripProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = createSignal(today);
  const [lesson, setLesson] = createSignal(loadLesson(today));
  const [draftExits, setDraftExits] = createSignal<Record<string, string>>({});
  const [reviewId, setReviewId] = createSignal<string | null>(null);
  const [reviewConviction, setReviewConviction] = createSignal<Conviction>("MEDIUM");
  const [reviewText, setReviewText] = createSignal("");

  const options = createMemo(() => {
    const days = uniqueDays(props.trades).filter((d) => d !== today);
    return [today, ...days];
  });

  createEffect(() => {
    setLesson(loadLesson(day()));
  });

  const dayTrades = createMemo(() => props.trades.filter((t) => t.date === day()));
  const summary = createMemo(() => summarizeDay(props.trades, day()));
  const closedCount = createMemo(
    () => dayTrades().filter((t) => t.exit !== null && t.exit !== undefined).length,
  );

  const columns: TableColumnDef<PaperTrade>[] = [
    { id: "date", header: "Date", accessorKey: "date", meta: { align: "left" } },
    { id: "underlying", header: "Und", accessorKey: "underlying", meta: { align: "center" } },
    { id: "side", header: "Side", accessorKey: "side", meta: { align: "center" } },
    { id: "strike", header: "Strike", accessorKey: "strike", meta: { align: "right" } },
    { id: "qty", header: "Qty", accessorKey: "qty", meta: { align: "right" } },
    { id: "entry", header: "Entry", accessorKey: "entry", meta: { align: "right" } },
    {
      id: "exit",
      header: "Exit",
      meta: { align: "right" },
      cell: (ctx) => {
        const trade = ctx.row.original;
        if (trade.exit !== null && trade.exit !== undefined) {
          return <Text size="sm">{trade.exit}</Text>;
        }
        return (
          <ToolbarRow gap={4}>
            <NumberInput
              w={FIELD_W.exit}
              size="sm"
              value={draftExits()[trade.id] ?? ""}
              onChange={(v) => setDraftExits((prev) => ({ ...prev, [trade.id]: String(v) }))}
              data-testid={`diary-exit-input-${trade.id}`}
            />
            <Button
              size="sm"
              style={{ ...ROW_BUTTON_SX }}
              onClick={() => {
                const raw = draftExits()[trade.id];
                if (raw === undefined || raw === "") return;
                props.onSetExit(trade.id, Number(raw));
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
      id: "pnl",
      header: "P&L",
      meta: { align: "right" },
      cell: (ctx) => {
        const pnl = tradePnl(ctx.row.original);
        if (pnl === null) {
          return (
            <Text size="sm" c="dimmed">
              open
            </Text>
          );
        }
        const pct = tradePnlPct(ctx.row.original);
        return (
          <Text size="sm" c={getPnLTextColor(pnl)} fw={600}>
            {formatSignedPnl(pnl)}
            {pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
          </Text>
        );
      },
    },
    {
      id: "conviction",
      header: "Conv",
      meta: { align: "center" },
      cell: (ctx) => (
        <Text size="xs" fw={700} c={CONVICTION_TONE[ctx.row.original.conviction] ?? "text.secondary"}>
          {ctx.row.original.conviction}
        </Text>
      ),
    },
    {
      id: "actions",
      header: "",
      meta: { align: "center" },
      cell: (ctx) => (
        <ToolbarRow gap={4}>
          <Button
            size="sm"
            style={{ ...ROW_BUTTON_SX }}
            onClick={() => {
              const t = ctx.row.original;
              setReviewId((prev) => (prev === t.id ? null : t.id));
              setReviewConviction(t.conviction);
              setReviewText(t.review);
            }}
            data-testid={`diary-review-${ctx.row.original.id}`}
          >
            Review
          </Button>
          <Button
            size="sm"
            style={{ ...ROW_BUTTON_SX }}
            onClick={() => props.onDelete(ctx.row.original.id)}
            data-testid={`diary-delete-${ctx.row.original.id}`}
          >
            Del
          </Button>
        </ToolbarRow>
      ),
    },
  ];

  const reviewTrade = createMemo(
    () => props.trades.find((t) => t.id === reviewId()) ?? null,
  );

  return (
    <Box w="100%" data-testid="diary-strip">
      <ToolbarRow gap={8} justify="space-between" data-testid="diary-day-row">
        <Select
          w={FIELD_W.day}
          size="sm"
          label="Day"
          value={day()}
          onChange={(v) => {
            if (v) setDay(v);
          }}
          data={options()}
          data-testid="diary-day"
        />
        <Text size="xs" c="dimmed" data-testid="diary-summary">
          {closedCount() === 0
            ? "No closed trades yet"
            : `${summary().wins}/${closedCount()} wins · ${formatSignedPnl(summary().total)}`}
        </Text>
      </ToolbarRow>
      <Box w="100%">
        <TextInput
          w="100%"
          size="sm"
          label="Today's lesson"
          value={lesson()}
          onChange={(v) => setLesson(v)}
          onBlur={() => saveLesson(day(), lesson())}
          data-testid="diary-lesson"
        />
      </Box>
      <Divider data-testid="diary-divider" />
      <TanStackTable
        data={dayTrades()}
        columns={columns}
        dataTestId="diary-table"
        emptyMessage="No fills this day — paper trade from a strategy card above."
      />
      <Show when={reviewTrade()}>
        {(rt) => (
          <Box w="100%" data-testid={`diary-review-panel-${rt().id}`}>
            <Divider data-testid="diary-review-divider" />
            <ToolbarRow gap={8} data-testid="diary-review-header">
              <Text size="sm" fw={700}>
                Revisit: {rt().underlying} {rt().strike} {rt().side} @ {rt().entry}
              </Text>
              <Select
                w={FIELD_W.conviction}
                size="sm"
                label="Conviction"
                value={reviewConviction()}
                onChange={(v) => setReviewConviction(String(v) as Conviction)}
                data={["LOW", "MEDIUM", "HIGH"]}
                data-testid={`diary-conviction-${rt().id}`}
              />
            </ToolbarRow>
            <Show when={rt().plan}>
              <Text size="xs" c="dimmed" data-testid={`diary-plan-${rt().id}`}>
                Plan was: {rt().plan}
              </Text>
            </Show>
            <Textarea
              w="100%"
              size="sm"
              label="What happened? What went wrong?"
              value={reviewText()}
              onChange={(v) => setReviewText(String(v))}
              data-testid={`diary-review-text-${rt().id}`}
            />
            <ToolbarRow gap={8}>
              <Button
                size="sm"
                style={{ ...ROW_BUTTON_SX }}
                onClick={() => {
                  props.onUpdateTrade(rt().id, { review: reviewText(), conviction: reviewConviction() });
                  setReviewId(null);
                }}
                data-testid={`diary-review-save-${rt().id}`}
              >
                Save review
              </Button>
            </ToolbarRow>
          </Box>
        )}
      </Show>
    </Box>
  );
}
