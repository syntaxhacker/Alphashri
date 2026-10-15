import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { Badge, Button, Divider, NumberInput, Select, Text, TextInput, ToolbarRow } from "@/ui";
import { PayoffChart } from "./PayoffChart";
import {
  breakevens,
  maxLossAtExpiry,
  maxProfitAtExpiry,
  netEntry,
} from "./payoff";
import { markSetup, type PaperSetup, type SetupLeg } from "./strategies";
import type { Conviction } from "./paperTrades";
import { FIELD_W, ROW_BUTTON_SX } from "./widths";

interface SetupCardProps {
  setup: PaperSetup;
  spot: number | null;
  ltpOf: (strike: number, optionType: "CE" | "PE") => number | null;
  onUpdateLeg: (setupId: string, legId: string, patch: Partial<SetupLeg>) => void;
  onDeleteSetup: (setupId: string) => void;
  onPaperFill: (setup: PaperSetup, info: { conviction: Conviction; plan: string }) => void;
  glow?: boolean;
}

function fmtRupee(value: number | null): string {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return "open";
  const sign = value > 0 ? "+" : "";
  return `${sign}₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function SetupCard({ setup, spot, ltpOf, onUpdateLeg, onDeleteSetup, onPaperFill, glow }: SetupCardProps) {
  const [conviction, setConviction] = useState<Conviction>("MEDIUM");
  const [plan, setPlan] = useState("");

  const legs = setup.legs;
  const stats = useMemo(() => {
    if (legs.length === 0) return null;
    const lo = Math.min(...legs.map((l) => l.strike));
    const hi = Math.max(...legs.map((l) => l.strike));
    const span = Math.max(hi - lo, spot ? spot * 0.02 : lo * 0.02);
    const be = breakevens(legs, lo - span, hi + span);
    return {
      debit: netEntry(legs),
      maxProfit: maxProfitAtExpiry(legs),
      maxLoss: maxLossAtExpiry(legs),
      breakevens: be,
    };
  }, [legs, spot]);

  const live = useMemo(
    () =>
      markSetup(setup, (strike, optionType) => ltpOf(strike, optionType)),
    [setup, ltpOf],
  );

  return (
    <Box
      data-testid={`setup-card-${setup.id}`}
      sx={{
        width: 460,
        flexShrink: 0,
        border: "1px solid",
        borderColor: glow ? "warning.main" : "divider",
        borderRadius: 1,
        p: 1,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      <ToolbarRow justify="space-between" data-testid={`setup-header-${setup.id}`}>
        <Text size="sm" fw={700}>
          {setup.name}
        </Text>
        <ToolbarRow gap={4}>
          <Badge color="default" size="xs">{setup.underlying}</Badge>
          <Button size="sm" sx={ROW_BUTTON_SX} onClick={() => onDeleteSetup(setup.id)} data-testid={`setup-delete-${setup.id}`}>
            Del
          </Button>
        </ToolbarRow>
      </ToolbarRow>

      {legs.map((leg) => {
        const ltp = ltpOf(leg.strike, leg.optionType);
        return (
          <Box key={leg.legId} data-testid={`setup-leg-${leg.legId}`} sx={{ width: "100%" }}>
            <ToolbarRow gap={4}>
              <Select
                w={FIELD_W.action}
                size="sm"
                label="Action"
                value={leg.action}
                onChange={(v) => onUpdateLeg(setup.id, leg.legId, { action: String(v) as SetupLeg["action"] })}
                data={["BUY", "SELL"]}
                data-testid={`setup-leg-action-${leg.legId}`}
              />
              <NumberInput
                w={FIELD_W.strike}
                size="sm"
                label="Strike"
                value={leg.strike}
                onChange={(v) => onUpdateLeg(setup.id, leg.legId, { strike: Number(v) || 0 })}
                data-testid={`setup-leg-strike-${leg.legId}`}
              />
              <Select
                w={FIELD_W.type}
                size="sm"
                label="Type"
                value={leg.optionType}
                onChange={(v) => onUpdateLeg(setup.id, leg.legId, { optionType: String(v) as SetupLeg["optionType"] })}
                data={["CE", "PE"]}
                data-testid={`setup-leg-type-${leg.legId}`}
              />
              <NumberInput
                w={FIELD_W.qty}
                size="sm"
                label="Qty"
                value={leg.qty}
                onChange={(v) => onUpdateLeg(setup.id, leg.legId, { qty: Number(v) || 0 })}
                data-testid={`setup-leg-qty-${leg.legId}`}
              />
            </ToolbarRow>
            <ToolbarRow gap={4}>
              <NumberInput
                w={FIELD_W.entry}
                size="sm"
                label="Entry ₹"
                value={leg.entry}
                onChange={(v) => onUpdateLeg(setup.id, leg.legId, { entry: Number(v) || 0 })}
                data-testid={`setup-leg-entry-${leg.legId}`}
              />
              <Text size="xs" c="dimmed" data-testid={`setup-leg-ltp-${leg.legId}`}>
                {ltp === null ? "live —" : `live ₹${ltp}`}
              </Text>
            </ToolbarRow>
          </Box>
        );
      })}

      <PayoffChart legs={legs} spot={spot} height={180} data-testid={`setup-payoff-${setup.id}`} />

      {stats && (
        <Text size="xs" c="dimmed" data-testid={`setup-stats-${setup.id}`}>
          {stats.debit >= 0 ? `Debit ₹${stats.debit}` : `Credit ₹${-stats.debit}`} · Max {fmtRupee(stats.maxProfit)} / Min {fmtRupee(stats.maxLoss)}
          {stats.breakevens.length > 0 ? ` · BE ${stats.breakevens.slice(0, 4).join(", ")}` : ""}
          {live !== null ? ` · Live ${fmtRupee(live)}` : ""}
        </Text>
      )}

      <Divider />
      <ToolbarRow gap={4}>
        <Select
          w={FIELD_W.conviction}
          size="sm"
          label="Conviction"
          value={conviction}
          onChange={(v) => setConviction(String(v) as Conviction)}
          data={["LOW", "MEDIUM", "HIGH"]}
          data-testid={`setup-conviction-${setup.id}`}
        />
        <TextInput
          w={FIELD_W.note}
          size="sm"
          label="Plan"
          value={plan}
          onChange={(v) => setPlan(String(v))}
          data-testid={`setup-plan-${setup.id}`}
        />
        <Button size="sm" sx={ROW_BUTTON_SX} onClick={() => onPaperFill(setup, { conviction, plan })} data-testid={`setup-fill-${setup.id}`}>
          Paper fill
        </Button>
      </ToolbarRow>
    </Box>
  );
}
