import { useCallback, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import Box from "@mui/material/Box";
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
    <Box
      component="span"
      aria-hidden
      sx={{ color: palette.TEXT_MUTED, opacity: 0.6, flexShrink: 0 }}
    >
      ·
    </Box>
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
      sx={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "4px",
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <Box
        component="span"
        sx={{ color: palette.TEXT_MUTED, fontSize: 9, letterSpacing: "0.04em" }}
      >
        {label}
      </Box>
      <Box
        component="span"
        sx={{
          color: palette.TEXT,
          fontSize: 10.5,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Box>
    </Box>
  );
}

function strikeText(value: number | null | undefined): string {
  const n = finite(value);
  return n === null ? "—" : n.toLocaleString("en-IN");
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
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: STRIP_HEIGHT,
          minHeight: STRIP_HEIGHT,
          flexShrink: 0,
          px: 1,
          border: `1px solid ${palette.TERM_BORDER}`,
          borderRadius: "4px",
          bgcolor: palette.TERM_HEADER,
          cursor: "pointer",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontFamily: palette.MONO,
          fontVariantNumeric: "tabular-nums",
          "&:hover": { borderColor: palette.TEXT_MUTED },
          "&:focus-visible": { outline: `1px solid ${palette.POSITIVE}`, outlineOffset: 0 },
        }}
      >
        <Box
          component="span"
          title="Net dealer gamma across the book (₹ Cr per point)"
          sx={{ color: tone, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}
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
          sx={{ color: tone, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}
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
          sx={{ marginLeft: "auto", color: palette.TEXT_MUTED, fontSize: 10, flexShrink: 0 }}
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
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1,
            minWidth: 0,
            // The drawer is portalled outside the report panel, so the desk's
            // compact-panel skin must be re-scoped here — otherwise both
            // panels render their default full-size headers inside the rail.
            "& [data-compact]": {
              bgcolor: "transparent",
              border: `1px solid ${palette.TERM_BORDER} !important`,
              borderRadius: "4px !important",
              boxShadow: "none",
            },
            "& [data-compact-header]": {
              minHeight: "22px",
              bgcolor: palette.TERM_HEADER,
              borderBottom: `1px solid ${palette.TERM_BORDER} !important`,
            },
            "& [data-compact-header] .MuiTypography-root": {
              fontSize: "10px !important",
              textTransform: "uppercase",
              letterSpacing: "0.07em",
              color: `${palette.TEXT_MUTED} !important`,
              fontWeight: 700,
              lineHeight: 1.2,
            },
            "& [data-compact-stat]": {
              bgcolor: "transparent !important",
              border: "none !important",
              borderRadius: "0 !important",
              boxShadow: "none !important",
            },
            "& [data-compact-stat] .MuiCardContent-root": {
              p: "0 !important",
              gap: "1px !important",
              alignItems: "flex-start !important",
              textAlign: "left !important",
            },
            "& [data-compact-stat] .MuiTypography-root": { textAlign: "left !important" },
          }}
        >
          <NiftyGexProfile gex={gex} spot={spot} />
          <NiftyDeltaPositioning positioning={positioning} spot={spot} />
        </Box>
      </PanelModal>
    </>
  );
}
