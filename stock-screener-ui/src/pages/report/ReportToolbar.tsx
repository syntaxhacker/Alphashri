import { Show } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, SegmentedControl, Select, Text, TextInput } from "@/ui";
import * as palette from "@/ui/palette";
import { CompactPanel } from "@/components/common/compact";
import { NiftyDataFreshness } from "./NiftyDataFreshness";
import { NiftyDeskGuide } from "./NiftyDeskGuide";
import { NiftyPositionsDrawer } from "./NiftyPositionsDrawer";
import { NiftyReplayBar } from "./NiftyReplayBar";
import { NiftyUpdatedLabel } from "./NiftyUpdatedLabel";
import { useNiftyReport } from "./ReportContext";
import { SimDesk } from "./sim/SimDesk";

type ReportSymbol = "NIFTY" | "SENSEX" | "RELIANCE";

const SYMBOL_SELECT_DATA: { value: ReportSymbol; label: string }[] = [
  { value: "NIFTY", label: "NIFTY" },
  { value: "SENSEX", label: "SENSEX" },
  { value: "RELIANCE", label: "RELIANCE" },
];

const INDEX_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "nifty", label: "NIFTY" },
  { value: "sensex", label: "SENSEX" },
];
const MODE_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "live", label: "Live" },
  { value: "eod", label: "EOD" },
];
const VIEW_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "chart", label: "Chart" },
  { value: "depth", label: "Depth" },
];
const DESK_TOGGLE_DATA: { value: string; label: string }[] = [
  { value: "desk", label: "DESK" },
  { value: "research", label: "RESEARCH" },
];

const EXPIRY_SELECT_CLASS = "w-[104px] min-w-[104px] max-w-[104px] flex-none";
const SYMBOL_SELECT_CLASS = "w-[116px] min-w-[116px] max-w-[116px] flex-none";

const TOOLBAR_CLASS =
  "flex items-center gap-1.5 flex-nowrap overflow-x-auto px-2 py-1 min-h-[30px] w-full max-w-full min-w-0 shrink-0 [&>*]:flex-none [&_[data-testid='nifty-updated-at']]:leading-[20px]";

const GENERIC_EXPIRY_NOTE_STYLE: JSX.CSSProperties = {
  "font-size": "9px",
  "font-weight": 700,
  "letter-spacing": "0.04em",
  color: palette.TEXT_MUTED,
  border: `1px solid ${palette.TERM_BORDER}`,
  "border-radius": "3px",
  "padding-left": "4px",
  "padding-right": "4px",
  "white-space": "nowrap",
};

const STALE_BADGE_STYLE: JSX.CSSProperties = {
  display: "inline-block",
  border: "1px solid",
  "border-color": palette.WARNING,
  "border-radius": "9999px",
  "padding-left": "8px",
  "padding-right": "8px",
  "padding-top": "2px",
  "padding-bottom": "2px",
  "white-space": "nowrap",
};

