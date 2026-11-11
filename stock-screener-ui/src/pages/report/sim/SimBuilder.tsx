import type { ReactNode } from "react";
import type { SimLegSpec, SimStrategySpec } from "@/types/reportSim";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  NumberInput,
  Select,
  Text,
  TextInput,
  ToolbarRow,
} from "@/ui";
import * as palette from "@/ui/palette";
import { IconPlus, IconX } from "@tabler/icons-react";
import { resolvePreviewStrike, structureKind } from "./simSpec";

const MAX_LEGS = 12;
const ACTIONS = ["BUY", "SELL"];
const OPTS = ["CE", "PE"];

interface SimBuilderProps {
  strategy: SimStrategySpec;
  ladder: number[];
  spot: number;
  errors: string[];
  onChange: (next: SimStrategySpec) => void;
}

export interface SimContextStripProps {
  mode: "live" | "eod";
  date: string;
  expiry: string;
  dte: string;
  spot: string;
  lotSize: string;
  lotVerified: boolean;
  coverageText: string;
  tapeLag: string;
  deskTotal: string;
}

function Ctx({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Box className="flex flex-col min-w-0">
      <Text
        span
        size="xs"
        style={{
          fontSize: 9,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: palette.TEXT_MUTED,
        }}
      >
        {label}
      </Text>
      <Box className="flex items-center gap-1 min-w-0">
        <Text span size="xs" fw={700} className="font-mono">
          {value}
        </Text>
        {hint}
      </Box>
    </Box>
  );
}

/** Desk-level context strip shared by every SIM tab. */
export function SimContextStrip({
  mode,
  date,
  expiry,
  dte,
  spot,
  lotSize,
  lotVerified,
  coverageText,
  tapeLag,
  deskTotal,
}: SimContextStripProps) {
  return (
    <ToolbarRow
      data-testid="sim-context"
      gap={16}
      className="border border-fin-border rounded-[1px] p-2 bg-fin-surface-alt"
    >
      <Ctx label="Mode / date" value={`${mode.toUpperCase()} · ${date || "—"}`} />
      <Ctx label="Expiry / DTE" value={`${expiry} · ${dte}`} />
      <Ctx label="Spot" value={spot} />
      <Ctx
        label="Lot size"
        value={lotSize}
        hint={
          lotVerified ? null : (
            <Badge data-testid="sim-lot-unverified" size="xs" color="warning" variant="outline">
              unverified
            </Badge>
          )
        }
      />
      <Ctx label="Coverage" value={coverageText} />
      <Ctx label="Tape lag" value={tapeLag} />
      <Ctx label="Desk total" value={deskTotal} />
    </ToolbarRow>
  );
}

function toNumber(value: number | string, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function replaceLeg(
  legs: SimLegSpec[],
  index: number,
  patch: Partial<SimLegSpec>,
): SimLegSpec[] {
  return legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg));
}

function strikeLabel(ref: string, spot: number, ladder: number[]): string | null {
  const strike = resolvePreviewStrike(ref, spot, ladder);
  return strike === null ? null : String(strike);
}

