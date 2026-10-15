import type { Meta, StoryObj } from "@storybook/react-vite";
import Box from "@mui/material/Box";
import * as palette from "@/ui/palette";
import {
  MarketAlertCard,
  MarketAlertLog,
  MarketAlertStack,
  MarketAlertRow,
  type AlertKind,
  type AlertSeverity,
  type MarketAlert,
} from "./MarketAlertCard";

/**
 * Market alerts — flat terminal log.
 *
 * One `MarketAlert` shape for OI bursts, price spikes, volume spikes,
 * breakouts and system messages. The log is the primary surface: sticky
 * header, 20px rows, keyboard driven. No cards, pills, tints or icons.
 */
const meta: Meta<typeof MarketAlertLog> = {
  title: "Composites/Notifications/Market Alerts",
  component: MarketAlertLog,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Dense alert log + toast stack. Greyscale base; colour is reserved for state (severity rail, up/down). ↑/↓ move, ⏎ open, Esc dismiss.",
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof MarketAlertLog>;

const NOW = Date.parse("2026-10-13T14:03:00+05:30");

/** Full-screen dark stage — the component assumes a terminal ground. */
function Stage({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: palette.BLACK, p: 2, boxSizing: "border-box" }}>
      {children}
    </Box>
  );
}

const ALERTS: MarketAlert[] = [
  {
    id: "a1",
    kind: "oi_burst",
    severity: "alert",
    symbol: "NIFTY",
    title: "Call ΔOI burst 22,600 CE",
    detail: "+170.16M in 3 min · writers defending 22,600",
    metrics: [
      { label: "ΔOI", value: "+170.16M", tone: "up" },
      { label: "SPOT", value: "22,551" },
      { label: "PCR", value: "1.20" },
    ],
    ts: NOW,
    source: "Nifty OI tape",
    href: "/report/nifty",
  },
  {
    id: "a2",
    kind: "price_spike",
    severity: "critical",
    symbol: "RELIANCE",
    title: "Price spike +3.4% in 4 min",
    detail: "₹2,412.50 → ₹2,494.10 · vol 2.1× 10d",
    metrics: [
      { label: "MOVE", value: "+3.4%", tone: "up" },
      { label: "VOL", value: "2.1×", tone: "up" },
      { label: "RSI", value: "78" },
    ],
    ts: NOW - 6 * 60_000,
    source: "Price surge",
    href: "/chart/RELIANCE",
  },
  {
    id: "a3",
    kind: "volume_spike",
    severity: "watch",
    symbol: "TATAMOTORS",
    title: "Volume spike 4.2× 10d average",
    detail: "1.2M shares in 5 min · price flat ₹982.40",
    metrics: [
      { label: "RELVOL", value: "4.2×", tone: "up" },
      { label: "CHG", value: "+0.1%" },
    ],
    ts: NOW - 11 * 60_000,
    source: "Volume surge screener",
  },
  {
    id: "a4",
    kind: "breakout",
    severity: "info",
    symbol: "NETWEB",
    title: "52-week breakout",
    detail: "crossed ₹1,240.00 · 1.8× volume",
    metrics: [
      { label: "LVL", value: "1,240", tone: "up" },
      { label: "VOL", value: "1.8×", tone: "up" },
    ],
    ts: NOW - 22 * 60_000,
    source: "52W high screener",
    href: "/chart/NETWEB",
  },
  {
    id: "a5",
    kind: "oi_burst",
    severity: "watch",
    symbol: "BANKNIFTY",
    title: "Put ΔOI build 48,500 PE",
    detail: "+92.40M in 5 min · support stacking",
    metrics: [
      { label: "ΔOI", value: "+92.40M", tone: "up" },
      { label: "SPOT", value: "48,610" },
    ],
    ts: NOW - 27 * 60_000,
    source: "Nifty OI tape",
  },
  {
    id: "a6",
    kind: "system",
    severity: "info",
    symbol: "FEED",
    title: "Market data reconnected",
    detail: "Upstox feed resumed after a 12s gap",
    ts: NOW - 40 * 60_000,
    source: "System",
  },
  {
    id: "a7",
    kind: "price_spike",
    severity: "alert",
    symbol: "HDFCBANK",
    title: "Price spike +2.1% in 3 min",
    detail: "₹1,742.00 → ₹1,778.60 · vol 1.7× 10d",
    metrics: [
      { label: "MOVE", value: "+2.1%", tone: "up" },
      { label: "VOL", value: "1.7×", tone: "up" },
    ],
    ts: NOW - 48 * 60_000,
    source: "Price surge",
  },
  {
    id: "a8",
    kind: "breakout",
    severity: "watch",
    symbol: "TATASTEEL",
    title: "Pivot R1 cross ₹148.20",
    detail: "1.4× volume · holding above R1",
    metrics: [{ label: "LVL", value: "148.20", tone: "up" }],
    ts: NOW - 55 * 60_000,
    source: "SR breakout",
  },
];

