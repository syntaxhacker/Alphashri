import { formatNumberIN } from "@/utils/ui-helpers";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Box } from "@/ui";
import { Badge, Button, Divider, NumberInput, Select, Text, TextInput, ToolbarRow } from "@/ui";
import * as palette from "@/ui/palette";
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
  return `${sign}₹${formatNumberIN(Math.round(value))}`;
}

export function SetupCard(props: SetupCardProps) {
  const [conviction, setConviction] = createSignal<Conviction>("MEDIUM");
  const [plan, setPlan] = createSignal("");

  const setup = () => props.setup;
  const legs = () => setup().legs;

  const stats = createMemo(() => {
    const ls = legs();
    if (ls.length === 0) return null;
    const lo = Math.min(...ls.map((l) => l.strike));
    const hi = Math.max(...ls.map((l) => l.strike));
    const span = Math.max(hi - lo, props.spot ? props.spot * 0.02 : lo * 0.02);
    const be = breakevens(ls, lo - span, hi + span);
    return {
      debit: netEntry(ls),
      maxProfit: maxProfitAtExpiry(ls),
      maxLoss: maxLossAtExpiry(ls),
      breakevens: be,
    };
  });

  const live = createMemo(() => markSetup(setup(), (strike, optionType) => props.ltpOf(strike, optionType)));

  return (
    <Box
      data-testid={`setup-card-${setup().id}`}
      w={460}
      style={{
        "flex-shrink": 0,
        border: `1px solid ${props.glow ? palette.WARNING : palette.BORDER}`,
        "border-radius": 1,
        padding: 8,
        display: "flex",
        "flex-direction": "column",
        gap: 8,
      }}
    >
      <ToolbarRow justify="space-between" data-testid={`setup-header-${setup().id}`}>
        <Text size="sm" fw={700}>
          {setup().name}
        </Text>
        <ToolbarRow gap={4}>
          <Badge color="default" size="xs">{setup().underlying}</Badge>
          <Button size="sm" style={{ ...ROW_BUTTON_SX }} onClick={() => props.onDeleteSetup(setup().id)} data-testid={`setup-delete-${setup().id}`}>
            Del
          </Button>
        </ToolbarRow>
      </ToolbarRow>

      <For each={legs()}>
        {(leg) => (
          <Box data-testid={`setup-leg-${leg.legId}`} w="100%">
            <ToolbarRow gap={4}>
              <Select
                w={FIELD_W.action}
                size="sm"
                label="Action"
                value={leg.action}
                onChange={(v) => props.onUpdateLeg(setup().id, leg.legId, { action: String(v) as SetupLeg["action"] })}
                data={["BUY", "SELL"]}
                data-testid={`setup-leg-action-${leg.legId}`}
              />
              <NumberInput
                w={FIELD_W.strike}
                size="sm"
                label="Strike"
                value={leg.strike}
                onChange={(v) => props.onUpdateLeg(setup().id, leg.legId, { strike: Number(v) || 0 })}
                data-testid={`setup-leg-strike-${leg.legId}`}
              />
              <Select
                w={FIELD_W.type}
                size="sm"
                label="Type"
                value={leg.optionType}
                onChange={(v) => props.onUpdateLeg(setup().id, leg.legId, { optionType: String(v) as SetupLeg["optionType"] })}
                data={["CE", "PE"]}
                data-testid={`setup-leg-type-${leg.legId}`}
              />
              <NumberInput
                w={FIELD_W.qty}
                size="sm"
                label="Qty"
                value={leg.qty}
                onChange={(v) => props.onUpdateLeg(setup().id, leg.legId, { qty: Number(v) || 0 })}
                data-testid={`setup-leg-qty-${leg.legId}`}
              />
            </ToolbarRow>
            <ToolbarRow gap={4}>
              <NumberInput
                w={FIELD_W.entry}
                size="sm"
                label="Entry ₹"
                value={leg.entry}
                onChange={(v) => props.onUpdateLeg(setup().id, leg.legId, { entry: Number(v) || 0 })}
                data-testid={`setup-leg-entry-${leg.legId}`}
              />
              <Text size="xs" c="dimmed" data-testid={`setup-leg-ltp-${leg.legId}`}>
                {props.ltpOf(leg.strike, leg.optionType) === null ? "live —" : `live ₹${props.ltpOf(leg.strike, leg.optionType)}`}
              </Text>
            </ToolbarRow>
          </Box>
        )}
      </For>

      <PayoffChart legs={legs()} spot={props.spot} height={180} data-testid={`setup-payoff-${setup().id}`} />

      <Show when={stats()}>
        {(st) => (
          <Text size="xs" c="dimmed" data-testid={`setup-stats-${setup().id}`}>
            {st().debit >= 0 ? `Debit ₹${st().debit}` : `Credit ₹${-st().debit}`} · Max {fmtRupee(st().maxProfit)} / Min {fmtRupee(st().maxLoss)}
            {st().breakevens.length > 0 ? ` · BE ${st().breakevens.slice(0, 4).join(", ")}` : ""}
            {live() !== null ? ` · Live ${fmtRupee(live())}` : ""}
          </Text>
        )}
      </Show>

      <Divider />
      <ToolbarRow gap={4}>
        <Select
          w={FIELD_W.conviction}
          size="sm"
          label="Conviction"
          value={conviction()}
          onChange={(v) => setConviction(String(v) as Conviction)}
          data={["LOW", "MEDIUM", "HIGH"]}
          data-testid={`setup-conviction-${setup().id}`}
        />
        <TextInput
          w={FIELD_W.note}
          size="sm"
          label="Plan"
          value={plan()}
          onChange={(v) => setPlan(String(v))}
          data-testid={`setup-plan-${setup().id}`}
        />
        <Button size="sm" style={{ ...ROW_BUTTON_SX }} onClick={() => props.onPaperFill(setup(), { conviction: conviction(), plan: plan() })} data-testid={`setup-fill-${setup().id}`}>
          Paper fill
        </Button>
      </ToolbarRow>
    </Box>
  );
}
