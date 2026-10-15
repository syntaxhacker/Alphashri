import { useState } from "react";
import Box from "@mui/material/Box";
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

export function StrategyRow({
  side,
  title,
  hint,
  glow,
  setups,
  underlying,
  onUnderlyingChange,
  spotOf,
  ltpOf,
  onAddSetup,
  onUpdateLeg,
  onDeleteSetup,
  onPaperFill,
}: StrategyRowProps) {
  const templates: StrategyTemplate[] = side === "BUY" ? BUY_STRATEGIES : SELL_STRATEGIES;
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const rowSetups = setups.filter((s) => {
    const t = templates.find((t) => t.id === s.templateId);
    return t !== undefined && s.underlying === underlying;
  });

  const addSetup = () => {
    const spot = spotOf(underlying);
    const atm = spot === null ? 0 : roundToStep(spot, stepFor(underlying));
    const template = templates.find((t) => t.id === templateId) ?? templates[0];
    if (!template) return;
    const setup = newSetup(template.id, template.name, underlying, atm);
    if (setup) onAddSetup(setup);
  };

  return (
    <Box data-testid={`strategy-row-${side}`} sx={{ width: "100%" }}>
      <ToolbarRow gap={8} justify="space-between" data-testid={`strategy-row-header-${side}`}>
        <ToolbarRow gap={8}>
          <Text size="sm" fw={700}>
            {glow ? "● " : "○ "}{title}
          </Text>
          <Text size="xs" c="dimmed">{hint}</Text>
        </ToolbarRow>
        <ToolbarRow gap={8}>
          <Select
            w={FIELD_W.underlying}
            size="sm"
            value={underlying}
            onChange={(v) => onUnderlyingChange(String(v) as "NIFTY" | "BANKNIFTY")}
            data={["NIFTY", "BANKNIFTY"]}
            data-testid={`strategy-row-underlying-${side}`}
          />
          <Select
            w={FIELD_W.template}
            size="sm"
            value={templateId}
            onChange={(v) => setTemplateId(String(v))}
            data={templates.map((t) => ({ value: t.id, label: t.name }))}
            data-testid={`strategy-row-template-${side}`}
          />
          <Button
            size="sm"
            style={{ ...ROW_BUTTON_SX }}
            onClick={addSetup}
            data-testid={`strategy-row-add-${side}`}
          >
            + Setup
          </Button>
        </ToolbarRow>
      </ToolbarRow>
      <ScrollArea data-testid={`strategy-row-scroll-${side}`}>
        <Box sx={{ display: "flex", gap: 8, py: 1, width: "max-content", minWidth: "100%" }}>
          {rowSetups.length === 0 && (
            <ToolbarRow gap={8} data-testid={`strategy-row-empty-${side}`}>
              <Text size="sm">No setups. Pick a template and press + Setup.</Text>
              {glow ? (
                <Badge color="success" size="xs">
                  Favored today
                </Badge>
              ) : (
                <Badge color="default" size="xs">
                  Neutral
                </Badge>
              )}
            </ToolbarRow>
          )}
          {rowSetups.map((setup) => (
            <SetupCard
              key={setup.id}
              setup={setup}
              spot={spotOf(setup.underlying)}
              ltpOf={(strike, optionType) => ltpOf(setup.underlying, strike, optionType)}
              onUpdateLeg={onUpdateLeg}
              onDeleteSetup={onDeleteSetup}
              onPaperFill={onPaperFill}
              glow={glow}
            />
          ))}
        </Box>
      </ScrollArea>
    </Box>
  );
}