/** A session's worth of rows so the log actually fills a viewport. */
const LOG_ROWS: MarketAlert[] = Array.from({ length: 22 }, (_, i) => {
  const base = ALERTS[i % ALERTS.length];
  return { ...base, id: `row-${i}`, ts: NOW - i * 95_000 };
});

export const Log: Story = {
  name: "Log (viewport)",
  args: {
    alerts: LOG_ROWS,
    fill: false,
    height: 484,
  },
  render: (args) => (
    <Stage>
      <MarketAlertLog {...args} onOpen={() => {}} onDismiss={() => {}} />
    </Stage>
  ),
};

export const Empty: Story = {
  args: { alerts: [], fill: false, height: 120 },
  render: (args) => (
    <Stage>
      <Box sx={{ width: 620, maxWidth: "100%" }}>
        <MarketAlertLog {...args} />
      </Box>
    </Stage>
  ),
};

export const Rows: Story = {
  name: "Rows (20px)",
  render: () => (
    <Stage>
      <Box sx={{ width: 860, maxWidth: "100%" }}>
        {ALERTS.slice(0, 4).map((a) => (
          <MarketAlertRow key={a.id} alert={a} onOpen={() => {}} onDismiss={() => {}} />
        ))}
      </Box>
    </Stage>
  ),
};

export const Severity: Story = {
  name: "Severity",
  render: () => {
    const sevs: AlertSeverity[] = ["info", "watch", "alert", "critical"];
    return (
      <Stage>
        <Box sx={{ width: 860, maxWidth: "100%" }}>
          {sevs.map((severity, i) => (
            <MarketAlertRow
              key={severity}
              alert={{ ...ALERTS[0], id: `sev-${severity}`, severity, ts: NOW - i * 60_000 }}
              onOpen={() => {}}
            />
          ))}
        </Box>
      </Stage>
    );
  },
};

export const Kinds: Story = {
  name: "Kinds",
  render: () => {
    const kinds: AlertKind[] = ["oi_burst", "price_spike", "volume_spike", "breakout", "system"];
    return (
      <Stage>
        <Box sx={{ width: 860, maxWidth: "100%" }}>
          {kinds.map((kind) => {
            const base = ALERTS.find((a) => a.kind === kind) ?? ALERTS[0];
            return <MarketAlertRow key={kind} alert={{ ...base, id: `kind-${kind}`, kind }} onOpen={() => {}} />;
          })}
        </Box>
      </Stage>
    );
  },
};

export const Toasts: Story = {
  name: "Toast stack (coalesced)",
  render: () => (
    <Stage>
      <Box sx={{ width: 620, maxWidth: "100%" }}>
        <MarketAlertStack
          alerts={Array.from({ length: 9 }, (_, i) => ({
            ...ALERTS[i % ALERTS.length],
            id: `t-${i}`,
            ts: NOW - i * 20_000,
          }))}
          max={3}
          onOpen={() => {}}
          onDismiss={() => {}}
        />
      </Box>
    </Stage>
  ),
};

export const Card: Story = {
  name: "Card (centre density)",
  render: () => (
    <Stage>
      <Box sx={{ width: 820, maxWidth: "100%" }}>
        {ALERTS.slice(0, 3).map((a) => (
          <MarketAlertCard key={a.id} alert={a} onOpen={() => {}} onDismiss={() => {}} />
        ))}
      </Box>
    </Stage>
  ),
};
