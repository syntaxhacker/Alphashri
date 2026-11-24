import { Show, createEffect, createSignal, createUniqueId, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Box, Button, Text } from "@/ui";
import * as palette from "@/ui/palette";
import {
  REPORT_FONT,
  REPORT_GUTTER,
  REPORT_HERO_POPOVER,
  REPORT_HERO_STATS_GRID_CLASS,
  REPORT_KPI_HERO_HEIGHT,
  REPORT_RADIUS,
} from "./reportTokens";
import { ReportKpiHero, type KpiTokenKey } from "./ReportKpiHero";
import { DecisionStats } from "./ReportDecisionStrip.groups";
import { VerdictContent } from "./ReportDecisionStrip.moreStats";
import type { DecisionView } from "./ReportDecisionStrip.derive";
import {
  DECISION_REASON_STYLE,
  DECISION_STATUS_STYLE,
  GROUP_LABEL_STYLE,
  HERO_CLAIM_STYLE,
  PLAN_ONELINER_STYLE,
  PLAN_CONFIDENCE_STYLE,
} from "./ReportDecisionStrip.format";

// Kept at the hero's stable import path for the context rail.
export { TapeBadgeControl } from "./ReportDecisionStrip.moreStats";

/** The claim slot holds a real directional call and nothing else. When the
 *  read has no call it stays empty — the single status token and its reason are
 *  rendered once by the hero, so repeating "awaiting trigger" here is a bug. */
export function HeroClaim(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  return (
    <Box
      data-testid="nifty-plan-oneliner"
      className="flex flex-row flex-wrap items-center gap-x-2 min-w-0"
      style={view.decision().claim ? PLAN_ONELINER_STYLE : {}}
    >
      <Box
        data-testid="nifty-plan-headline"
        data-decision-kind={view.decision().kind}
        title={`${view.decision().stateLabel} — ${view.decision().claim}`}
        className="min-w-0"
        style={{ ...HERO_CLAIM_STYLE, color: view.claimTone() }}
      >
        {view.decision().claim}
      </Box>
      <Box
        data-testid="nifty-plan-confidence"
        data-confidence-computed={view.planConfidence().computed ? "true" : "false"}
        title={
          view.planConfidence().computed
            ? "Weighted confidence behind the active side"
            : "No directional call, so there is no confidence to compute"
        }
        className="shrink-0"
        style={PLAN_CONFIDENCE_STYLE}
      >
        {view.planConfidence().text}
      </Box>
    </Box>
  );
}

/** The research rail reuses the read without duplicating the hero's testids. */
export function RailClaim(props: { view: DecisionView }): JSX.Element {
  return (
    <Box className="flex items-center gap-1 min-w-0">
      <span
        className="min-w-0"
        style={{ ...HERO_CLAIM_STYLE, color: props.view.claimTone() }}
      >
        {props.view.decision().claim}
      </span>
    </Box>
  );
}

function ReasonsButton(props: { view: DecisionView }): JSX.Element {
  return (
    <Button
      data-testid="nifty-plan-reasons-button"
      size="xs"
      variant="subtle"
      aria-label="Open the full two-sided desk plan"
      title="Open the full two-sided desk plan (E)"
      onClick={props.view.store.ui.openPlanReasons}
    >
      ▸
    </Button>
  );
}

const POPUP_CAPTION_STYLE: JSX.CSSProperties = {
  ...GROUP_LABEL_STYLE,
  "font-size": `${REPORT_FONT.micro}px`,
  "font-weight": 800,
  color: palette.PRIMARY,
};

const HAIRLINE_STYLE: JSX.CSSProperties = {
  height: "1px",
  "background-color": palette.TERM_BORDER,
  "flex-shrink": 0,
};

/** The one decision band: semantic verdict chip, action levels and one
 *  percentage share a 32px surface with the four captioned KPI cells. The
 *  ALL STATS detail is a fixed popover, so opening it never changes this row. */
