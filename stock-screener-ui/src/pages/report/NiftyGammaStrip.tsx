import { formatNumberIN } from "@/utils/ui-helpers";
import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent, CSSProperties } from "react";
import { Box } from "@/ui";
import * as palette from "@/ui/palette";
import { PanelModal } from "@/components/common/PanelModal";
import {
  NiftyGexProfile,
  gexFlipAtSpot,
  gexRegimeAtSpot,
  gexSideLevels,
} from "./NiftyGexProfile";
import { NiftyDeltaPositioning } from "./NiftyDeltaPositioning";
import type { NiftyGex, NiftyPositioningBlock } from "@/types/niftyReport";

interface NiftyGammaStripProps {
  /** The report's dealer-gamma profile. Absent renders dashes. */
  gex?: NiftyGex;
  /** Chain delta positioning shown beneath the profile in the drawer. */
  positioning?: NiftyPositioningBlock;
  spot: number;
  /** Drawer open state, controlled (tests/storybook); defaults to internal. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Same 24px rail as the INTEL strip directly above it. */
const STRIP_HEIGHT = 24;

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function Sep() {
  return (
    <span
      aria-hidden
      className="text-[10px] opacity-60 shrink-0"
      style={{ color: palette.TEXT_MUTED }}
    >
      ·
    </span>
  );
}

function Field({
  testId,
  label,
  value,
  title,
}: {
  testId: string;
  label: string;
  value: string;
  title: string;
}) {
  return (
    <Box
      data-testid={testId}
      title={title}
      className="inline-flex items-baseline gap-[4px] flex-shrink-1 min-w-0"
    >
      <Box
        component="span"
        className="text-[9px] tracking-[0.04em]"
        style={{ color: palette.TEXT_MUTED, "font-size": 9, "letter-spacing": "0.04em" }}
      >
        {label}
      </Box>
      <Box
        component="span"
        className="text-[10.5px] font-bold tabular-nums whitespace-nowrap"
        style={{
          color: palette.TEXT,
          "font-size": 10.5,
          "font-weight": 700,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function strikeText(value: number | null | undefined): string {
  const n = finite(value);
  return n === null ? "—" : formatNumberIN(n);
}

/**
 * 24px dealer-gamma strip under INTEL (DESK + RESEARCH):
 * `Γ {net} Cr/pt · {LONG|SHORT} Γ · flip {cross} · fuel↓ {strike} · resist {strike}`.
 *
 * The tone carries the regime — long gamma (dealers dampen moves) is positive,
 * short gamma (hedging amplifies moves) is negative. Click / Enter opens the
 * shared `PanelModal` as a right-side drawer holding the full price × gamma
 * profile and the delta-positioning panel, both driven by the same live report.
 */
export function NiftyGammaStrip({
  gex,
  positioning,
  spot,
  open: openProp,
  onOpenChange,
}: NiftyGammaStripProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );

  const regime = useMemo(
    () => gexRegimeAtSpot(gex, spot, gex?.regime ?? "flat"),
    [gex, spot],
  );
  const flip = useMemo(() => gexFlipAtSpot(gex, spot), [gex, spot]);
  const sides = useMemo(() => gexSideLevels(gex, spot), [gex, spot]);

  // The rail's levels come from `gexSideLevels` — the same gated, spot-relative
  // derivation the gamma profile shows. Reading the raw backend `levels` block
  // here could promote a near-zero wing to "fuel"/"resistance" that the
  // profile panel had already rejected.
  const fuel = sides.below?.kind === "fuel" ? sides.below : null;
  const resist = sides.above?.kind === "resistance" ? sides.above : null;

  const netTotal = finite(gex?.netTotal);
  // The unit belongs to the value: "Cr" next to a "Cr per point" tooltip read
  // as "Cr Cr/pt".
  const netText =
    netTotal === null
      ? "—"
      : `${netTotal >= 0 ? "+" : ""}${netTotal.toFixed(2)} Cr/pt`;
  const regimeLabel = `${regime.toUpperCase()} Γ`;
  const flipText = strikeText(flip);
  const fuelText = strikeText(fuel?.strike);
  const resistText = strikeText(resist?.strike);

  const tone =
    regime === "long"
      ? palette.POSITIVE
      : regime === "short"
        ? palette.NEGATIVE
        : palette.TEXT_MUTED;

  const regimeSentence =
    regime === "long"
      ? "Dealers are LONG gamma — dips get bought and rallies sold, so moves dampen"
      : regime === "short"
        ? "Dealers are SHORT gamma — hedging chases the move, so breaks accelerate"
        : "Net dealer gamma is near zero — no strong dampening or amplification";
  const title = `${regimeSentence}. Flip ${flipText}${
    fuel ? `; fuel below ${fuelText}` : ""
  }${resist ? `; resistance ${resistText}` : ""}. Click for the gamma profile and delta positioning.`;

  const openDrawer = useCallback(() => setOpen(true), [setOpen]);
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDrawer();
      }
    },
    [openDrawer],
  );

  return (
    <>
      <Box
        data-testid="nifty-gamma-strip"
        data-tone={regime}
        role="button"
        tabIndex={0}
        aria-label="Open gamma and positioning"
        title={title}
        onClick={openDrawer}
        onKeyDown={onKeyDown}
        className="flex items-center gap-[6px] h-[24px] min-h-[24px] shrink-0 px-2 cursor-pointer overflow-hidden whitespace-nowrap font-mono tabular-nums"
        style={{
          display: "flex",
          "align-items": "center",
          gap: 6,
          height: STRIP_HEIGHT,
          "min-height": STRIP_HEIGHT,
          "flex-shrink": 0,
          px: 8,
          border: `1px solid ${palette.TERM_BORDER}`,
          "border-radius": 4,
          "background-color": palette.TERM_HEADER,
          "font-family": palette.MONO,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        <Box
          component="span"
          title="Net dealer gamma across the book (₹ Cr per point)"
          className="text-[10.5px] font-bold shrink-0"
          style={{ color: tone, "font-size": 10.5, "font-weight": 700, "flex-shrink": 0 }}
        >
          Γ {netText}
        </Box>
        <Sep />
        <Box
          component="span"
          title={
            regime === "long"
              ? "Dealers long gamma — moves dampen"
              : regime === "short"
                ? "Dealers short gamma — moves amplify"
                : "Gamma regime flat"
          }
          className="text-[10.5px] font-bold shrink-0"
          style={{ color: tone, "font-size": 10.5, "font-weight": 700, "flex-shrink": 0 }}
        >
          {regimeLabel}
        </Box>
        <Sep />
        <Field
          testId="nifty-gamma-flip"
          label="flip"
          value={flipText}
          title="Gamma flip — strike where cumulative dealer gamma crosses zero"
        />
        <Sep />
        <Field
          testId="nifty-gamma-fuel"
          label="fuel↓"
          value={fuelText}
          title={
            fuel
              ? `Below-spot negative gamma at ${fuelText} — a break accelerates instead of stalling`
              : "No below-spot negative-gamma fuel level"
          }
        />
        <Sep />
        <Field
          testId="nifty-gamma-resist"
          label="resist"
          value={resistText}
          title={
            resist
              ? `Above-spot positive gamma at ${resistText} — a pin magnet that caps rallies`
              : "No above-spot positive-gamma resistance level"
          }
        />
        <Box
          component="span"
          aria-hidden
          className="ml-auto text-[10px] shrink-0"
          style={{ color: palette.TEXT_MUTED, "font-size": 10, "flex-shrink": 0 }}
        >
          ▸
        </Box>
      </Box>

      <PanelModal
        open={open}
        variant="drawer"
        title="Gamma & positioning"
        onClose={() => setOpen(false)}
      >
        <Box
          data-testid="nifty-gamma-modal"
          // The drawer is portalled outside the report panel, so the desk's
          // compact-panel skin must be re-scoped here — otherwise both panels
          // render their default full-size headers inside the rail.
          className="flex flex-col gap-2 min-w-0 [&_[data-compact]]:bg-transparent! [&_[data-compact]]:[border:1px_solid_var(--desk-border)]! [&_[data-compact]]:[border-radius:4px]! [&_[data-compact]]:shadow-none! [&_[data-compact-header]]:min-h-[22px]! [&_[data-compact-header]]:[background-color:var(--desk-header)]! [&_[data-compact-header]]:[border-bottom:1px_solid_var(--desk-border)]! [&_[data-compact-header]_:where(h4,p,span,div)]:text-[10px]! [&_[data-compact-header]_:where(h4,p,span,div)]:uppercase! [&_[data-compact-header]_:where(h4,p,span,div)]:tracking-[0.07em]! [&_[data-compact-header]_:where(h4,p,span,div)]:[color:var(--desk-muted)]! [&_[data-compact-header]_:where(h4,p,span,div)]:font-bold! [&_[data-compact-header]_:where(h4,p,span,div)]:leading-[1.2]! [&_[data-compact-stat]]:bg-transparent! [&_[data-compact-stat]]:border-none! [&_[data-compact-stat]]:rounded-none! [&_[data-compact-stat]]:shadow-none! [&_[data-compact-stat]>*]:[padding:0]! [&_[data-compact-stat]>*]:gap-px! [&_[data-compact-stat]>*]:items-start! [&_[data-compact-stat]_:where(div,p,span,h4)]:text-left!"
          style={{
            "--desk-border": palette.TERM_BORDER,
            "--desk-header": palette.TERM_HEADER,
            "--desk-muted": palette.TEXT_MUTED,
          } as CSSProperties}
        >
          <NiftyGexProfile gex={gex} spot={spot} />
          <NiftyDeltaPositioning positioning={positioning} spot={spot} />
        </Box>
      </PanelModal>
    </>
  );
}
