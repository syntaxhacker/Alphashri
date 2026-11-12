import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Box, Button, Divider, NumberInput, Select, Badge, Text, ToolbarRow, useMediaQuery } from "@/ui";
import SymbolAutocomplete from "@/components/common/SymbolAutocomplete";
import { CompactPanel } from "@/components/common/compact";
import * as palette from "@/ui/palette";
import { PayoffChart } from "../PremiumTracker/PayoffChart";
import { BUY_STRATEGIES, SELL_STRATEGIES, roundToStep, type StrategyTemplate } from "../PremiumTracker/strategies";
import {
  daysToExpiry,
  rangePctFor,
  scenarioRows,
  statsFor,
  toPayoffLegs,
  type SimulatorLeg,
} from "./simulatorMath";

const STORAGE_KEY = "options-simulator-saved-v1";
const FALLBACK_STEP = 50;

const ACTION_OPTIONS = [
  { value: "BUY", label: "BUY" },
  { value: "SELL", label: "SELL" },
];
const TYPE_OPTIONS = [
  { value: "CE", label: "CE" },
  { value: "PE", label: "PE" },
];

interface SimulatorPanelProps {
  selectedUnderlying: string;
  selectedExpiry: string;
  spotPrice: number | null;
  strikeMatrix: Array<{
    strike: number;
    ce?: { market_data?: { ltp?: number } } | null;
    pe?: { market_data?: { ltp?: number } } | null;
  }>;
  availableUnderlyings?: string[];
  availableExpiries?: string[];
  loading?: boolean;
  error?: string | null;
  onUnderlyingChange?: (underlying: string) => void;
  onExpiryChange?: (expiry: string) => void;
}

interface SavedStrategy {
  id: string;
  name: string;
  underlying: string;
  expiry: string;
  legs: SimulatorLeg[];
  createdAt: string;
}

let legUidCounter = 0;

function uid(): string {
  return `leg-${++legUidCounter}-${Date.now()}`;
}

function loadSavedStrategies(): SavedStrategy[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedStrategy[]) : [];
  } catch {
    return [];
  }
}

function inr(value: number): string {
  return `₹${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pnlText(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${inr(value)}`;
}

function LegRow({
  leg,
  index,
  strikes,
  ltpOf,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  leg: SimulatorLeg;
  index: number;
  strikes: number[];
  ltpOf: (strike: number, optionType: "CE" | "PE") => number | null;
  onUpdate: (legId: string, patch: Partial<Omit<SimulatorLeg, "legId">>) => void;
  onRemove: (legId: string) => void;
  onDuplicate: (legId: string) => void;
}) {
  const liveLTP = ltpOf(leg.strike, leg.optionType);
  const strikeOptions = [...new Set([...strikes, leg.strike])]
    .sort((a, b) => a - b)
    .map((s) => ({ value: String(s), label: String(s) }));

  return (
    <Box
      data-testid={`simulator-leg-${index}`}
      key={leg.legId}
      className="flex gap-[48px] items-center flex-wrap min-w-0"
    >
      <Select
        value={leg.action}
        onChange={(v) => {
          if (v === "BUY" || v === "SELL") onUpdate(leg.legId, { action: v });
        }}
        data={ACTION_OPTIONS}
        size="xs"
        w={92}
      />
      <Select
        value={leg.optionType}
        onChange={(v) => {
          if (v === "CE" || v === "PE") onUpdate(leg.legId, { optionType: v });
        }}
        data={TYPE_OPTIONS}
        size="xs"
        w={74}
      />
      {strikes.length > 0 ? (
        <Select
          value={String(leg.strike)}
          onChange={(v) => {
            if (v != null) {
              const strike = Number(v);
              onUpdate(leg.legId, { strike, entry: ltpOf(strike, leg.optionType) ?? leg.entry });
            }
          }}
          data={strikeOptions}
          size="xs"
          w={100}
        />
      ) : (
        <NumberInput
          value={leg.strike}
          onChange={(v) => {
            if (typeof v === "number") onUpdate(leg.legId, { strike: v });
          }}
          step={FALLBACK_STEP}
          min={0}
          size="xs"
          w={100}
        />
      )}
      <NumberInput
        value={leg.qty}
        onChange={(v) => {
          if (typeof v === "number" && v >= 1) onUpdate(leg.legId, { qty: v });
        }}
        min={1}
        step={1}
        size="xs"
        w={70}
      />
      <NumberInput
        value={leg.entry}
        onChange={(v) => {
          if (typeof v === "number") onUpdate(leg.legId, { entry: v });
        }}
        step={0.05}
        min={0}
        prefix="₹"
        w={110}
      />
      <Box style={{ "min-width": 72, display: "flex", "align-items": "center", "justify-content": "flex-end" }}>
        <Text size="xs" className="text-fin-text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
          {liveLTP == null ? "—" : liveLTP.toFixed(2)}
        </Text>
      </Box>
      <Button
        size="xs"
        variant="subtle"
        onClick={() => onDuplicate(leg.legId)}
        title="Duplicate leg"
        style={{ padding: "2px" }}
      >
        ⧉
      </Button>
      <Button
        size="xs"
        variant="subtle"
        onClick={() => onRemove(leg.legId)}
        title="Remove leg"
        style={{ padding: "2px", "margin-left": "-4px" }}
      >
        ×
      </Button>
    </Box>
  );
}

