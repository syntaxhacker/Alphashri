import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { Alert, Badge, Button, Divider, Loader, NumberInput, Select, Text, TextInput, ToolbarRow } from "@/ui";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../common/compact";
import { TanStackTable } from "../../common/TanStackTable";
import { getPnLTextColor, formatSignedPnl } from "../../../utils/ui-helpers";
import { fetchPremiumTracker, type PremiumLeg } from "../../../api/premiumTracker";
import {
  loadPaperTrades,
  savePaperTrades,
  newPaperTrade,
  tradePnl,
  tradePnlPct,
  type PaperTrade,
} from "./paperTrades";
import type { ColumnDef } from "@tanstack/react-table";

function verdictColor(verdict: string): "success" | "error" | "warning" | "default" {
  if (verdict === "CHEAP") return "success";
  if (verdict === "EXPENSIVE") return "error";
  if (verdict === "FAIR") return "warning";
  return "default";
}

function fmt(value: number | null, suffix = "", digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(digits)}${suffix}`;
}

function LegBlock({ leg }: { leg: PremiumLeg }) {
  return (
    <Box data-testid={`premium-leg-${leg.underlying}`} sx={{ width: "100%" }}>
      <ToolbarRow gap={8} data-testid={`premium-leg-header-${leg.underlying}`}>
        <Text size="md" fw={700}>
          {leg.underlying}
        </Text>
        <Badge color={verdictColor(leg.verdict)} size="xs" data-testid={`premium-verdict-${leg.underlying}`}>
          {leg.verdict}
        </Badge>
        {leg.error ? (
          <Text size="xs" c="dimmed">
            {leg.error}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            Spot {fmt(leg.spot, "", 0)} · ATM {fmt(leg.atm_strike, "", 0)} · DTE {leg.dte_days ?? "—"}
          </Text>
        )}
      </ToolbarRow>
      {!leg.error && (
        <CompactStatGrid>
          <CompactStat label="Straddle" value={`${fmt(leg.straddle_pct, "%")}`} hint={`₹${fmt(leg.straddle_price, "", 0)}`} />
          <CompactStat label="IV / HV" value={`${fmt(leg.iv_hv_ratio, "x")}`} hint={`IV ${fmt(leg.ce_iv_pct, "%", 1)} / HV ${fmt(leg.hv20_ann_pct, "%", 1)}`} />
          <CompactStat label="HV daily" value={`${fmt(leg.hv20_daily_pct, "%")}`} hint="20-day realized" />
          <CompactStat label="Avg range" value={`${fmt(leg.avg_range20_pct, "%")}`} hint="20-day H-L" />
        </CompactStatGrid>
      )}
    </Box>
  );
}

const CHECKS = [
  "Straddle vs avg range — straddle % far above avg range means costly, far below means cheap.",
  "IV vs HV — IV above HV x 1.1 favors selling, below HV x 0.9 favors buying.",
  "IV Rank — log IV daily; above 50 sell, below 30 buy (needs 30 days of diary).",
  "Events — RBI, results, elections: sell the IV crush after the spike, buy only if straddle is small.",
  "Costly + chop = sell spreads. Cheap + morning range = buy ATM, exit same day.",
];

export function PremiumTrackerPanel() {
  const [legs, setLegs] = useState<PremiumLeg[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>(() => loadPaperTrades());
  const [underlying, setUnderlying] = useState("NIFTY");
  const [side, setSide] = useState("CE");
  const [strike, setStrike] = useState<number | "">("");
  const [qty, setQty] = useState<number | "">("");
  const [entry, setEntry] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [draftExits, setDraftExits] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPremiumTracker();
      setLegs(data.legs);
      setAsOf(data.as_of);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load premium snapshot");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    savePaperTrades(trades);
  }, [trades]);

  const addTrade = useCallback(() => {
    if (strike === "" || qty === "" || entry === "") return;
    setTrades((prev) => [
      ...prev,
      newPaperTrade({
        date: new Date().toISOString().slice(0, 10),
        underlying: underlying as PaperTrade["underlying"],
        side: side as PaperTrade["side"],
        strike: Number(strike),
        qty: Number(qty),
        entry: Number(entry),
        note,
      }),
    ]);
    setStrike("");
    setQty("");
    setEntry("");
    setNote("");
  }, [underlying, side, strike, qty, entry, note]);

  const setExit = useCallback((id: string) => {
    const raw = draftExits[id];
    if (raw === undefined || raw === "") return;
    setTrades((prev) => prev.map((t) => (t.id === id ? { ...t, exit: Number(raw) } : t)));
    setDraftExits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [draftExits]);

  const removeTrade = useCallback((id: string) => {
    setTrades((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const summary = useMemo(() => {
    const closed = trades.filter((t) => t.exit !== null);
    const total = closed.reduce((sum, t) => sum + (tradePnl(t) ?? 0), 0);
    const wins = closed.filter((t) => (tradePnl(t) ?? 0) > 0).length;
    return { closed: closed.length, total, wins };
  }, [trades]);

  const columns = useMemo<ColumnDef<PaperTrade>[]>(() => [
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
        if (trade.exit !== null) return <Text size="sm">{trade.exit}</Text>;
        return (
          <ToolbarRow gap={4}>
            <NumberInput
              w={90}
              size="sm"
              value={draftExits[trade.id] ?? ""}
              onChange={(v) => setDraftExits((prev) => ({ ...prev, [trade.id]: String(v) }))}
              data-testid={`paper-exit-input-${trade.id}`}
            />
            <Button size="sm" onClick={() => setExit(trade.id)} data-testid={`paper-exit-set-${trade.id}`}>
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
        if (pnl === null) return <Text size="sm" c="dimmed">open</Text>;
        const pct = tradePnlPct(row.original);
        return (
          <Text size="sm" c={getPnLTextColor(pnl)} fw={600}>
            {formatSignedPnl(pnl)}{pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
          </Text>
        );
      },
    },
    {
      header: "",
      id: "actions",
      meta: { align: "center" },
      cell: ({ row }) => (
        <Button size="sm" onClick={() => removeTrade(row.original.id)} data-testid={`paper-delete-${row.original.id}`}>
          Del
        </Button>
      ),
    },
  ], [draftExits, setExit, removeTrade]);

  return (
    <CompactPanel
      title="Premium Tracker"
      description={asOf ? `Snapshot ${asOf}` : "Cheap vs expensive + paper log"}
      testId="premium-tracker-panel"
      action={
        <Button size="sm" onClick={refresh} data-testid="premium-refresh">
          Refresh
        </Button>
      }
    >
      {loading && (
        <ToolbarRow data-testid="premium-loading">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">Loading premium snapshot...</Text>
        </ToolbarRow>
      )}
      {error && (
        <Alert color="error" data-testid="premium-error">{error}</Alert>
      )}
      {!loading && !error && legs.length === 0 && (
        <Text size="sm" c="dimmed" data-testid="premium-empty">No snapshot data.</Text>
      )}
      {!loading && !error && legs.map((leg, i) => (
        <Box key={leg.underlying} sx={{ width: "100%" }}>
          {i > 0 && <Divider data-testid="premium-leg-divider" />}
          <LegBlock leg={leg} />
        </Box>
      ))}

      <Divider data-testid="premium-checks-divider" />
      <Text size="sm" fw={700}>Cookbook checks</Text>
      <Box component="ul" sx={{ m: 0, pl: 2, width: "100%" }} data-testid="premium-checks">
        {CHECKS.map((check) => (
          <li key={check}>
            <Text size="xs" c="dimmed">{check}</Text>
          </li>
        ))}
      </Box>

      <Divider data-testid="premium-paper-divider" />
      <ToolbarRow justify="space-between" data-testid="premium-paper-header">
        <Text size="sm" fw={700}>Paper trades</Text>
        <Text size="xs" c="dimmed" data-testid="premium-paper-summary">
          {summary.closed === 0
            ? "No closed trades yet"
            : `${summary.wins}/${summary.closed} wins · ${formatSignedPnl(summary.total)}`}
        </Text>
      </ToolbarRow>
      <ToolbarRow gap={8} data-testid="premium-paper-form">
        <Select w={140} size="sm" label="Underlying" value={underlying} onChange={(v) => setUnderlying(String(v))} data={["NIFTY", "BANKNIFTY"]} data-testid="paper-underlying" />
        <Select w={100} size="sm" label="Side" value={side} onChange={(v) => setSide(String(v))} data={["CE", "PE"]} data-testid="paper-side" />
        <NumberInput w={120} size="sm" label="Strike" value={strike} onChange={setStrike} data-testid="paper-strike" />
        <NumberInput w={90} size="sm" label="Qty" value={qty} onChange={setQty} data-testid="paper-qty" />
        <NumberInput w={110} size="sm" label="Entry ₹" value={entry} onChange={setEntry} data-testid="paper-entry" />
        <TextInput w={180} size="sm" label="Note" value={note} onChange={(e) => setNote(e.target.value)} data-testid="paper-note" />
        <Button size="sm" onClick={addTrade} data-testid="paper-add">Add</Button>
      </ToolbarRow>
      <TanStackTable
        data={trades}
        columns={columns}
        dataTestId="premium-paper-table"
        emptyMessage="No paper trades logged. Add one above to start the diary."
      />
    </CompactPanel>
  );
}
