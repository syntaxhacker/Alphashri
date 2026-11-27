import { createSignal, For, Show } from "solid-js";
import * as palette from "@/ui/palette";
import { LocalPanelModal } from "./LocalPanelModal";
import { REPORT_FONT, REPORT_LINE_HEIGHT, REPORT_PAD } from "./reportTokens";

export const DESK_GUIDE_HINT_STORAGE_KEY = "alphashri:desk-guide-hint-dismissed";

const IconHelpCircle = (props: { size?: number }) => (
  <svg
    width={props.size ?? 14}
    height={props.size ?? 14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

interface DeskGuideEntry {
  term: string;
  text: string;
}

export const DESK_GUIDE_ENTRIES: readonly DeskGuideEntry[] = [
  {
    term: "COIL / NORMAL / EXPANDING",
    text: "Today's high-low range vs the ~25-day baseline (236 pts). COIL ≤70% = compression — wait or sell the range; the breakout is the trade. NORMAL 70–125%. EXPANDING ≥125% = trend — follow it, don't fade.",
  },
  {
    term: "HEATMAP",
    text: "Red = CE OI build (call writers, a cap). Green = PE OI build (put buyers/hedges). Opacity = |ΔOI|. White line = spot. Amber dashed = max pain. Blue dashed = gamma flip. ● = max-pain touch.",
  },
  {
    term: "GAMMA (Γ)",
    text: "Net dealer gamma. LONG Γ = dealers dampen moves (fade works). SHORT Γ = dealers amplify (breakouts/squeezes). Flip = zero-gamma level. Fuel↓ = downside acceleration. Resistance = the pin above.",
  },
  {
    term: "MAX PAIN",
    text: "The expiry settlement that hurts option buyers most; a magnet into expiry.",
  },
  {
    term: "PIN RISK",
    text: "Pin = spot parked on a heavy OI wall with max pain ≥100 pts on the far side. Into expiry, breaks from that spot usually sweep and revert — don't buy the break unless two consecutive 1-min closes land beyond the wall.",
  },
  {
    term: "PCR",
    text: "Put/call OI. <1 = call-heavy (writers). >1 = put-heavy.",
  },
  {
    term: "SB / LB",
    text: "Short Buildup (price down, OI up = writers) / Long Buildup (price up, OI up = buyers).",
  },
  {
    term: "FLOW STRIP",
    text: "Green = bullish (put unwind). Red = bearish (call build). Amber = structural (wall / max pain / ATM).",
  },
  {
    term: "CAS",
    text: "15:15–15:30, the index print freezes. The official close is the auction — be flat by 15:10.",
  },
  {
    term: "COSTS",
    text: "~₹81 round trip per lot; a target must clear it.",
  },
  {
    term: "CE / PE",
    text: "CE = a call, the right to buy; PE = a put, the right to sell. The desk labels the two sides of the chain and the OI walls by side: CE calls, PE puts.",
  },
  {
    term: "OI / ΔOI",
    text: "Open interest is the number of contracts still open; ΔOI is how that count changes over the window shown. OI up = new positions, OI down = positions being closed.",
  },
  {
    term: "RV vs IV",
    text: "Realised volatility (RV) is how much the index actually moved; implied volatility (IV) is how much the option market expects it to move. IV above RV means options are priced for a bigger move.",
  },
  {
    term: "RSI",
    text: "Relative Strength Index, a 0–100 momentum gauge built from recent closes. Above 70 = overbought, below 30 = oversold; a warning, not a signal on its own.",
  },
] as const;

interface NiftyDeskGuideProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function hintDismissedInStorage(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(DESK_GUIDE_HINT_STORAGE_KEY) === "1"
    );
  } catch {
    // Storage can be blocked in private browsing; the hint still dismisses for the session.
    return false;
  }
}

export function NiftyDeskGuide(props: NiftyDeskGuideProps) {
  const openProp = () => props.open;
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [hintDismissed, setHintDismissed] = createSignal(hintDismissedInStorage());
  const open = () => openProp() ?? internalOpen();
  const setOpen = (next: boolean) => {
    if (openProp() === undefined) setInternalOpen(next);
    props.onOpenChange?.(next);
  };
  const dismissHint = () => {
    try {
      window.localStorage.setItem(DESK_GUIDE_HINT_STORAGE_KEY, "1");
    } catch {
      // Private browsing can reject writes; in-memory dismissal still holds.
    }
    setHintDismissed(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="nifty-help-button"
        aria-label="Desk guide"
        title="Desk guide"
        onClick={() => setOpen(true)}
        class="inline-flex items-center justify-center gap-1 rounded-fin p-1 bg-fin-surface-alt text-fin-text hover:bg-fin-surface text-xs transition-colors duration-150"
      >
        <IconHelpCircle size={14} />
      </button>

      <LocalPanelModal
        open={open()}
        title="Desk guide — read this once"
        onClose={() => setOpen(false)}
        autoHeight
        maxWidth={1040}
      >
        <Show when={!hintDismissed()}>
          <div
            data-testid="nifty-guide-first-run-hint"
            class="mb-1 flex flex-wrap items-center gap-2"
            style={{
              "background-color": palette.SURFACE_ALT,
              "border-left": `2px solid ${palette.INFO}`,
              padding: `${REPORT_PAD.md}px ${REPORT_PAD.lg}px`,
              color: palette.TEXT,
              "font-size": `${REPORT_FONT.micro}px`,
              "line-height": REPORT_LINE_HEIGHT.relaxed,
            }}
          >
            <span class="min-w-0 flex-1">
              First time here? CE / PE, OI / ΔOI, RV vs IV and RSI are the four
              labels below that are easiest to misread. The rest of the grid is
              a lookup — you don't need to read it all now.
            </span>
            <button
              type="button"
              data-testid="nifty-guide-first-run-hint-dismiss"
              aria-label="Dismiss first-run hint"
              onClick={dismissHint}
              class="rounded-fin text-ui-micro text-fin-text"
              style={{
                padding: `${REPORT_PAD.xs}px ${REPORT_PAD.md}px`,
                "background-color": palette.SURFACE,
                border: `1px solid ${palette.BORDER}`,
              }}
            >
              Got it
            </button>
          </div>
        </Show>
        <div
          data-testid="nifty-help-modal"
          class="min-w-0 grid gap-2 tabular-nums grid-cols-[minmax(0,1fr)] min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]"
          // Column rules sit inside the 3-col grid; the xs layout keeps only
          // row rules so a single column never shows a stray left border.
          style={{ "--term-border": palette.TERM_BORDER }}
        >
          <For each={DESK_GUIDE_ENTRIES}>
            {(entry, i) => (
            <div
              data-testid={`nifty-help-entry-${entry.term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
              class={`min-w-0 ${i() % 3 !== 0 ? "min-[900px]:border-l min-[900px]:border-l-[var(--term-border)] min-[900px]:pl-2" : ""}`}
              style={{
                "padding-top": "8px",
                "border-top": `1px solid ${palette.TERM_BORDER}`,
              }}
            >
              <div
                style={{
                  "font-size": `${REPORT_FONT.micro}px`,
                  "font-weight": 700,
                  "line-height": 1.2,
                  "letter-spacing": "0.08em",
                  "text-transform": "uppercase",
                  "color": palette.TEXT_MUTED,
                  "margin-bottom": "3px",
                }}
              >
                {entry.term}
              </div>
              <div style={{ "font-size": `${REPORT_FONT.micro}px`, "line-height": 1.35, "color": palette.TEXT }}>
                {entry.text}
              </div>
            </div>
            )}
          </For>
        </div>
      </LocalPanelModal>
    </>
  );
}
