import { Show, Suspense, lazy } from "solid-js";
import type { JSX } from "solid-js";
import { alpha, Box, Button, SegmentedControl, Select, Text, TextInput } from "@/ui";
import * as palette from "@/ui/palette";
import { IconChevronRight } from "@/ui/icons";
import { CompactPanel } from "@/components/common/compact";
import { NiftyDataFreshness } from "./NiftyDataFreshness";
import { NiftyDeskGuide } from "./NiftyDeskGuide";
import { NiftyPositionsDrawer } from "./NiftyPositionsDrawer";
import { NiftyReplayBar } from "./NiftyReplayBar";
import { NiftyUpdatedLabel } from "./NiftyUpdatedLabel";
import { wsBadgeLabel } from "./niftyFreshness";
import { REPORT_FONT } from "./reportTokens";
import { useNiftyReport } from "./ReportContext";

const SimDesk = lazy(() =>
  import("./sim/SimDesk").then((m) => ({ default: m.SimDesk })),
);

const SIM_BUTTON_FALLBACK_STYLE: JSX.CSSProperties = {
  width: "64px",
  height: "22px",
  "background-color": palette.SURFACE_ALT,
  "border-radius": "2px",
};

const INDEX_DATA: { value: string; label: string }[] = [
  { value: "NIFTY", label: "NIFTY" },
  { value: "SENSEX", label: "SENSEX" },
  { value: "RELIANCE", label: "RELIANCE" },
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

// A native <select> clips "Nearest expiry" to "Nearest expi" inside the 104px
// chevron-guttered field. Show a whole word instead and carry the full label in
// the wrapper title and the control's accessible name; widening the field would
// push Snapshot off the 1600 toolbar (it already has ~16px of slack).
const EXPIRY_NEAREST_SHORT_LABEL = "Nearest";

export function expiryOptionLabel(option: { value: string; label: string }): string {
  return option.value === "nearest" ? EXPIRY_NEAREST_SHORT_LABEL : option.label;
}

export function expiryControlTitle(fullLabel: string): string {
  return `Selected expiry: ${fullLabel}`;
}

/**
 * Two deliberate bands below 1200, one dense band at/above it.
 *
 * The old toolbar had four ad-hoc flex rows at 390 and clipped "Depth" plus the
 * whole DESK toggle at the panel edge. The primary band is now a single row:
 * its selector strip scrolls behind a visible chevron/fade cue, so every tab is
 * reachable and no label is ever squeezed through a native-select gutter. The
 * secondary band is the labelled DATA/freshness readouts. At 1600 both bands
 * are inline (`w-auto`), so there is still exactly one row and no control is
 * rendered twice.
 */
export const TOOLBAR_CLASS =
  "flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 min-h-[30px] w-full max-w-full min-w-0 shrink-0 [&_[data-testid='nifty-updated-at']]:leading-[20px] min-[1200px]:flex-nowrap min-[1200px]:overflow-x-auto";

export const TOOLBAR_PRIMARY_CLASS =
  "flex flex-nowrap items-center gap-2 w-full min-w-0 min-[1200px]:w-auto min-[1200px]:flex-1";

export const TOOLBAR_SECONDARY_CLASS =
  "flex flex-nowrap items-center gap-2 w-full min-w-0 min-[1200px]:w-auto min-[1200px]:ml-auto";

// The strip is the only scroll owner. Children are flex-none so a squeezed
// control can never shrink its own text (the SegmentedControl track uses
// overflow-hidden, which is what produced the "Depth" clip). Mandatory snap on
// each toggle means a scroll always lands on a whole tab — "RELIANCE" is never
// left half-shown at the strip edge at 390.
export const TOOLBAR_STRIP_CLASS =
  "flex flex-nowrap items-center gap-2 min-w-0 w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory min-[1200px]:w-auto min-[1200px]:overflow-visible min-[1200px]:snap-none";

export const TOOLBAR_GROUP_CLASS = "flex items-center gap-2 flex-none";

/** Fade width at the phone breakpoint — wide enough to cover a partial glyph. */
export const TOOLBAR_FADE_CLASS = "w-10";

export const TOOLBAR_ACTIONS_CLASS =
  "flex flex-wrap items-center gap-2 flex-none max-w-full min-w-0 min-[1200px]:flex-nowrap";

// Hairline is decorative (WCAG's non-text exemption); the 18px height keeps
// the divider inside the toolbar without stretching it.
export const TOOLBAR_DIVIDER_CLASS = "w-px h-[18px] flex-none bg-fin-border";

// 14 / 13 / 12: toggles carry the primary label step, selects and actions the
// body step, group captions and status the micro step. The `!` beats the
// SegmentedControl's inline 12px, just as the old shared label class did.
const TOGGLE_LABEL_CLASS = "[&>button]:[font-size:var(--text-ui-label)]! shrink-0 snap-start";
const BODY_LABEL_CLASS = "text-ui-body!";

const STRIP_STYLE: JSX.CSSProperties = {
  "scrollbar-width": "none",
};

// The last third is fully opaque: a tab that would be cut mid-word ("RELIA")
// is masked instead, so only whole labels are ever visible.
export const STRIP_FADE_STYLE: JSX.CSSProperties = {
  background: `linear-gradient(90deg, ${alpha(palette.SURFACE, 0)} 0%, ${alpha(palette.SURFACE, 1)} 62%, ${palette.SURFACE} 100%)`,
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

  let strip: HTMLDivElement | undefined;
  const setStrip = (el: HTMLDivElement) => {
    strip = el;
  };
  const scrollStrip = () => {
    if (!strip) return;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: strip.scrollLeft >= max - 4 ? 0 : max, behavior: "smooth" });
  };

  const symbol = () => store.selection.symbol();
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

  const selectedExpiryLabel = () =>
    store.selection.expiryData().find((option) => option.value === expiry())?.label ?? expiry();

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
        {/* Primary band — one row at 390; its strip scrolls instead of clipping. */}
        <Box
          data-testid="toolbar-primary-row"
          className={TOOLBAR_PRIMARY_CLASS}
          role="group"
          aria-label="Report controls"
        >
          <Box className="relative flex min-w-0 flex-1 items-center">
            <Box
              data-testid="toolbar-strip"
              ref={setStrip}
              className={TOOLBAR_STRIP_CLASS}
              style={STRIP_STYLE}
            >
              {/* What am I looking at — subject, session type, view, desk. */}
              <Box
                data-testid="toolbar-group-subject"
                className={TOOLBAR_GROUP_CLASS}
                role="group"
                aria-label="Underlying, session and view"
              >
                <SegmentedControl
                  data-testid="nifty-index-toggle"
                  value={symbol()}
                  onChange={(value) => store.selection.handleSymbolChange(value)}
                  data={INDEX_DATA}
                  size="xs"
                  className={TOGGLE_LABEL_CLASS}
                />
                <Show when={store.selection.hasRecordedHistory()}>
                  <SegmentedControl
                    data-testid="nifty-mode-toggle"
                    value={mode()}
                    onChange={(value) => store.selection.handleModeChange(value)}
                    data={MODE_TOGGLE_DATA}
                    size="xs"
                    className={TOGGLE_LABEL_CLASS}
                  />
                </Show>
                <SegmentedControl
                  data-testid="nifty-view-toggle"
                  value={view()}
                  onChange={(value) => store.ui.handleViewChange(value)}
                  data={VIEW_TOGGLE_DATA}
                  size="xs"
                  className={TOGGLE_LABEL_CLASS}
                />
                <SegmentedControl
                  data-testid="nifty-desk-toggle"
                  value={deskMode()}
                  onChange={(value) => store.ui.handleDeskChange(value)}
                  data={DESK_TOGGLE_DATA}
                  size="xs"
                  className={TOGGLE_LABEL_CLASS}
                />
              </Box>
              <Box
                data-testid="toolbar-divider-subject-session"
                className={TOOLBAR_DIVIDER_CLASS}
                aria-hidden="true"
              />
              {/* Which session — contract expiry and the EOD history date. */}
              <Box
                data-testid="toolbar-group-session"
                className={TOOLBAR_GROUP_CLASS}
                role="group"
                aria-label="Expiry and history date"
              >
                <Box title={expiryControlTitle(selectedExpiryLabel())} className="flex-none">
                  <Select
                    data-testid="nifty-expiry-select"
                    value={expiry()}
                    onChange={(value) => store.selection.handleExpiryChange(value)}
                    data={store.selection
                      .expiryData()
                      .map((option) => ({ ...option, label: expiryOptionLabel(option) }))}
                    size="xs"
                    w={104}
                    h={22}
                    className={`${EXPIRY_SELECT_CLASS} ${BODY_LABEL_CLASS}`}
                    aria-label={expiryControlTitle(selectedExpiryLabel())}
                  />
                </Box>
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
                    style={{
                      "font-size": `${REPORT_FONT.micro}px`,
                      "font-weight": 700,
                      "letter-spacing": "0.04em",
                      color: palette.TEXT_MUTED,
                      border: `1px solid ${palette.TERM_BORDER}`,
                      "border-radius": "3px",
                      "padding-left": "4px",
                      "padding-right": "4px",
                      "white-space": "nowrap",
                    }}
                  >
                    history = nearest expiry
                  </span>
                </Show>
              </Box>
              <Box
                data-testid="toolbar-divider-session-state"
                className={TOOLBAR_DIVIDER_CLASS}
                aria-hidden="true"
              />
              {/* Sim state — the desk and the paper book are separate from the view. */}
              <Box
                data-testid="toolbar-group-state"
                className={TOOLBAR_GROUP_CLASS}
                role="group"
                aria-label="Simulation desk and paper book"
              >
                <Text size="xs" fw={700} c="dimmed" span className="tracking-[0.04em] whitespace-nowrap" title="Simulation desk and paper book">
                  STATE
                </Text>
                <Suspense fallback={<Box style={SIM_BUTTON_FALLBACK_STYLE} />}>
                  <SimDesk
                    symbol={symbol()}
                    mode={mode()}
                    date={date()}
                    report={report()}
                    replay={replay()}
                    replayIndex={store.replay.index()}
                  />
                </Suspense>
                <NiftyPositionsDrawer
                  positions={store.data.paperPositions()}
                  strikes={report()?.strikes}
                  onRefresh={() => void store.data.refreshPaperPositions()}
                />
              </Box>
            </Box>
            <Box
              data-testid="toolbar-strip-fade"
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-0 right-0 ${TOOLBAR_FADE_CLASS} min-[1200px]:hidden`}
              style={STRIP_FADE_STYLE}
            />
          </Box>
          <button
            type="button"
            data-testid="toolbar-scroll-cue"
            aria-label="Scroll report controls"
            title="Scroll to more report controls"
            onClick={scrollStrip}
            className="inline-flex h-6 w-5 flex-none items-center justify-center rounded-fin border border-fin-border text-fin-text-muted min-[1200px]:hidden"
          >
            <IconChevronRight size={14} />
          </button>
          <Box
            data-testid="toolbar-group-actions"
            className={TOOLBAR_ACTIONS_CLASS}
            role="group"
            aria-label="Report actions"
          >
            <Button
              data-testid="nifty-refresh-button"
              size="xs"
              className={BODY_LABEL_CLASS}
              onClick={() => store.data.refresh()}
              disabled={loading() || (mode() === "eod" && !date())}
            >
              Refresh
            </Button>
            <Button
              data-testid="nifty-snapshot-button"
              size="xs"
              variant="outline"
              className={BODY_LABEL_CLASS}
              onClick={() => void store.data.snapshot()}
              disabled={snapshotting() || loading() || mode() === "eod" || symbol() !== "NIFTY"}
              title={snapshotTitle()}
            >
              Snapshot
            </Button>
            <NiftyDeskGuide />
          </Box>
        </Box>

        {/* Secondary band — the labelled data/freshness readouts. It is a
            compact second row only below 1200; one dense row at 1600. */}
        <Box
          data-testid="toolbar-secondary-row"
          className={TOOLBAR_SECONDARY_CLASS}
          role="group"
          aria-label="Data and freshness"
        >
          <Text data-testid="toolbar-data-label" size="xs" fw={700} c="dimmed" span className="tracking-[0.04em] whitespace-nowrap">
            DATA
          </Text>
          <Box data-testid="toolbar-status-divider" className={TOOLBAR_DIVIDER_CLASS} aria-hidden="true" />
          <Box
            data-testid="toolbar-group-status"
            className={TOOLBAR_ACTIONS_CLASS}
            role="group"
            aria-label="Actions and data freshness"
          >
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
              <span
                data-testid="nifty-stale-badge"
                style={STALE_BADGE_STYLE}
                title="WebSocket feed disconnected — data age is reported separately by the DATA badge"
              >
                <Text size="xs" fw={700} c="warning" span>
                  {wsBadgeLabel(staleMins())}
                </Text>
              </span>
            </Show>
          </Box>
        </Box>
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
