import { useCallback, useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { Alert, Badge, Button, Divider, Loader, Text, ToolbarRow } from "@/ui";
import { CompactPanel, CompactStat, CompactStatGrid } from "../../common/compact";
import { StrategyRow } from "./StrategyRow";
import { DiaryStrip } from "./DiaryStrip";
import { fetchPremiumTracker, type PremiumLeg } from "../../../api/premiumTracker";
import {
  loadPaperTrades,
  savePaperTrades,
  newPaperTrade,
  updateTrade,
  type Conviction,
  type PaperTrade,
} from "./paperTrades";
import {
  loadSetups,
  saveSetups,
  type PaperSetup,
  type SetupLeg,
} from "./strategies";

export interface ChainLeg {
  market_data?: { ltp?: number } | null;
}

export interface StrikeMatrixRow {
  strike: number;
  ce: ChainLeg | null;
  pe: ChainLeg | null;
}

interface PremiumTrackerPanelProps {
  strikeMatrix?: StrikeMatrixRow[];
  selectedUnderlying?: string;
}

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
  "Costly + chop = sell spreads. Cheap + morning range = buy ATM, exit same day.",
];

export function PremiumTrackerPanel({ strikeMatrix = [], selectedUnderlying = "NIFTY" }: PremiumTrackerPanelProps) {
  const [legs, setLegs] = useState<PremiumLeg[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>(() => loadPaperTrades());
  const [setups, setSetups] = useState<PaperSetup[]>(() => loadSetups());
  const [buyUnderlying, setBuyUnderlying] = useState<"NIFTY" | "BANKNIFTY">("NIFTY");
  const [sellUnderlying, setSellUnderlying] = useState<"NIFTY" | "BANKNIFTY">("NIFTY");

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

  useEffect(() => {
    saveSetups(setups);
  }, [setups]);

  const spotOf = useCallback(
    (u: "NIFTY" | "BANKNIFTY"): number | null => {
      const leg = legs.find((l) => l.underlying === u);
      return leg?.spot ?? null;
    },
    [legs],
  );

  const ltpOf = useCallback(
    (u: "NIFTY" | "BANKNIFTY", strike: number, optionType: "CE" | "PE"): number | null => {
      if (u !== selectedUnderlying) return null;
      const row = strikeMatrix.find((r) => r.strike === strike);
      const contract = optionType === "CE" ? row?.ce : row?.pe;
      const ltp = contract?.market_data?.ltp;
      return typeof ltp === "number" ? ltp : null;
    },
    [strikeMatrix, selectedUnderlying],
  );

  const glowSide = useMemo(() => {
    const sell = legs.some((l) => l.verdict === "EXPENSIVE");
    const buy = legs.some((l) => l.verdict === "CHEAP");
    return { buy, sell };
  }, [legs]);

  const addSetup = useCallback((setup: PaperSetup) => {
    setSetups((prev) => [...prev, setup]);
  }, []);

  const updateLeg = useCallback((setupId: string, legId: string, patch: Partial<SetupLeg>) => {
    setSetups((prev) =>
      prev.map((s) =>
        s.id === setupId ? { ...s, legs: s.legs.map((l) => (l.legId === legId ? { ...l, ...patch } : l)) } : s,
      ),
    );
  }, []);

  const deleteSetup = useCallback((setupId: string) => {
    setSetups((prev) => prev.filter((s) => s.id !== setupId));
  }, []);

  const paperFill = useCallback((setup: PaperSetup, info: { conviction: Conviction; plan: string }) => {
    const today = new Date().toISOString().slice(0, 10);
    const fills = setup.legs.map((leg) =>
      newPaperTrade({
        date: today,
        underlying: setup.underlying,
        side: leg.optionType,
        strike: leg.strike,
        qty: leg.qty,
        entry: leg.entry,
        note: setup.name,
        conviction: info.conviction,
        plan: info.plan,
      }),
    );
    setTrades((prev) => [...prev, ...fills]);
  }, []);

  const setExit = useCallback((id: string, exitValue: number) => {
    setTrades((prev) => updateTrade(prev, id, { exit: exitValue }));
  }, []);

  const deleteTrade = useCallback((id: string) => {
    setTrades((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const updateTradeFields = useCallback((id: string, patch: Partial<Omit<PaperTrade, "id">>) => {
    setTrades((prev) => updateTrade(prev, id, patch));
  }, []);

  return (
    <Stack spacing={1} sx={{ width: "100%" }} data-testid="premium-tracker-panel">
      <CompactPanel
        title="Premium Tracker"
        description={asOf ? `Snapshot ${asOf}` : "Cheap vs expensive + paper setups"}
        testId="premium-snapshot-panel"
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
        <Box component="ul" sx={{ m: 0, pl: 2, width: "100%" }} data-testid="premium-checks">
          {CHECKS.map((check) => (
            <li key={check}>
              <Text size="xs" c="dimmed">{check}</Text>
            </li>
          ))}
        </Box>
      </CompactPanel>

      <CompactPanel
        title="Paper setups"
        description="Buying rows bet the run · Selling rows bet the chop — entries are paper, exits are diary"
        testId="premium-setups-panel"
      >
        <StrategyRow
          side="BUY"
          title="BUYING strategies"
          hint="Long premium — max loss is the debit you pay"
          glow={glowSide.buy}
          setups={setups}
          underlying={buyUnderlying}
          onUnderlyingChange={setBuyUnderlying}
          spotOf={spotOf}
          ltpOf={ltpOf}
          onAddSetup={addSetup}
          onUpdateLeg={updateLeg}
          onDeleteSetup={deleteSetup}
          onPaperFill={paperFill}
        />
        <Divider data-testid="premium-side-divider" />
        <StrategyRow
          side="SELL"
          title="SELLING strategies"
          hint="Short premium, always hedged — never naked"
          glow={glowSide.sell}
          setups={setups}
          underlying={sellUnderlying}
          onUnderlyingChange={setSellUnderlying}
          spotOf={spotOf}
          ltpOf={ltpOf}
          onAddSetup={addSetup}
          onUpdateLeg={updateLeg}
          onDeleteSetup={deleteSetup}
          onPaperFill={paperFill}
        />
      </CompactPanel>

      <CompactPanel
        title="Diary — revisit and learn"
        description="Pick a day, set exits, open Review to record conviction, plan, and what went wrong"
        testId="premium-diary-panel"
      >
        <DiaryStrip
          trades={trades}
          onSetExit={setExit}
          onDelete={deleteTrade}
          onUpdateTrade={updateTradeFields}
        />
      </CompactPanel>
    </Stack>
  );
}
