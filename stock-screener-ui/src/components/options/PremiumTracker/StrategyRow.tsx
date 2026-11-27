import { createMemo, createSignal, For, Show } from "solid-js";
import { Box } from "@/ui";
import { Badge, Button, ScrollArea, Select, Text, ToolbarRow } from "@/ui";
import { FIELD_W, ROW_BUTTON_SX } from "./widths";
import { SetupCard } from "./SetupCard";
import {
  BUY_STRATEGIES,
  SELL_STRATEGIES,
  newSetup,
  roundToStep,
  stepFor,
  type PaperSetup,
  type SetupLeg,
  type StrategySide,
  type StrategyTemplate,
} from "./strategies";
import type { Conviction } from "./paperTrades";

interface StrategyRowProps {
  side: StrategySide;
  title: string;
  hint: string;
  glow: boolean;
  setups: PaperSetup[];
  underlying: "NIFTY" | "BANKNIFTY";
  onUnderlyingChange: (u: "NIFTY" | "BANKNIFTY") => void;
  spotOf: (u: "NIFTY" | "BANKNIFTY") => number | null;
  ltpOf: (u: "NIFTY" | "BANKNIFTY", strike: number, optionType: "CE" | "PE") => number | null;
  onAddSetup: (setup: PaperSetup) => void;
  onUpdateLeg: (setupId: string, legId: string, patch: Partial<SetupLeg>) => void;
  onDeleteSetup: (setupId: string) => void;
  onPaperFill: (setup: PaperSetup, info: { conviction: Conviction; plan: string }) => void;
}

export function StrategyRow(props: StrategyRowProps) {
  const templates: StrategyTemplate[] = props.side === "BUY" ? BUY_STRATEGIES : SELL_STRATEGIES;
  const [templateId, setTemplateId] = createSignal(templates[0]?.id ?? "");

  const rowSetups = createMemo(() =>
    props.setups.filter((s) => {
      const t = templates.find((t) => t.id === s.templateId);
      return t !== undefined && s.underlying === props.underlying;
    }),
  );

  const addSetup = () => {
    const spot = props.spotOf(props.underlying);
    const atm = spot === null ? 0 : roundToStep(spot, stepFor(props.underlying));
    const template = templates.find((t) => t.id === templateId()) ?? templates[0];
    if (!template) return;
    const setup = newSetup(template.id, template.name, props.underlying, atm);
    if (setup) props.onAddSetup(setup);
  };

  return (
    <Box data-testid={`strategy-row-${props.side}`} w="100%">
      <ToolbarRow gap={8} justify="space-between" data-testid={`strategy-row-header-${props.side}`}>
        <ToolbarRow gap={8}>
          <Text size="sm" fw={700}>
            {props.glow ? "● " : "○ "}{props.title}
          </Text>
          <Text size="xs" c="dimmed">{props.hint}</Text>
        </ToolbarRow>
        <ToolbarRow gap={8}>
          <Select
            w={FIELD_W.underlying}
            size="sm"
            value={props.underlying}
            onChange={(v) => props.onUnderlyingChange(String(v) as "NIFTY" | "BANKNIFTY")}
            data={["NIFTY", "BANKNIFTY"]}
            data-testid={`strategy-row-underlying-${props.side}`}
          />
          <Select
            w={FIELD_W.template}
            size="sm"
            value={templateId()}
            onChange={(v) => setTemplateId(String(v))}
            data={templates.map((t) => ({ value: t.id, label: t.name }))}
            data-testid={`strategy-row-template-${props.side}`}
          />
          <Button
            size="sm"
            style={{ ...ROW_BUTTON_SX }}
            onClick={addSetup}
            data-testid={`strategy-row-add-${props.side}`}
          >
            + Setup
          </Button>
        </ToolbarRow>
      </ToolbarRow>
      <ScrollArea data-testid={`strategy-row-scroll-${props.side}`}>
        <Box className="flex gap-4 py-2 w-max-content min-w-full">
          <Show when={rowSetups().length === 0}>
            <ToolbarRow gap={8} data-testid={`strategy-row-empty-${props.side}`}>
              <Text size="sm">No setups. Pick a template and press + Setup.</Text>
              <Show when={props.glow} fallback={
                <Badge color="default" size="xs">
                  Neutral
                </Badge>
              }>
                <Badge color="success" size="xs">
                  Favored today
                </Badge>
              </Show>
            </ToolbarRow>
          </Show>
          <For each={rowSetups()}>
            {(setup) => (
              <SetupCard
                setup={setup}
                spot={props.spotOf(setup.underlying)}
                ltpOf={(strike, optionType) => props.ltpOf(setup.underlying, strike, optionType)}
                onUpdateLeg={props.onUpdateLeg}
                onDeleteSetup={props.onDeleteSetup}
                onPaperFill={props.onPaperFill}
                glow={props.glow}
              />
            )}
          </For>
        </Box>
      </ScrollArea>
    </Box>
  );
}
