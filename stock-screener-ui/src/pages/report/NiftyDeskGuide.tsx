import { useCallback, useState, type CSSProperties } from "react";
import { Box } from "@/ui";
import { IconHelpCircle } from "@tabler/icons-react";
import { Button } from "@/ui";
import * as palette from "@/ui/palette";
import { PanelModal } from "@/components/common/PanelModal";

/**
 * One-page desk glossary. Ten terms, three columns, no nested cards — the
 * reader scans once and never needs the legend again.
 */
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
] as const;

interface NiftyDeskGuideProps {
  /** Controlled open state (tests/hotkeys); defaults to internal. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Toolbar `?` button + the "read this once" desk glossary modal.
 * Lives beside Refresh/Snapshot so the legend is one click from the surface
 * it explains; the modal reuses `PanelModal` (Esc + focus trap for free).
 */
export function NiftyDeskGuide({ open: openProp, onOpenChange }: NiftyDeskGuideProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  return (
    <>
      <Button
        data-testid="nifty-help-button"
        size="xs"
        variant="subtle"
        aria-label="Desk guide"
        title="Desk guide"
        onClick={() => setOpen(true)}
        style={{ "min-width": 0, "padding-left": "4px", "padding-right": "4px" }}
      >
        <IconHelpCircle size={14} />
      </Button>

      <PanelModal
        open={open}
        title="Desk guide — read this once"
        onClose={() => setOpen(false)}
        autoHeight
        max-width={1040}
      >
        <Box
          data-testid="nifty-help-modal"
          className="min-w-0 grid gap-2 tabular-nums grid-cols-[minmax(0,1fr)] min-[900px]:grid-cols-[repeat(3,minmax(0,1fr))]"
          // Column rules sit inside the 3-col grid; the xs layout keeps only
          // row rules so a single column never shows a stray left border.
          style={{ "--term-border": palette.TERM_BORDER } as CSSProperties}
        >
          {DESK_GUIDE_ENTRIES.map((entry, i) => (
            <Box
              key={entry.term}
              data-testid={`nifty-help-entry-${entry.term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
              className={`min-w-0 ${i % 3 !== 0 ? "min-[900px]:border-l min-[900px]:border-l-[var(--term-border)] min-[900px]:pl-2" : ""}`}
              style={{
                "padding-top": "8px",
                "border-top": `1px solid ${palette.TERM_BORDER}`,
              }}
            >
              <div
                style={{
                  "font-size": "10px",
                  "font-weight": 700,
                  "line-height": 1.2,
                  "letter-spacing": "0.08em",
                  "text-transform": "uppercase",
                  color: palette.TEXT_MUTED,
                  "margin-bottom": "3px",
                }}
              >
                {entry.term}
              </div>
              <div style={{ "font-size": "11px", "line-height": 1.35, color: palette.TEXT }}>
                {entry.text}
              </div>
            </Box>
          ))}
        </Box>
      </PanelModal>
    </>
  );
}
