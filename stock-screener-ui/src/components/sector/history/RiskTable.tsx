/**
 * Compatibility export for the old table name. The History overview renders
 * the new drawdown panel directly; this alias keeps existing callers and tests
 * on the stable `RiskTable` import.
 */
export { RiskDrawdownPanel as RiskTable } from "./risk/RiskDrawdownPanel";
export type { RiskDrawdownPanelProps as RiskTableProps } from "./risk/RiskDrawdownPanel";
