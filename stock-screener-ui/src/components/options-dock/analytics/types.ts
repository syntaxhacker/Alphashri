/**
 * Presentational contract for the options analytics tabs.
 *
 * The DTO types are re-exported from the API client so the single definition of
 * a nullable metric stays there — a missing greek is `null`, never `0`. These
 * primitives only decide how to render that value, never how to fabricate one.
 */
export type {
  AnalyticsExpiry,
  AnalyticsIvPoint,
  OptionsAnalytics,
} from "@/api/optionsAnalytics";

export const ANALYTICS_TABS = ["payoff", "smile", "term", "surface", "prob"] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];

/** Semantic ink for a metric value; resolved to a CSS var by MetricCell. */
export type AnalyticsTone = "positive" | "negative" | "warning" | "info" | "neutral";

export interface AnalyticsMetricVM {
  label: string;
  value: string;
  tone?: AnalyticsTone;
  testId?: string;
}
