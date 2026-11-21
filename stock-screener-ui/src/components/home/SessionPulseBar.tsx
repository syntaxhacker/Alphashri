import type { JSX } from "solid-js";
import { Box, Text } from "@/ui";
import type { CatalystIndexQuote, CatalystToday } from "@/api/catalysts";
import { useCatalystToday } from "@/state/catalystStore";
import { TZ_IST } from "@/config/constants";
import { formatPercentage } from "@/utils/ui-helpers";

const IST_HHMM = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ_IST,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Wall clock from the server snapshot — a local tick would drift from the feed. */
function istClockLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "—";
  const parts = IST_HHMM.formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? Number.NaN) % 24;
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  if (!Number.isFinite(hour) || minute === "") return "—";
  return `${String(hour).padStart(2, "0")}:${minute} IST`;
}

/** Null/absent is a dash — never a fabricated zero. */
function levelText(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function countText(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function changeTone(value: number | null | undefined): "success" | "error" | "dimmed" {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "dimmed";
  return value > 0 ? "success" : "error";
}

function IndexQuote(props: { label: string; testId: string; quote: CatalystIndexQuote | null | undefined }) {
  return (
    <span class="flex items-baseline gap-1 whitespace-nowrap" data-testid={props.testId}>
      <Text component="span" size="xs" fw={700} c="dimmed">
        {props.label}
      </Text>
      <Text component="span" size="xs" fw={700} className="font-mono tabular-nums">
        {levelText(props.quote?.last)}
      </Text>
      <Text
        component="span"
        size="xs"
        fw={600}
        c={changeTone(props.quote?.change_pct)}
        className="font-mono tabular-nums"
      >
        {formatPercentage(props.quote?.change_pct, 2, true)}
      </Text>
    </span>
  );
}

function Segment(props: { label: string; children: JSX.Element; testId?: string; live?: boolean }) {
  return (
    <span
      class="flex items-baseline gap-1 whitespace-nowrap"
      data-testid={props.testId}
      aria-live={props.live ? "polite" : undefined}
      aria-atomic={props.live ? "true" : undefined}
    >
      <Text component="span" size="xs" fw={700} c="dimmed">
        {props.label}
      </Text>
      {props.children}
    </span>
  );
}

/**
 * One glanceable strip under the Home toolbar. It reads the shared catalyst
 * store and never polls on its own — the store owns the 30 s cadence and the
 * visibility pause, so two consumers of this bar cannot double the request.
 */
export function SessionPulseBar() {
  const store = useCatalystToday();
  const data = (): CatalystToday | null => store.data();
  const sector = () => data()?.sector ?? null;
  const breadth = () => sector()?.breadth ?? null;

  const alertCount = (): number | null => {
    const high = data()?.counts?.high;
    return typeof high === "number" && Number.isFinite(high) ? high : null;
  };

  const alertText = (): string => {
    const count = alertCount();
    if (count === null) return "—";
    if (count === 0) return "Quiet";
    return `${countText(count)} HIGH`;
  };

  const catalystText = (): string => {
    const counts = data()?.counts;
    if (!counts) return "—";
    const high = countText(counts.high);
    const medium = countText(counts.medium);
    const low = countText(counts.low);
    if (high === "—" && medium === "—" && low === "—") return "—";
    return `${high}H ${medium}M ${low}L`;
  };

  const breadthText = (): string => {
    const value = breadth();
    if (!value) return "—";
    const advancing = countText(value.advancing);
    const declining = countText(value.declining);
    if (advancing === "—" && declining === "—") return "—";
    const total = countText(value.total);
    return total === "—" ? `${advancing} / ${declining}` : `${advancing} / ${declining} of ${total}`;
  };

  const refreshStatus = (): string => {
    if (store.error() && !data()) return "FAILED";
    if (store.loading() && !data()) return "LOADING";
    if (store.error() && data()) return "LAST GOOD";
    if (store.loading() && data()) return "REFRESHING";
    if (!data()) return "NO DATA";
    return (data()?.warnings.length ?? 0) > 0 ? "PARTIAL" : "LIVE";
  };

  const refreshTone = (): "success" | "error" | "warning" | "dimmed" => {
    const status = refreshStatus();
    if (status === "FAILED" || status === "LAST GOOD") return "error";
    if (status === "PARTIAL") return "warning";
    if (status === "LIVE") return "success";
    return "dimmed";
  };

  const refreshHint = (): string => {
    const warnings = data()?.warnings ?? [];
    const updated = data()?.as_of ? `Updated ${istClockLabel(data()?.as_of)}` : "No successful update yet";
    const detail = warnings.length > 0 ? ` · ${warnings.join(", ")}` : "";
    return `${updated}${detail}`;
  };

  return (
    <Box
      data-testid="home-pulse-bar"
      aria-label="Session pulse"
      role="group"
      class="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-y border-fin-border bg-fin-surface px-3 py-1 min-[900px]:flex-nowrap min-[900px]:gap-4"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 min-[900px]:flex-nowrap">
        <Segment label="SESSION" testId="pulse-clock">
          <Text component="span" size="xs" fw={600} className="font-mono tabular-nums">
            {istClockLabel(data()?.as_of)}
          </Text>
        </Segment>
        <IndexQuote
          label="NIFTY"
          testId="pulse-nifty"
          quote={data()?.market?.nifty}
        />
        <IndexQuote
          label="SENSEX"
          testId="pulse-sensex"
          quote={data()?.market?.sensex}
        />
        <Segment label="BREADTH" testId="pulse-breadth">
          <Text component="span" size="xs" fw={600} className="font-mono tabular-nums">
            {breadthText()}
          </Text>
        </Segment>
        <Segment label="VIX" testId="pulse-vix">
          <Text component="span" size="xs" fw={600} className="font-mono tabular-nums">
            {levelText(data()?.market?.vix)}
          </Text>
        </Segment>
      </div>

      <div
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 min-[900px]:flex-nowrap min-[900px]:border-l min-[900px]:border-fin-border min-[900px]:pl-4"
      >
        <Segment label={sector()?.label ?? "MARKET"} testId="pulse-sector">
          <Text
            component="span"
            size="xs"
            fw={600}
            c={changeTone(sector()?.change_pct)}
            className="font-mono tabular-nums"
          >
            {formatPercentage(sector()?.change_pct, 2, true)}
          </Text>
          <Text component="span" size="xs" c="dimmed">
            RS
          </Text>
          <Text
            component="span"
            size="xs"
            fw={600}
            c={changeTone(sector()?.relative_strength_pct)}
            className="font-mono tabular-nums"
          >
            {formatPercentage(sector()?.relative_strength_pct, 2, true)}
          </Text>
        </Segment>

        <Segment label="CATALYSTS" testId="pulse-catalysts">
          <Text component="span" size="xs" fw={600} className="font-mono tabular-nums">
            {catalystText()}
          </Text>
        </Segment>

        <Segment label="ALERTS" testId="pulse-alerts" live>
          <Text
            component="span"
            size="xs"
            fw={700}
            c={alertCount() === null ? "dimmed" : alertCount() === 0 ? "dimmed" : "warning"}
          >
            {alertText()}
          </Text>
        </Segment>

        <Segment label="FEED" testId="pulse-refresh" live>
          <Text
            component="span"
            size="xs"
            fw={700}
            c={refreshTone()}
            title={refreshHint()}
          >
            {refreshStatus()}
          </Text>
        </Segment>
      </div>
    </Box>
  );
}