export function ReportToolbar(_props: { onOpenSymbol?: (s: string) => void }) {
  const store = useNiftyReport();

  const symbol = () => store.selection.symbol();
  const index = () => store.selection.index();
  const mode = () => store.selection.mode();
  const expiry = () => store.selection.expiry();
  const date = () => store.selection.date();
  const view = () => store.ui.view();
  const deskMode = () => store.ui.deskMode();
  const report = () => store.data.report();
  const tape = () => store.data.tape();
  const loading = () => store.data.loading();
  const snapshotting = () => store.data.snapshotting();
  const marketClosed = () => store.data.freshness.marketClosed();
  const isStale = () => store.data.freshness.isStale();
  const updatedAtMs = () => store.data.freshness.updatedAtMs();
  const staleMins = () => store.data.freshness.staleMins();
  const replay = () => store.replay.replay();

  const sessionDate = () => report()?.market?.session_date ?? tape()?.date ?? report()?.date;

  const replayForBar = () => {
    const current = replay();
    return mode() === "eod" && current && current.snapshots.length > 0 ? current : null;
  };

  const snapshotTitle = () =>
    symbol() !== "NIFTY"
      ? "Snapshots are recorded for NIFTY only"
      : mode() === "eod"
        ? "Only available in Live mode — an EOD date is history, not a snapshot"
        : "Capture the current option chain";

  return (
    <CompactPanel padded={false}>
      <Box data-testid="nifty-toolbar" className={TOOLBAR_CLASS}>
        <Select
          data-testid="report-symbol-select"
          value={symbol()}
          onChange={(value) => store.selection.handleSymbolChange(value)}
          data={SYMBOL_SELECT_DATA}
          size="xs"
          w={116}
          h={22}
          className={SYMBOL_SELECT_CLASS}
        />
        <Show when={symbol() === "NIFTY"}>
          <SegmentedControl
            data-testid="nifty-index-toggle"
            value={index()}
            onChange={(value) => store.selection.handleIndexChange(value)}
            data={INDEX_TOGGLE_DATA}
            size="xs"
          />
        </Show>
        <Show when={store.selection.hasRecordedHistory()}>
          <SegmentedControl
            data-testid="nifty-mode-toggle"
            value={mode()}
            onChange={(value) => store.selection.handleModeChange(value)}
            data={MODE_TOGGLE_DATA}
            size="xs"
          />
        </Show>
        <SegmentedControl
          data-testid="nifty-view-toggle"
          value={view()}
          onChange={(value) => store.ui.handleViewChange(value)}
          data={VIEW_TOGGLE_DATA}
          size="xs"
        />
        <SegmentedControl
          data-testid="nifty-desk-toggle"
          value={deskMode()}
          onChange={(value) => store.ui.handleDeskChange(value)}
          data={DESK_TOGGLE_DATA}
          size="xs"
        />
        <Select
          data-testid="nifty-expiry-select"
          value={expiry()}
          onChange={(value) => store.selection.handleExpiryChange(value)}
          data={store.selection.expiryData()}
          size="xs"
          w={104}
          h={22}
          className={EXPIRY_SELECT_CLASS}
        />
        <Show when={mode() === "eod"}>
          <TextInput
            data-testid="nifty-date-input"
            type="date"
            value={date()}
            onChange={(value) => store.selection.setDate(value)}
            size="xs"
            w={110}
            h={22}
          />
        </Show>
        <Show when={symbol() !== "NIFTY" && expiry() !== "nearest"}>
          <span
            data-testid="nifty-generic-expiry-note"
            title="Recorded history (tape, OI stream, replay) is captured for the nearest expiry — the selected expiry applies to the live chain only."
            style={GENERIC_EXPIRY_NOTE_STYLE}
          >
            history = nearest expiry
          </span>
        </Show>
        <Box className="flex-1 min-w-[8px]" />
        <SimDesk
          symbol={symbol()}
          mode={mode()}
          date={date()}
          report={report()}
          replay={replay()}
          replayIndex={store.replay.index()}
        />
        <NiftyPositionsDrawer
          positions={store.data.paperPositions()}
          strikes={report()?.strikes}
          onRefresh={() => void store.data.refreshPaperPositions()}
        />
        <Button
          data-testid="nifty-refresh-button"
          size="xs"
          onClick={() => store.data.refresh()}
          disabled={loading() || (mode() === "eod" && !date())}
        >
          Refresh
        </Button>
        <Show when={mode() === "live" && updatedAtMs() !== null}>
          <NiftyUpdatedLabel
            marketClosed={marketClosed()}
            sessionDate={sessionDate()}
            updatedAtMs={updatedAtMs()}
            isStale={isStale()}
          />
        </Show>
        <Show when={mode() === "live"}>
          <NiftyDataFreshness
            report={report()}
            tape={tape()}
            bursts={store.data.effectiveBursts()}
            marketOpen={!marketClosed()}
            sessionDate={sessionDate()}
          />
        </Show>
        <Show when={isStale()}>
          <span data-testid="nifty-stale-badge" style={STALE_BADGE_STYLE}>
            <Text size="xs" fw={700} c="warning" span>
              STALE {staleMins()}m
            </Text>
          </span>
        </Show>
        <Button
          data-testid="nifty-snapshot-button"
          size="xs"
          variant="outline"
          onClick={() => void store.data.snapshot()}
          disabled={snapshotting() || loading() || mode() === "eod" || symbol() !== "NIFTY"}
          title={snapshotTitle()}
        >
          Snapshot
        </Button>
        <NiftyDeskGuide />
      </Box>
      <Show when={replayForBar()}>
        {(current) => (
          <NiftyReplayBar
            replay={current()}
            replayIndex={store.replay.index()}
            playing={store.replay.playing()}
            coverage={store.replay.coverage()}
            reasons={store.replay.reasons()}
            holes={store.replay.holes()}
            onScrub={(next) => store.replay.scrub(next)}
            onTogglePlay={() => store.replay.togglePlay()}
          />
        )}
      </Show>
    </CompactPanel>
  );
}
