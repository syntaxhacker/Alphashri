import type { SectionConcept, SectionCondition, SectionDefinition } from "./types";
import { SECTION_REGISTRY } from "./registry";

export * from "./registry";

const CONCEPT_SIDE: Record<SectionConcept, SectionDefinition["side"]> = {
  vwap_above: "long",
  vwap_below: "short",
  vwap_cross: "both",
  momentum_1m: "long",
  momentum_5m: "long",
  momentum_15m: "long",
  volume_surge_5m: "both",
  rvol_spike: "both",
  "52w_touch": "long",
  ema_cross: "long",
  orb_proxy: "both",
};

function preset(
  id: string,
  name: string,
  concept: SectionConcept,
  side: SectionDefinition["side"],
  conditions: SectionCondition[],
  refreshSec: number,
): SectionDefinition {
  const descriptor = SECTION_REGISTRY[concept];
  return {
    id,
    name,
    description: descriptor.description,
    concept,
    side,
    conditions: conditions.map((condition) => ({ ...condition })),
    render: { type: "table", columns: [...descriptor.defaultColumns] },
    refreshSec,
    enabled: true,
    pinned: false,
  };
}

export const DEFAULT_SECTIONS: SectionDefinition[] = [
  preset("vwap-reclaim", "VWAP Reclaim", "vwap_above", "long", [
    { metric: "close", op: "gt", value: null },
  ], 30),
  preset("vwap-reject", "VWAP Reject", "vwap_below", "short", [
    { metric: "close", op: "lt", value: null },
  ], 30),
  preset("momentum-5m-rvol", "Momentum 5m + RVOL≥1.5", "momentum_5m", "long", [
    { metric: "change|5", op: "gt", value: 0 },
    { metric: "relative_volume_10d_calc", op: "gte", value: 1.5 },
  ], 30),
  preset("volume-surge-5m", "Volume Surge 5m", "volume_surge_5m", "both", [
    { metric: "volume_change|5", op: "gt", value: 100 },
  ], 30),
  preset("rvol-spike-2x", "RVOL Spike ×2", "rvol_spike", "both", [
    { metric: "relative_volume_10d_calc", op: "gt", value: 2 },
  ], 30),
  preset("52w-touch", "52W Touch", "52w_touch", "long", [
    { metric: "close", op: "gte", value: null },
  ], 300),
  preset("ema-cross", "EMA Cross", "ema_cross", "long", [
    { metric: "EMA20", op: "crosses_above", value: null },
  ], 60),
];

let sequence = 0;

export function newSection(concept: SectionConcept): SectionDefinition {
  const descriptor = SECTION_REGISTRY[concept];
  sequence += 1;
  return {
    id: `${concept}-${sequence}`,
    name: descriptor.label,
    description: descriptor.description,
    concept,
    side: CONCEPT_SIDE[concept],
    conditions: descriptor.defaultConditions.map((condition) => ({ ...condition })),
    render: { type: "table", columns: [...descriptor.defaultColumns] },
    refreshSec: 60,
    enabled: true,
    pinned: false,
  };
}
