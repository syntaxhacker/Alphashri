import { onMount, createEffect, createMemo, createSignal, Show, For } from "solid-js";
import { Box, Stack } from "@/ui";
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

function LegBlock(props: { leg: PremiumLeg }) {
  const leg = () => props.leg;
  return (
    <Box data-testid={`premium-leg-${leg().underlying}`} w="100%">
      <ToolbarRow gap={8} data-testid={`premium-leg-header-${leg().underlying}`}>
        <Text size="md" fw={700}>
          {leg().underlying}
        </Text>
        <Badge color={verdictColor(leg().verdict)} size="xs" data-testid={`premium-verdict-${leg().underlying}`}>
          {leg().verdict}
        </Badge>
        <Show when={leg().error} fallback={
          <Text size="xs" className="text-fin-text-muted">
            Spot {fmt(leg().spot ?? null, "", 0)} · ATM {fmt(leg().atm_strike ?? null, "", 0)} · DTE {leg().dte_days ?? "—"}
          </Text>
        }>
          {(err) => (
            <Text size="xs" className="text-fin-text-muted">
              {err()}
            </Text>
          )}
        </Show>
      </ToolbarRow>
      <Show when={!leg().error}>
        <CompactStatGrid>
          <CompactStat label="Straddle" value={`${fmt(leg().straddle_pct ?? null, "%")}`} hint={`₹${fmt(leg().straddle_price ?? null, "", 0)}`} valueSize="md" />
          <CompactStat label="IV / HV" value={`${fmt(leg().iv_hv_ratio ?? null, "x")}`} hint={`IV ${fmt(leg().ce_iv_pct ?? null, "%", 1)} / HV ${fmt(leg().hv20_ann_pct ?? null, "%", 1)}`} valueSize="md" />
          <CompactStat label="HV daily" value={`${fmt(leg().hv20_daily_pct ?? null, "%")}`} hint="20-day realized" valueSize="md" />
          <CompactStat label="Avg range" value={`${fmt(leg().avg_range20_pct ?? null, "%")}`} hint="20-day H-L" valueSize="md" />
        </CompactStatGrid>
      </Show>
    </Box>
  );
}

const SNAP_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatSnapshotTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000);
  const day = ist.getUTCDate();
  const month = SNAP_MONTHS[ist.getUTCMonth()];
  const hours = String(ist.getUTCHours()).padStart(2, "0");
  const minutes = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month}, ${hours}:${minutes} IST`;
}

const CHECKS = [
  "Straddle vs avg range — straddle % far above avg range means costly, far below means cheap.",
  "IV vs HV — IV above HV x 1.1 favors selling, below HV x 0.9 favors buying.",
  "Costly + chop = sell spreads. Cheap + morning range = buy ATM, exit same day.",
];

export function PremiumTrackerPanel(props: PremiumTrackerPanelProps) {
  const [legs, setLegs] = createSignal<PremiumLeg[]>([]);
  const [asOf, setAsOf] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [trades, setTrades] = createSignal<PaperTrade[]>(loadPaperTrades());
  const [setups, setSetups] = createSignal<PaperSetup[]>(loadSetups());
  const [buyUnderlying, setBuyUnderlying] = createSignal<"NIFTY" | "BANKNIFTY">("NIFTY");
  const [sellUnderlying, setSellUnderlying] = createSignal<"NIFTY" | "BANKNIFTY">("NIFTY");

  const refresh = async () => {
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
  };

  onMount(() => {
    void refresh();
  });

  createEffect(() => {
    savePaperTrades(trades());
  });

  createEffect(() => {
    saveSetups(setups());
  });

  const spotOf = (u: "NIFTY" | "BANKNIFTY"): number | null => {
    const leg = legs().find((l) => l.underlying === u);
    return leg?.spot ?? null;
  };

  const ltpOf = (u: "NIFTY" | "BANKNIFTY", strike: number, optionType: "CE" | "PE"): number | null => {
    if (u !== (props.selectedUnderlying ?? "NIFTY")) return null;
    const row = (props.strikeMatrix ?? []).find((r) => r.strike === strike);
    const contract = optionType === "CE" ? row?.ce : row?.pe;
    const ltp = contract?.market_data?.ltp;
    return typeof ltp === "number" ? ltp : null;
  };

  const glowSide = createMemo(() => {
    const sell = legs().some((l) => l.verdict === "EXPENSIVE");
    const buy = legs().some((l) => l.verdict === "CHEAP");
    return { buy, sell };
  });

  const addSetup = (setup: PaperSetup) => setSetups((prev) => [...prev, setup]);

  const updateLeg = (setupId: string, legId: string, patch: Partial<SetupLeg>) => {
    setSetups((prev) =>
      prev.map((s) =>
        s.id === setupId ? { ...s, legs: s.legs.map((l) => (l.legId === legId ? { ...l, ...patch } : l)) } : s,
      ),
    );
  };

  const deleteSetup = (setupId: string) => setSetups((prev) => prev.filter((s) => s.id !== setupId));

  const paperFill = (setup: PaperSetup, info: { conviction: Conviction; plan: string }) => {
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
  };

  const setExit = (id: string, exitValue: number) => {
    setTrades((prev) => updateTrade(prev, id, { exit: exitValue }));
  };

  const deleteTrade = (id: string) => setTrades((prev) => prev.filter((t) => t.id !== id));

  const updateTradeFields = (id: string, patch: Partial<Omit<PaperTrade, "id">>) => {
    setTrades((prev) => updateTrade(prev, id, patch));
  };

  return (
    <Stack spacing={1} w="100%" data-testid="premium-tracker-panel">
      <CompactPanel
        title="Premium Tracker"
        description={asOf() ? `Snapshot ${formatSnapshotTime(asOf())}` : "Cheap vs expensive + paper setups"}
        testId="premium-snapshot-panel"
        action={
          <Button size="sm" onClick={() => void refresh()} data-testid="premium-refresh">
            Refresh
          </Button>
        }
      >
        <Show when={loading()}>
          <ToolbarRow data-testid="premium-loading">
            <Loader size="sm" />
            <Text size="sm" className="text-fin-text-muted">Loading premium snapshot...</Text>
          </ToolbarRow>
        </Show>
        <Show when={!loading() && error()}>
          <Alert color="error" data-testid="premium-error">{error()}</Alert>
        </Show>
        <Show when={!loading() && !error()}>
          <Show when={legs().length === 0} fallback={
            <Box className="flex flex-wrap gap-[8px]">
              <For each={legs()}>
                {(leg) => (
                  <Box className="w-full sm:w-1/2">
                    <LegBlock leg={leg} />
                  </Box>
                )}
              </For>
            </Box>
          }>
            <Text size="sm" className="text-fin-text-muted" data-testid="premium-empty">No snapshot data.</Text>
          </Show>
        </Show>
        <Divider data-testid="premium-checks-divider" />
        <ul style={{ margin: 0, paddingLeft: "16px", width: "100%" }} data-testid="premium-checks">
          <For each={CHECKS}>
            {(check) => (
              <li>
                <Text size="xs" className="text-fin-text-muted">{check}</Text>
              </li>
            )}
          </For>
        </ul>
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
          glow={glowSide().buy}
          setups={setups()}
          underlying={buyUnderlying()}
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
          glow={glowSide().sell}
          setups={setups()}
          underlying={sellUnderlying()}
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
          trades={trades()}
          onSetExit={setExit}
          onDelete={deleteTrade}
          onUpdateTrade={updateTradeFields}
        />
      </CompactPanel>
    </Stack>
  );
}