export function SimulatorPanel({
  selectedUnderlying,
  selectedExpiry,
  spotPrice,
  strikeMatrix,
  availableUnderlyings = [],
  availableExpiries = [],
  loading = false,
  error = null,
  onUnderlyingChange,
  onExpiryChange,
}: SimulatorPanelProps) {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const liveSpot = spotPrice != null && spotPrice > 0 ? spotPrice : null;

  const strikes = useMemo(() => {
    const set = new Set<number>();
    for (const row of strikeMatrix) set.add(row.strike);
    return [...set].sort((a, b) => a - b);
  }, [strikeMatrix]);

  const step = useMemo(() => {
    const diffs: number[] = [];
    for (let i = 1; i < strikes.length; i += 1) {
      const d = strikes[i] - strikes[i - 1];
      if (d > 0) diffs.push(d);
    }
    return diffs.length ? Math.min(...diffs) : FALLBACK_STEP;
  }, [strikes]);

  const atm = useMemo(() => {
    if (liveSpot != null) return roundToStep(liveSpot, step);
    if (strikes.length) return strikes[Math.floor(strikes.length / 2)];
    return 0;
  }, [liveSpot, strikes, step]);

  const dte = daysToExpiry(selectedExpiry);

  const ltpOf = useCallback(
    (strike: number, optionType: "CE" | "PE"): number | null => {
      const row = strikeMatrix.find((r) => r.strike === strike);
      const contract = optionType === "CE" ? row?.ce : row?.pe;
      return contract?.market_data?.ltp ?? null;
    },
    [strikeMatrix],
  );

  const [legs, setLegs] = useState<SimulatorLeg[]>([]);
  const [saved, setSaved] = useState<SavedStrategy[]>(loadSavedStrategies);
  const [loadValue, setLoadValue] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setNotice(null);
  }, [selectedUnderlying, selectedExpiry]);

  const canBuild = atm > 0 && strikes.length > 0;

  const setLeg = useCallback(
    (legId: string, patch: Partial<Omit<SimulatorLeg, "legId">>) => {
      setLegs((prev) => prev.map((leg) => (leg.legId === legId ? { ...leg, ...patch } : leg)));
    },
    [],
  );

  const selectTemplate = useCallback(
    (template: StrategyTemplate) => {
      if (!canBuild) {
        setNotice("Waiting for the live option chain — no premium has been filled.");
        return;
      }
      const built: SimulatorLeg[] = template.build(atm, step).map((leg) => ({
        legId: uid(),
        action: leg.action,
        optionType: leg.optionType,
        strike: leg.strike,
        qty: leg.qty,
        entry: ltpOf(leg.strike, leg.optionType) ?? 0,
      }));
      const missing = built.filter((leg) => ltpOf(leg.strike, leg.optionType) == null);
      setLegs(built);
      setSelectedTemplateId(template.id);
      setNotice(
        missing.length
          ? `${missing.length} leg(s) have no live LTP — enter the premium manually.`
          : null,
      );
    },
    [atm, step, ltpOf, canBuild],
  );

  const addLeg = useCallback(() => {
    if (!canBuild) {
      setNotice("Waiting for the live option chain — no leg was added.");
      return;
    }
    const entry = ltpOf(atm, "CE");
    setLegs((prev) => [
      ...prev,
      { legId: uid(), action: "BUY", optionType: "CE", strike: atm, qty: 1, entry: entry ?? 0 },
    ]);
    setNotice(entry == null ? "No live LTP for this strike — enter the premium manually." : null);
  }, [atm, ltpOf, canBuild]);

  const removeLeg = useCallback((legId: string) => {
    setLegs((prev) => prev.filter((leg) => leg.legId !== legId));
  }, []);

  const duplicateLeg = useCallback((legId: string) => {
    setLegs((prev) => {
      const idx = prev.findIndex((leg) => leg.legId === legId);
      if (idx < 0) return prev;
      const copy = { ...prev[idx], legId: uid() };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }, []);

  const reset = useCallback(() => {
    setLegs([]);
    setSelectedTemplateId(null);
    setLoadValue(null);
    setNotice(null);
  }, []);

  const save = useCallback(() => {
    if (legs.length === 0) return;
    const entry: SavedStrategy = {
      id: uid(),
      name: `Saved ${new Date().toLocaleString()}`,
      underlying: selectedUnderlying,
      expiry: selectedExpiry,
      legs,
      createdAt: new Date().toISOString(),
    };
    const next = [...saved, entry];
    setSaved(next);
    setLoadValue(null);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable — ignore
    }
  }, [legs, saved, selectedUnderlying, selectedExpiry]);

  const loadSaved = useCallback(
    (id: string | null) => {
      if (!id) return;
      const found = saved.find((s) => s.id === id);
      if (!found) return;
      setLegs(found.legs.map((leg) => ({ ...leg, legId: uid() })));
      setSelectedTemplateId(null);
      setLoadValue(null);
      setNotice(null);
    },
    [saved],
  );

  const payoffLegs = useMemo(() => toPayoffLegs(legs), [legs]);
  const stats = useMemo(() => statsFor(payoffLegs, liveSpot), [payoffLegs, liveSpot]);
  const scenario = useMemo(() => scenarioRows(payoffLegs, liveSpot), [payoffLegs, liveSpot]);
  const rangePct = useMemo(
    () => rangePctFor(liveSpot, legs.map((leg) => leg.strike)),
    [liveSpot, legs],
  );

  const statCells = [
    {
      label: "Net",
      value:
        stats.kind === "flat"
          ? "Flat"
          : `${stats.kind === "debit" ? "Debit" : "Credit"} ${inr(Math.abs(stats.netEntry))}`,
      tone: undefined,
    },
    {
      label: "Max profit",
      value: stats.maxProfit == null ? "Open" : `+${inr(stats.maxProfit)}`,
      tone: stats.maxProfit == null ? "secondary" : "success",
    },
    {
      label: "Max loss",
      value: stats.maxLoss == null ? "Open" : `-${inr(Math.abs(stats.maxLoss))}`,
      tone: stats.maxLoss == null ? "secondary" : "error",
    },
    {
      label: "Breakeven(s)",
      value: stats.breakevens.length > 0 ? stats.breakevens.map((b) => b.toLocaleString()).join(", ") : "—",
      tone: "secondary",
    },
    {
      label: "Risk / reward",
      value: stats.riskReward == null ? "—" : `${stats.riskReward.toFixed(2)} : 1`,
      tone: "secondary",
    },
  ];

  return (
    <Box data-testid="simulator-panel" className="flex flex-col h-full min-h-0">
      {/* Header */}
      <Box className="p-[8px] flex flex-col gap-[4px]" style={{ borderBottom: `1px solid ${palette.BORDER}` }}>
        <ToolbarRow gap={8} justify="space-between" style={{ "align-items": "baseline" }}>
          <Box className="flex flex-col min-w-0" gap={0}>
            <Text size="sm" fw={700} className="text-fin-primary" tt="uppercase">
              SIMULATOR
            </Text>
            <ToolbarRow gap={6} style={{ "margin-top": 2 }}>
              {onUnderlyingChange ? (
                <SymbolAutocomplete
                  value={selectedUnderlying}
                  onChange={(symbol) => {
                    const next = String(symbol || "").trim().toUpperCase();
                    if (next) onUnderlyingChange(next);
                  }}
                  extraOptions={availableUnderlyings}
                  compact
                  fnoOnly
                  width={200}
                  testid="simulator-underlying-search"
                />
              ) : (
                <Text size="xs" className="text-fin-text-muted">{selectedUnderlying}</Text>
              )}
              {availableExpiries.length > 0 && onExpiryChange ? (
                <Select
                  value={selectedExpiry}
                  onChange={(v) => v && onExpiryChange(String(v))}
                  data={availableExpiries.map((e) => ({ value: e, label: e }))}
                  size="xs"
                  w={132}
                  data-testid="simulator-expiry-select"
                />
              ) : (
                <Text size="xs" className="text-fin-text-muted">{selectedExpiry}</Text>
              )}
            </ToolbarRow>
            {isMobile ? (
              <Text size="xs" className="text-fin-text-muted" style={{ "margin-top": 2, fontVariantNumeric: "tabular-nums" }}>
                {loading ? "Loading · " : ""}
                Spot {liveSpot == null ? "—" : liveSpot.toLocaleString()} · ATM {atm || "—"} · DTE{" "}
                {dte == null ? "—" : `${dte} days`}
              </Text>
            ) : null}
          </Box>
          {!isMobile ? (
            <Box className="flex items-center flex-wrap gap-6">
              {loading ? (
                <Badge
                  size="xs"
                  variant="outline"
                  style={{ color: palette.PRIMARY, "border-color": palette.BORDER }}
                >
                  Loading live chain
                </Badge>
              ) : null}
              <Badge
                size="xs"
                variant="outline"
                style={{ color: palette.TEXT_MUTED, "border-color": palette.BORDER }}
              >
                Spot {liveSpot == null ? "—" : liveSpot.toLocaleString()}
              </Badge>
              <Badge
                size="xs"
                variant="outline"
                style={{ color: palette.TEXT_MUTED, "border-color": palette.BORDER }}
              >
                ATM {atm || "—"}
              </Badge>
              <Badge
                size="xs"
                variant="outline"
                style={{ color: palette.TEXT_MUTED, "border-color": palette.BORDER }}
              >
                DTE {dte == null ? "—" : `${dte} days`}
              </Badge>
            </Box>
          ) : null}
        </ToolbarRow>
        <Text size="xs" className="text-fin-text-muted">
          Build a multi-leg option strategy and view its payoff at expiry.
        </Text>
        {error ? (
          <Text size="xs" className="text-fin-negative" title={error} style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text size="xs" className="text-fin-negative" title={notice}>
            {notice}
          </Text>
        ) : null}
      </Box>

      <Box className="flex min-h-0 gap-[8px]" style={{ flex: 1, "flex-direction": isMobile ? "column" : "row" }}>
        {/* Left rail: strategy templates */}
        <Box className="w-full md:w-[280px] flex flex-col gap-[8px] min-w-0" style={{ "min-width": 0 }}>
          <CompactPanel title="Templates" testId="simulator-template-panel" padded>
            {[
              { group: "BUY", templates: BUY_STRATEGIES },
              { group: "SELL", templates: SELL_STRATEGIES },
            ].map(({ group, templates }) => (
              <Box key={group} className="flex flex-col gap-1 pt-1">
                <Text size="xs" tt="uppercase" fw={700} className="text-fin-text-muted">
                  {group}
                </Text>
                {templates.map((template) => {
                  const active = selectedTemplateId === template.id;
                  return (
                    <Button
                      key={template.id}
                      data-testid={`simulator-template-${template.id}`}
                      variant="outline"
                      size="sm"
                      fullWidth
                      onClick={() => selectTemplate(template)}
                      className={
                        active
                          ? "justify-start px-2 py-[3px] gap-0 normal-case border-fin-primary bg-fin-primary/15 text-fin-primary hover:bg-fin-primary/20"
                          : "justify-start px-2 py-[3px] gap-0 normal-case border-fin-border bg-transparent text-fin-text hover:bg-white/5"
                      }
                    >
                      <Box className="flex flex-col gap-0 min-w-0 w-full">
                        <Text size="sm" fw={700}>{template.name}</Text>
                        <Text size="xs" className="text-fin-text-muted">{template.blurb}</Text>
                      </Box>
                    </Button>
                  );
                })}
              </Box>
            ))}
          </CompactPanel>
        </Box>

        {/* Right builder */}
        <Box className="flex flex-col gap-[8px] min-w-0" style={{ flex: 1, "min-width": 0 }}>
          <CompactPanel title="Leg builder" testId="simulator-builder-panel" padded>
            <ToolbarRow gap={6} style={{ borderBottom: `1px solid ${palette.BORDER}`, "background-color": palette.SURFACE_ALT, "margin-bottom": 4 }}>
              <Box miw={92}><Text size="xs" className="text-fin-text-muted">Action</Text></Box>
              <Box miw={74}><Text size="xs" className="text-fin-text-muted">Type</Text></Box>
              <Box miw={100}><Text size="xs" className="text-fin-text-muted">Strike</Text></Box>
              <Box miw={70}><Text size="xs" className="text-fin-text-muted">Qty</Text></Box>
              <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}><Text size="xs" className="text-fin-text-muted" ta="right">Entry</Text></Box>
              <Box style={{ "min-width": 72, display: "flex", "justify-content": "flex-end" }}><Text size="xs" className="text-fin-text-muted">LTP</Text></Box>
              <Box style={{ width: 26 }} />
            </ToolbarRow>
            {legs.length === 0 ? (
              <Box className="flex flex-col items-center gap-[8px] py-[16px]">
                <Text size="xs" className="text-fin-text-muted">No legs yet</Text>
                <Text size="xs" className="text-fin-text-muted">Pick a template or add a leg to build the payoff.</Text>
              </Box>
            ) : (
              legs.map((leg, index) => (
                <LegRow
                  key={leg.legId}
                  leg={leg}
                  index={index}
                  strikes={strikes}
                  ltpOf={ltpOf}
                  onUpdate={setLeg}
                  onRemove={removeLeg}
                  onDuplicate={duplicateLeg}
                />
              ))
            )}
            <ToolbarRow gap={8} style={{ "margin-top": 8, "flex-wrap": "wrap" }}>
              <Button
                data-testid="simulator-add-leg"
                size="sm"
                onClick={addLeg}
              >
                + Add leg
              </Button>
            </ToolbarRow>
            <ToolbarRow gap={8} style={{ "margin-top": 4, "flex-wrap": "wrap" }}>
              <Button data-testid="simulator-reset" variant="outline" size="sm" onClick={reset}>
                Reset
              </Button>
              <Button data-testid="simulator-save" size="sm" disabled={legs.length === 0} onClick={save}>
                Save
              </Button>
              {saved.length > 0 && (
                <>
                  <Text size="xs" className="text-fin-text-muted">Load:</Text>
                  <Select
                    data-testid="simulator-load-select"
                    value={loadValue}
                    onChange={loadSaved}
                    data={saved.map((s) => ({ value: s.id, label: `${s.name} · ${s.underlying} ${s.expiry}` }))}
                    placeholder="Saved strategy"
                    size="sm"
                    w={210}
                  />
                </>
              )}
            </ToolbarRow>
          </CompactPanel>

          <CompactPanel title="Payoff & scenarios" testId="simulator-payoff-panel" padded>
            <PayoffChart
              legs={payoffLegs}
              spot={liveSpot}
              height={180}
              rangePct={rangePct}
              data-testid="simulator-payoff"
            />
            <ToolbarRow gap={10} style={{ "margin-top": 8, "flex-wrap": "wrap", "align-items": "center" }}>
              {statCells.map((cell, i) => (
                <Fragment key={cell.label}>
                  <Box className="flex flex-col gap-0 min-w-0">
                    <Text size="xs" tt="uppercase" fw={700} className="text-fin-text-muted">
                      {cell.label}
                    </Text>
                    <Text size="sm" fw={700} className={cell.tone === "success" ? "text-fin-positive" : cell.tone === "error" ? "text-fin-negative" : "text-fin-text-muted"} style={{ color: cell.label === "Net" ? palette.TEXT : undefined, fontVariantNumeric: "tabular-nums" }}>
                      {cell.value}
                    </Text>
                  </Box>
                  {i < statCells.length - 1 && <Divider orientation="vertical" />}
                </Fragment>
              ))}
            </ToolbarRow>
            <Box style={{ border: `1px solid ${palette.BORDER}`, "border-radius": 1, overflow: "hidden", "margin-top": 8 }}>
              <ToolbarRow gap={0} style={{ borderBottom: `1px solid ${palette.BORDER}`, "background-color": palette.SURFACE_ALT }}>
                <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}><Text size="xs" className="text-fin-text-muted">Spot move</Text></Box>
                <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}><Text size="xs" className="text-fin-text-muted" ta="right">Spot</Text></Box>
                <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}><Text size="xs" className="text-fin-text-muted">P&L at expiry</Text></Box>
              </ToolbarRow>
              <Box data-testid="simulator-scenario-table">
                {scenario.map((row) => (
                  <ToolbarRow
                    key={row.label}
                    gap={0}
                    style={{ borderBottom: `1px solid ${palette.BORDER}`, "align-items": "center" }}
                    data-testid="simulator-scenario-row"
                  >
                    <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}><Text size="xs">{row.label}</Text></Box>
                    <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}>
                      <Text size="xs" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {row.spot == null ? "—" : row.spot.toLocaleString()}
                      </Text>
                    </Box>
                    <Box style={{ flex: 1, "min-width": 0, padding: "2px 8px" }}>
                      <Text
                        size="xs"
                        ta="right"
                        className={row.pnl == null ? "text-fin-text-muted" : row.pnl > 0 ? "text-fin-positive" : "text-fin-negative"}
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {pnlText(row.pnl)}
                      </Text>
                    </Box>
                  </ToolbarRow>
                ))}
              </Box>
            </Box>
          </CompactPanel>
        </Box>
      </Box>
    </Box>
  );
}
