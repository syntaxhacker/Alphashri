import type { PaperPosition } from "../../types/paperTrading";

/** Positions can share a symbol across strategies, so the row key is composite. */
export function getPositionRowId(pos: Pick<PaperPosition, "symbol" | "strategy_id" | "id">): string {
  const clean = (value: string | number | null | undefined) =>
    String(value ?? 0).replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${clean(pos.strategy_id ?? pos.id)}-${clean(pos.symbol)}`;
}