export function DecisionHero(props: { view: DecisionView }): JSX.Element {
  const view = props.view;
  const [statsOpen, setStatsOpen] = createSignal(false);
  const [reposition, setReposition] = createSignal(0);
  const detailId = createUniqueId();
  let disclosureEl: HTMLDivElement | undefined;
  let toggleEl: HTMLButtonElement | undefined;

  // `planConfidenceLabel` returns "confidence 83%"; inside the band the word
  // appears in the control's aria-label, so printing it again beside the number
  // used to read "CONFIDENCE confidence 83%". Keep the percentage once.
  const percent = () =>
    view.planConfidence().computed
      ? view.planConfidence().text.replace(/^confidence\s*/i, "")
      : "";

  // The claim arrives as `BEARISH · spot 25,569.6 · sell … · cut … · target …`.
  // SPOT is owned by the hero's KPI cell and the verdict by the status chip, so
  // the level readout drops both segments instead of printing a second call.
  const verdict = () => {
    const match = /^\s*(BULLISH|BEARISH|NEUTRAL)\b/i.exec(view.decision().claim);
    return match ? match[1].toUpperCase() : "";
  };
  const levels = () =>
    view.decision()
      .claim.replace(/\s*·?\s*spot\s+[\d,.]+/i, "")
      .replace(/^\s*(BULLISH|BEARISH|NEUTRAL)\s*·\s*/i, "")
      .trim();

  const chipInk = () => {
    const side = verdict();
    if (side === "BEARISH") return palette.NEGATIVE;
    if (side === "BULLISH") return palette.POSITIVE;
    return view.decision().chip === "decision" ? palette.TEXT_MUTED : palette.PRIMARY;
  };

  const openToken = (key: KpiTokenKey) => {
    if (key === "walls") view.store.walls?.openDrawer?.();
    else view.store.ui.setOverlayOpen?.("gamma", true);
  };

  // The popover is fixed below the toggle: it escapes the strip's overflow clip
  // and never participates in the band's height. `reposition` re-reads the
  // anchor geometry while an internal scroll or a resize moves it.
  const geometry = () => {
    reposition();
    const rect = toggleEl?.getBoundingClientRect();
    const narrow = window.innerWidth <= 600;
    const inset = REPORT_HERO_POPOVER.narrowInset;
    const width = narrow
      ? Math.max(200, window.innerWidth - inset * 2)
      : Math.min(REPORT_HERO_POPOVER.maxWidth, window.innerWidth - inset * 2);
    const top = (rect?.bottom ?? REPORT_KPI_HERO_HEIGHT) + REPORT_GUTTER.inline;
    const left = narrow
      ? inset
      : Math.max(inset, Math.min(rect?.left ?? inset, window.innerWidth - width - inset));
    const available = Math.max(160, window.innerHeight - top - inset);
    return {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      "max-height": `${Math.min(REPORT_HERO_POPOVER.maxHeight, available)}px`,
    };
  };

  createEffect(() => {
    if (!statsOpen()) return;
    const recompute = () => setReposition((n) => n + 1);
    window.addEventListener("resize", recompute);
    document.addEventListener("scroll", recompute, true);
    onCleanup(() => {
      window.removeEventListener("resize", recompute);
      document.removeEventListener("scroll", recompute, true);
    });
  });

  createEffect(() => {
    if (!statsOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // The popover owns this Escape; chart focus and drawers keep theirs.
        event.stopImmediatePropagation();
        setStatsOpen(false);
        toggleEl?.focus();
      }
    };
    const onOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !disclosureEl?.contains(target)) setStatsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("click", onOutside);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("click", onOutside);
    });
  });

  const decisionSlot = (
    <Box
      data-testid="nifty-plan-oneliner"
      className="flex flex-nowrap items-center gap-1 min-w-0"
      style={view.decision().claim ? PLAN_ONELINER_STYLE : {}}
    >
      <span
        data-testid="nifty-decision-state"
        data-decision-kind={view.decision().kind}
        title={
          view.decision().kind === "closed"
            ? "No live feed — this is a stored snapshot"
            : `${view.decision().stateLabel} — ${view.decision().claim}`
        }
        className="shrink-0"
        style={{
          ...DECISION_STATUS_STYLE,
          "background-color": palette.alpha(chipInk(), 0.16),
          color: chipInk(),
        }}
      >
        {verdict() || view.decision().stateLabel}
      </span>
      <Show when={view.decision().reason}>
        <span
          data-testid="nifty-decision-chip"
          className="max-[600px]:hidden"
          style={DECISION_REASON_STYLE}
        >
          {view.decision().reason}
        </span>
      </Show>
      <Box
        data-testid="nifty-plan-headline"
        data-decision-kind={view.decision().kind}
        title={`${view.decision().stateLabel} — ${view.decision().claim}`}
        className="min-w-0 overflow-hidden text-ellipsis max-[600px]:hidden"
        style={{
          ...HERO_CLAIM_STYLE,
          "font-size": `${REPORT_FONT.body}px`,
          color: view.claimTone(),
        }}
      >
        {levels()}
      </Box>
      <Box
        data-testid="nifty-plan-confidence"
        data-confidence-computed={view.planConfidence().computed ? "true" : "false"}
        title={
          view.planConfidence().computed
            ? "Weighted confidence behind the active side"
            : "No directional call, so there is no confidence to compute"
        }
        className="shrink-0"
        style={{
          ...PLAN_CONFIDENCE_STYLE,
          "background-color": palette.alpha(palette.TERM_BORDER, 0.18),
          "border-radius": `${REPORT_RADIUS.sm}px`,
          "padding-left": "3px",
          "padding-right": "3px",
        }}
      >
        {percent()}
      </Box>
      <Box className="shrink-0 max-[600px]:hidden">
        <ReasonsButton view={view} />
      </Box>
    </Box>
  );

  const statsToggle = (
    <Box
      ref={(el: HTMLDivElement) => (disclosureEl = el)}
      data-testid="nifty-verdict-disclosure"
      data-open={statsOpen() ? "true" : "false"}
      className="relative shrink-0"
    >
      <Button
        ref={(el: HTMLButtonElement) => (toggleEl = el)}
        data-testid="nifty-live-tape-toggle"
        type="button"
        size="xs"
        variant="subtle"
        aria-label={
          statsOpen()
            ? "Hide all stats: walls, volatility and evidence"
            : "Show all stats: walls, volatility and evidence"
        }
        aria-expanded={statsOpen()}
        aria-controls={detailId}
        title="Show walls, volatility and evidence"
        className="h-6 min-h-6 px-1 gap-1 text-ui-micro font-extrabold uppercase tracking-[0.08em]"
        style={{ color: palette.PRIMARY }}
        onClick={() => setStatsOpen((open) => !open)}
      >
        <span aria-hidden="true">{statsOpen() ? "▾" : "▸"}</span>
        <span>ALL STATS</span>
      </Button>
      <Box
        id={detailId}
        data-testid="nifty-live-tape-content"
        role="group"
        aria-label="All report statistics"
        className={`flex flex-col gap-2 w-full min-w-0 ${REPORT_HERO_STATS_GRID_CLASS}`}
        style={{
          display: statsOpen() ? "flex" : "none",
          position: "fixed",
          top: geometry().top,
          left: geometry().left,
          width: geometry().width,
          "max-height": geometry()["max-height"],
          "z-index": `${REPORT_HERO_POPOVER.zIndex}`,
          overflow: "auto",
          "overflow-y": "auto",
          "overflow-x": "hidden",
          "overscroll-behavior": "contain",
          "background-color": palette.SURFACE_ALT,
          "box-shadow": `inset 0 0 0 1px ${palette.BORDER}`,
          "border-radius": `${REPORT_RADIUS.md}px`,
          padding: `${REPORT_GUTTER.inline}px`,
        }}
      >
        <Text span style={POPUP_CAPTION_STYLE}>ALL STATS · report snapshot</Text>
        <DecisionStats view={view} />
        <Box aria-hidden="true" style={HAIRLINE_STYLE} />
        <Text span style={POPUP_CAPTION_STYLE}>EVIDENCE</Text>
        <VerdictContent view={view} />
      </Box>
    </Box>
  );

  return (
    <Box
      data-testid="nifty-decision-hero"
      data-report-band="decision-hero"
      className="flex flex-row items-center min-w-0 shrink-0 w-full"
      style={{
        height: `${REPORT_KPI_HERO_HEIGHT}px`,
        "min-height": `${REPORT_KPI_HERO_HEIGHT}px`,
      }}
    >
      <ReportKpiHero
        report={view.report()!}
        decisionSlot={decisionSlot}
        statsToggle={statsToggle}
        expand={statsOpen()}
        onToken={openToken}
      />
    </Box>
  );
}
