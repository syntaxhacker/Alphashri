/**
 * Human copy for the value-scan gate keys. The generated presets carry the
 * wire names (`pe_pct_max`, `min_mcap_bn`, `above_200dma`); a gallery that
 * prints them verbatim is showing the API contract, not a thesis.
 *
 * Percentile gates are 0..1 "share of the row's own sector" bounds, so they
 * read as `P/E percentile ≤ 15%` — never as an absolute P/E.
 */
export type GateValue = string | number | boolean;

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

const PERCENTILE_METRICS: Record<string, string> = {
  pe_pct_max: "P/E",
  ps_pct_max: "P/S",
  pb_pct_max: "P/B",
  de_pct_max: "D/E",
  roe_pct_min: "ROE",
  fcf_yield_pct_min: "FCF yield",
  rev_yoy_pct_min: "Revenue growth",
  eps_yoy_pct_min: "EPS growth",
};

const TITLES: Record<string, string> = {
  max_pe: "P/E ≤",
  min_pe: "P/E ≥",
  max_ps: "P/S ≤",
  max_pb: "P/B ≤",
  min_roe: "ROE ≥",
  min_fcf_yield: "FCF yield ≥",
  max_rev_yoy: "Revenue growth ≤",
  min_rev_yoy: "Revenue growth ≥",
  min_eps_yoy: "EPS growth ≥",
  min_div_yield: "Dividend yield ≥",
  max_de: "D/E ≤",
  min_price: "Price ≥",
  min_volume: "Volume ≥",
  max_rsi: "RSI ≤",
};

/** `P/E percentile ≤ 15%` for the generated preset's 0.15 wire bound. */
export function valueGateLabel(
  key: string,
  value: GateValue,
  currencySymbol = "",
): string {
  if (typeof value === "boolean") {
    switch (key) {
      case "require_low_de":
        return "D/E ≤ 1.0";
      case "exclude_negative_fcf":
        return "Positive free cash flow";
      case "exclude_negative_eps":
        return "Positive EPS";
      case "above_200dma":
        return "Above 200DMA";
      case "exclude_loss_making":
        return "Net profit positive";
      default:
        return `${key.replace(/_/g, " ")} ${value ? "on" : "off"}`;
    }
  }

  if (key === "min_mcap_bn") return `Min mcap ${currencySymbol}${fmt(Number(value))}B`;
  if (key === "max_mcap_bn") return `Max mcap ${currencySymbol}${fmt(Number(value))}B`;
  if (key === "off_52w_high_pct_min") {
    return `Not among the furthest ${fmt(Number(value) * 100)}% below the 52W high`;
  }
  if (key === "sectors") return `Sector: ${String(value)}`;

  const metric = PERCENTILE_METRICS[key];
  if (metric) {
    const pct = fmt(Number(value) * 100);
    return key.endsWith("_pct_max")
      ? `${metric} percentile ≤ ${pct}%`
      : `${metric} percentile ≥ ${pct}%`;
  }

  const title = TITLES[key];
  if (title) {
    const suffix =
      key.includes("yield") || key.endsWith("_roe") || key.endsWith("_yoy") ? "%" : "";
    return `${title} ${fmt(Number(value))}${suffix}`;
  }

  // An unknown future gate still has to read as a label, not an API key.
  return `${key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")}: ${fmt(Number(value))}`;
}

export function valueGateChips(
  gates: Record<string, GateValue>,
  currencySymbol = "",
): { key: string; label: string }[] {
  return Object.entries(gates)
    .filter(([, value]) => value !== false)
    .map(([key, value]) => ({ key, label: valueGateLabel(key, value, currencySymbol) }));
}
