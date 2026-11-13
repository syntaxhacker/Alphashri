import { createMemo, createSignal } from "solid-js";
import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";
import { LocalPanelModal } from "./LocalPanelModal";
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

function Field(props: { testId: string; label: string; value: string; title: string }) {
  return (
    <div
      data-testid={props.testId}
      title={props.title}
      class="inline-flex items-baseline gap-[4px] flex-shrink min-w-0"
    >
      <span
        class="text-[9px] tracking-[0.04em]"
        style={{ "color": palette.TEXT_MUTED, "font-size": "9px", "letter-spacing": "0.04em" }}
      >
        {props.label}
      </span>
      <span
        class="text-[10.5px] font-bold tabular-nums whitespace-nowrap"
        style={{
          "color": palette.TEXT,
          "font-size": "10.5px",
          "font-weight": 700,
          "font-variant-numeric": "tabular-nums",
          "white-space": "nowrap",
        }}
      >
        {props.value}
      </span>
    </div>
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
export function NiftyGammaStrip(props: NiftyGammaStripProps) {
  const gex = () => props.gex;
  const spot = () => props.spot;
  const openProp = () => props.open;
  const [internalOpen, setInternalOpen] = createSignal(false);
  const open = () => openProp() ?? internalOpen();
  const setOpen = (next: boolean) => {
    if (openProp() === undefined) setInternalOpen(next);
    props.onOpenChange?.(next);
  };

  const regime = createMemo(() => gexRegimeAtSpot(gex(), spot(), gex()?.regime ?? "flat"));
  const flip = createMemo(() => gexFlipAtSpot(gex(), spot()));
  const sides = createMemo(() => gexSideLevels(gex(), spot()));

  // The rail's levels come from `gexSideLevels` — the same gated, spot-relative
  // derivation the gamma profile shows. Reading the raw backend `levels` block
  // here could promote a near-zero wing to "fuel"/"resistance" that the
  // profile panel had already rejected.
  const fuel = () => (sides().below?.kind === "fuel" ? sides().below : null);
  const resist = () => (sides().above?.kind === "resistance" ? sides().above : null);

  const netTotal = () => finite(gex()?.netTotal);
  // The unit belongs to the value: "Cr" next to a "Cr per point" tooltip read
  // as "Cr Cr/pt".
  const netText = () => {
    const n = netTotal();
    return n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)} Cr/pt`;
  };
  const regimeLabel = () => `${regime().toUpperCase()} Γ`;
  const flipText = () => strikeText(flip());
  const fuelText = () => strikeText(fuel()?.strike);
  const resistText = () => strikeText(resist()?.strike);

  const tone = () =>
    regime() === "long"
      ? palette.POSITIVE
      : regime() === "short"
        ? palette.NEGATIVE
        : palette.TEXT_MUTED;

  const regimeSentence = () =>
    regime() === "long"
      ? "Dealers are LONG gamma — dips get bought and rallies sold, so moves dampen"
      : regime() === "short"
        ? "Dealers are SHORT gamma — hedging chases the move, so breaks accelerate"
        : "Net dealer gamma is near zero — no strong dampening or amplification";
  const title = () => `${regimeSentence()}. Flip ${flipText()}${
    fuel() ? `; fuel below ${fuelText()}` : ""
  }${resist() ? `; resistance ${resistText()}` : ""}. Click for the gamma profile and delta positioning.`;

  const openDrawer = () => setOpen(true);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDrawer();
    }
  };

  return (
    <>
      <div
        data-testid="nifty-gamma-strip"
        data-tone={regime()}
        role="button"
        tabIndex={0}
        aria-label="Open gamma and positioning"
        title={title()}
        onClick={openDrawer}
        onKeyDown={onKeyDown}
        className="flex items-center gap-[6px] h-[24px] min-h-[24px] shrink-0 px-2 cursor-pointer overflow-hidden whitespace-nowrap font-mono tabular-nums"
        style={{
          "display": "flex",
          "align-items": "center",
          "gap": "6px",
          "height": `${STRIP_HEIGHT}px`,
          "min-height": `${STRIP_HEIGHT}px`,
          "flex-shrink": 0,
          "border": `1px solid ${palette.TERM_BORDER}`,
          "border-radius": "4px",
          "background-color": palette.TERM_HEADER,
          "font-family": palette.MONO,
          "font-variant-numeric": "tabular-nums",
        }}
      >
        <span
          title="Net dealer gamma across the book (₹ Cr per point)"
          class="text-[10.5px] font-bold shrink-0"
          style={{ "color": tone(), "font-size": "10.5px", "font-weight": 700, "flex-shrink": 0 }}
        >
          Γ {netText()}
        </span>
        <Sep />
        <span
          title={
            regime() === "long"
              ? "Dealers long gamma — moves dampen"
              : regime() === "short"
                ? "Dealers short gamma — moves amplify"
                : "Gamma regime flat"
          }
          class="text-[10.5px] font-bold shrink-0"
          style={{ "color": tone(), "font-size": "10.5px", "font-weight": 700, "flex-shrink": 0 }}
        >
          {regimeLabel()}
        </span>
        <Sep />
        <Field
          testId="nifty-gamma-flip"
          label="flip"
          value={flipText()}
          title="Gamma flip — strike where cumulative dealer gamma crosses zero"
        />
        <Sep />
        <Field
          testId="nifty-gamma-fuel"
          label="fuel↓"
          value={fuelText()}
          title={
            fuel()
              ? `Below-spot negative gamma at ${fuelText()} — a break accelerates instead of stalling`
              : "No below-spot negative-gamma fuel level"
          }
        />
        <Sep />
        <Field
          testId="nifty-gamma-resist"
          label="resist"
          value={resistText()}
          title={
            resist()
              ? `Above-spot positive gamma at ${resistText()} — a pin magnet that caps rallies`
              : "No above-spot positive-gamma resistance level"
          }
        />
        <span
          aria-hidden
          class="ml-auto text-[10px] shrink-0"
          style={{ "color": palette.TEXT_MUTED, "font-size": "10px", "flex-shrink": 0 }}
        >
          ▸
        </span>
      </div>

      <LocalPanelModal
        open={open()}
        variant="drawer"
        title="Gamma & positioning"
        onClose={() => setOpen(false)}
      >
        <div
          data-testid="nifty-gamma-modal"
          // The drawer is portalled outside the report panel, so the desk's
          // compact-panel skin must be re-scoped here — otherwise both panels
          // render their default full-size headers inside the rail.
          class="flex flex-col gap-2 min-w-0 [&_[data-compact]]:bg-transparent! [&_[data-compact]]:[border:1px_solid_var(--desk-border)]! [&_[data-compact]]:[border-radius:4px]! [&_[data-compact]]:shadow-none! [&_[data-compact-header]]:min-h-[22px]! [&_[data-compact-header]]:[background-color:var(--desk-header)]! [&_[data-compact-header]]:[border-bottom:1px_solid_var(--desk-border)]! [&_[data-compact-header]_:where(h4,p,span,div)]:text-[10px]! [&_[data-compact-header]_:where(h4,p,span,div)]:uppercase! [&_[data-compact-header]_:where(h4,p,span,div)]:tracking-[0.07em]! [&_[data-compact-header]_:where(h4,p,span,div)]:[color:var(--desk-muted)]! [&_[data-compact-header]_:where(h4,p,span,div)]:font-bold! [&_[data-compact-header]_:where(h4,p,span,div)]:leading-[1.2]! [&_[data-compact-stat]]:bg-transparent! [&_[data-compact-stat]]:border-none! [&_[data-compact-stat]]:rounded-none! [&_[data-compact-stat]]:shadow-none! [&_[data-compact-stat]>*]:[padding:0]! [&_[data-compact-stat]>*]:gap-px! [&_[data-compact-stat]>*]:items-start! [&_[data-compact-stat]_:where(div,p,span,h4)]:text-left!"
          style={{
            "--desk-border": palette.TERM_BORDER,
            "--desk-header": palette.TERM_HEADER,
            "--desk-muted": palette.TEXT_MUTED,
          }}
        >
          <NiftyGexProfile gex={gex()} spot={spot()} />
          <NiftyDeltaPositioning positioning={props.positioning} spot={spot()} />
        </div>
      </LocalPanelModal>
    </>
  );
}