export function SimBuilder({
  strategy,
  ladder,
  spot,
  errors,
  onChange,
}: SimBuilderProps) {
  const legs = strategy.legs;

  const patchLeg = (index: number, patch: Partial<SimLegSpec>) =>
    onChange({ ...strategy, legs: replaceLeg(legs, index, patch) });

  const addLeg = () => {
    if (legs.length >= MAX_LEGS) return;
    onChange({
      ...strategy,
      legs: [...legs, { action: "BUY", opt: "CE", strike: "ATM", lots: 1 }],
    });
  };

  const removeLeg = (index: number) => {
    onChange({ ...strategy, legs: legs.filter((_, i) => i !== index) });
  };

  const patchExec = (patch: Partial<SimStrategySpec["exec"]>) =>
    onChange({ ...strategy, exec: { ...strategy.exec, ...patch } });

  const resolved = legs
    .map((leg) => strikeLabel(leg.strike, spot, ladder))
    .filter((value): value is string => value !== null);

  return (
    <Box
      data-testid="sim-builder"
      className="flex flex-col gap-2 min-w-0"
    >
      <TextInput
        data-testid="sim-name"
        label="Strategy name"
        size="xs"
        w="100%"
        value={strategy.name}
        onChange={(name) => onChange({ ...strategy, name })}
      />

      <Box
        data-testid="sim-legs"
        className="border border-fin-border rounded-[1px] p-2 min-w-0"
      >
        <ToolbarRow justify="space-between">
          <Text span size="xs" fw={700} className="uppercase">
            Legs · {legs.length}
          </Text>
          <Button
            data-testid="sim-add-leg"
            size="xs"
            variant="default"
            leftSection={<IconPlus size={12} />}
            disabled={legs.length >= MAX_LEGS}
            onClick={addLeg}
          >
            + ADD LEG
          </Button>
        </ToolbarRow>

        {legs.length === 0 ? (
          <Text size="xs" c="dimmed" className="py-2">
            No legs yet — add one.
          </Text>
        ) : null}

        {legs.map((leg, index) => {
          const preview = strikeLabel(leg.strike, spot, ladder);
          return (
            <Box key={`leg-${index}`} data-testid={`sim-leg-${index}`}>
              <Divider />
              <ToolbarRow gap={8} className="py-[6px]">
                <Select
                  data-testid={`sim-leg-${index}-action`}
                  size="xs"
                  w={84}
                  data={ACTIONS}
                  value={leg.action}
                  onChange={(value) => {
                    if (value) patchLeg(index, { action: value as SimLegSpec["action"] });
                  }}
                />
                <Select
                  data-testid={`sim-leg-${index}-opt`}
                  size="xs"
                  w={70}
                  data={OPTS}
                  value={leg.opt}
                  onChange={(value) => {
                    if (value) patchLeg(index, { opt: value as SimLegSpec["opt"] });
                  }}
                />
                <Box className="flex flex-col w-[100px]">
                  <TextInput
                    data-testid={`sim-leg-${index}-strike`}
                    size="xs"
                    w="100%"
                    placeholder="ATM+2 / 24900"
                    value={leg.strike}
                    onChange={(strike) => patchLeg(index, { strike })}
                  />
                  <Text
                    span
                    size="xs"
                    data-testid={`sim-leg-${index}-resolved`}
                    style={{
                      fontSize: 9,
                      color: preview === null ? palette.NEGATIVE : palette.TEXT_MUTED,
                    }}
                  >
                    {preview === null ? "unresolved" : `→ ${preview}`}
                  </Text>
                </Box>
                <NumberInput
                  data-testid={`sim-leg-${index}-lots`}
                  size="xs"
                  w={56}
                  label="Lots"
                  min={1}
                  max={50}
                  value={leg.lots}
                  onChange={(value: number | string) =>
                    patchLeg(index, { lots: toNumber(value, leg.lots) })
                  }
                />
                <ActionIcon
                  data-testid={`sim-leg-${index}-remove`}
                  size="sm"
                  variant="subtle"
                  color="error"
                  aria-label={`Remove leg ${index + 1}`}
                  onClick={() => removeLeg(index)}
                >
                  <IconX size={14} />
                </ActionIcon>
              </ToolbarRow>
            </Box>
          );
        })}
      </Box>

      <Box
        data-testid="sim-exec"
        className="border border-fin-border rounded-[1px] p-2"
      >
        <Text span size="xs" fw={700} className="uppercase">
          Execution
        </Text>
        <ToolbarRow gap={8} className="mt-[6px]">
          <TextInput
            data-testid="sim-entry-time"
            size="xs"
            w={90}
            label="Entry"
            value={strategy.exec.entryTime}
            onChange={(entryTime) => patchExec({ entryTime })}
          />
          <NumberInput
            data-testid="sim-sl"
            size="xs"
            w={90}
            label="SL %"
            min={0}
            max={500}
            value={strategy.exec.slPct}
            onChange={(slPct: number | string) =>
              patchExec({ slPct: toNumber(slPct, strategy.exec.slPct) })
            }
          />
          <NumberInput
            data-testid="sim-tp"
            size="xs"
            w={90}
            label="TP %"
            min={0}
            max={500}
            value={strategy.exec.tpPct}
            onChange={(tpPct: number | string) =>
              patchExec({ tpPct: toNumber(tpPct, strategy.exec.tpPct) })
            }
          />
          <NumberInput
            data-testid="sim-max-hold"
            size="xs"
            w={90}
            label="Max hold"
            min={0}
            max={400}
            value={strategy.exec.maxHoldMin}
            onChange={(maxHoldMin: number | string) =>
              patchExec({ maxHoldMin: toNumber(maxHoldMin, strategy.exec.maxHoldMin) })
            }
          />
          <NumberInput
            data-testid="sim-trail"
            size="xs"
            w={90}
            label="Trail %"
            min={0}
            value={strategy.exec.trailPct}
            onChange={(trailPct: number | string) =>
              patchExec({ trailPct: toNumber(trailPct, strategy.exec.trailPct) })
            }
          />
          <TextInput
            data-testid="sim-eod-exit"
            size="xs"
            w={90}
            label="EOD exit"
            value={strategy.exec.eodExit}
            onChange={(eodExit) => patchExec({ eodExit })}
          />
        </ToolbarRow>
      </Box>

      {errors.length > 0 ? (
        <Alert color="error" data-testid="sim-errors">
          {errors.map((message) => (
            <Text key={message} span size="xs" style={{ display: "block" }}>
              {message}
            </Text>
          ))}
        </Alert>
      ) : null}

      <ToolbarRow gap={8} data-testid="sim-structure">
        <Badge size="xs" variant="outline" color="default">
          {structureKind(legs)}
        </Badge>
        <Text span size="xs" c="dimmed">
          {legs.length} leg{legs.length === 1 ? "" : "s"}
        </Text>
        <Text span size="xs" c="dimmed" className="min-w-0">
          {resolved.length > 0 ? `strikes ${resolved.join(" / ")}` : "no resolved strikes"}
        </Text>
      </ToolbarRow>
    </Box>
  );
}

export default SimBuilder;
