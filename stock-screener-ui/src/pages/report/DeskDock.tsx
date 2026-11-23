import { createEffect, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { ActionIcon, Box, useMediaQuery } from "@/ui";
import { IconX } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import { REPORT_FONT } from "./reportTokens";

export type DeskDockKey = "flow" | "setup" | "alerts" | "market" | "strips" | "analytics";

// The desktop drawer is an overlay anchored above the tab bar: it never enters
// the flex column, so opening a dock tab cannot steal height from the chart.
export const DESK_DOCK_OPEN_MIN_HEIGHT = 180;
export const DESK_DOCK_OVERLAY_HEIGHT = 220;
/** The bar is the handle for that 220px drawer; at 26px it read as a strip. */
export const DESK_DOCK_BAR_HEIGHT = 40;

interface DockHelp {
  label: string;
  shows: string;
  ariaLabel: string;
  title: string;
}

export const DOCK_HELP: Record<DeskDockKey, DockHelp> = {
  flow: {
    label: "Delta",
    shows: "positioning",
    ariaLabel: "Delta positioning tab — open the delta profile",
    title:
      "Delta positioning — where option writers are net long or short directional exposure. The value shows the current delta balance. Opens the delta profile.",
  },
  setup: {
    label: "Dealer gamma",
    shows: "regime",
    ariaLabel: "Dealer gamma regime tab — open the dealer gamma profile",
    title:
      "Dealer gamma regime — long gamma dampens moves, short gamma amplifies them. The value shows the current regime. Opens the dealer gamma profile.",
  },
  market: {
    label: "IV skew",
    shows: "strikes",
    ariaLabel: "Implied volatility skew tab — open the IV skew chart",
    title:
      "Implied volatility skew across strikes. The value shows how many strikes are in the chain. Opens the IV skew chart.",
  },
  strips: {
    label: "Desk",
    shows: "panels",
    ariaLabel: "Desk panels tab — open walls and breadth",
    title:
      "Desk panels — option walls and market breadth. Opens the walls and breadth panels.",
  },
  analytics: {
    label: "Data",
    shows: "panels",
    ariaLabel: "Data panels tab — open tape and flow",
    title:
      "Data panels — the live trade tape and flow windows. Opens the tape and flow panels.",
  },
  alerts: {
    label: "Alerts",
    shows: "log",
    ariaLabel: "Alerts log tab — open the alert log",
    title: "Alerts log — option open-interest bursts and risk alerts. Opens the alert log.",
  },
};

export function dockHelp(key: DeskDockKey): DockHelp {
  return DOCK_HELP[key];
}

export function dockLayout(narrow: boolean) {
  return {
    wrap: narrow,
    direction: "row" as const,
    height: narrow ? "auto" : `${DESK_DOCK_BAR_HEIGHT}px`,
    minHeight: narrow ? "26px" : `${DESK_DOCK_BAR_HEIGHT}px`,
    overflowX: narrow ? "visible" : "auto",
    overflowY: narrow ? "visible" : "hidden",
    showHint: !narrow,
  };
}

export interface DeskDockTab {
  key: DeskDockKey;
  label: string;
  /** Compact live value shown in the closed tab bar. */
  summary: JSX.Element;
  content: JSX.Element;
  /** Critical count, rendered as a red badge on the tab. */
  badge?: number;
  /** Fixed drawer height for content that needs it (the alert log); omit to
   *  hug the content so a 2-strip MARKET drawer is not 300px of black. */
  height?: number;
}

/**
 * Desk bottom dock — low-frequency panels live here; one drawer opens at a
 * time. Alt+1..5 toggles, Esc closes (handled on window).
 */
export function DeskDock(props: {
  tabs: DeskDockTab[];
  active: DeskDockKey | null;
  onActiveChange: (key: DeskDockKey | null) => void;
}) {
  const active = () => props.active;
  const mobile = useMediaQuery("(max-width: 600px)");
  const layout = () => dockLayout(mobile());
  const activeTab = () => props.tabs.find((tab) => tab.key === active()) ?? null;

  const toggle = (key: DeskDockKey) => props.onActiveChange(active() === key ? null : key);

  createEffect(() => {
    const tabs = props.tabs;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
      event.preventDefault();
      toggle(tabs[index].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A getter, not a boolean: the bar renders once, so a captured boolean would
  // freeze every tab in its initial (inactive) state while the drawer updated.
  const tabButton = (tab: DeskDockTab, index: number, isSelected: () => boolean) => {
    const help = dockHelp(tab.key);
    const selectedInk = () => pickTextColor(palette.PRIMARY);
    const subInk = () => (isSelected() ? selectedInk() : palette.TEXT_MUTED);
    return (
      <button
        data-testid={`desk-dock-${tab.key}`}
        data-dock-tab={tab.key}
        data-dock-open={isSelected() ? "true" : "false"}
        type="button"
        aria-pressed={isSelected()}
        aria-label={help.ariaLabel}
        title={help.title}
        onClick={() => toggle(tab.key)}
        class="flex items-center gap-1 min-w-0 shrink-0 h-[32px] px-2 py-0 rounded-sm whitespace-nowrap"
        style={{
          "background-color": isSelected() ? palette.PRIMARY : palette.SURFACE_ALT,
          color: isSelected() ? selectedInk() : palette.TEXT,
          // Shape as well as colour: an inset rail survives colour-blindness.
          "box-shadow": isSelected() ? `inset 0 3px 0 ${palette.BG}` : "none",
          "font-size": `${REPORT_FONT.body}px`,
          "font-weight": 800,
          "letter-spacing": "0.02em",
        }}
      >
        <span class="inline-flex items-center gap-1 whitespace-nowrap">
          <span class="font-semibold" style={{ color: subInk() }} aria-hidden="true">
            {index + 1}
          </span>{" "}
          <span>{help.label}</span>{" "}
          <span style={{ color: subInk() }}>{help.shows}</span>
        </span>
        <Show when={tab.summary != null}>
          <span class="font-normal" style={{ color: subInk() }}>
            {": "}
            {tab.summary}
          </span>
        </Show>
        <span class="font-bold" style={{ color: subInk() }} aria-hidden="true">
          {isSelected() ? "▾" : "▸"}
        </span>
        <Show when={tab.badge != null && tab.badge! > 0}>
          <span
            class="inline-flex items-center justify-center shrink-0 whitespace-nowrap min-w-[18px] h-[18px] rounded-[9px]"
            style={{
              padding: "1px 3px",
              "background-color": palette.NEGATIVE,
              color: palette.TEXT_ON_ACCENT,
              "font-size": `${REPORT_FONT.body}px`,
              "font-weight": 800,
              "line-height": 1,
            }}
          >
            {tab.badge}
          </span>
        </Show>
      </button>
    );
  };

  return (
    <Box
      data-testid="desk-dock-region"
      data-dock-mode={mobile() ? "sheet" : "overlay"}
      class={`flex flex-col min-w-0 min-h-0 w-full ${mobile() ? "overflow-hidden" : "relative overflow-visible"}`}
    >
      <Show when={activeTab()}>
        <>
          <div
            data-testid="desk-dock-backdrop"
            class={mobile() ? "fixed inset-0 z-40" : "fixed inset-0 z-20"}
            style={{ "background-color": "rgba(0,0,0,0.6)" }}
            onClick={() => props.onActiveChange(null)}
          />
          <div
            id="desk-dock-drawer"
            data-testid="desk-dock-drawer"
            data-dock-min-height={mobile() ? undefined : String(DESK_DOCK_OPEN_MIN_HEIGHT)}
            data-dock-mode={mobile() ? undefined : "overlay"}
            class={
              mobile()
                ? "fixed z-50 bottom-0 left-0 right-0 border-t border-fin-border"
                : "absolute bottom-full left-0 right-0 z-30 flex flex-col min-h-[180px] border-t border-fin-border"
            }
            style={
              mobile()
                ? {
                    left: "0",
                    right: "0",
                    width: "auto",
                    height: "100%",
                    "max-height": "100%",
                    "background-color": palette.TERM_BG,
                    "background-image": "none",
                    "border-top": `1px solid ${palette.TERM_BORDER}`,
                    "box-shadow": "0 -8px 24px rgba(0,0,0,0.45)",
                  }
                : {
                    "background-color": palette.TERM_BG,
                    "background-image": "none",
                    "border-top": `1px solid ${palette.TERM_BORDER}`,
                    "box-shadow": "0 -8px 24px rgba(0,0,0,0.45)",
                    height: `${DESK_DOCK_OVERLAY_HEIGHT}px`,
                    "max-height": "32vh",
                    overflow: "hidden",
                  }
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex flex-col h-full min-h-0">
              <div
                class="flex items-center gap-1 h-[26px] min-h-[26px] px-2 border-b border-fin-border overflow-x-auto"
                style={{ "background-color": palette.TERM_HEADER }}
              >
                <For each={props.tabs}>
                  {(tab) => (
                    <button
                      type="button"
                      aria-label={dockHelp(tab.key).ariaLabel}
                      title={dockHelp(tab.key).title}
                      class="flex items-center gap-1 min-w-0 shrink-0 h-[24px] px-2 py-0 rounded-sm whitespace-nowrap"
                      style={{
                        "background-color":
                          active() === tab.key ? palette.PRIMARY : palette.SURFACE_ALT,
                        color:
                          active() === tab.key ? pickTextColor(palette.PRIMARY) : palette.TEXT,
                        "font-size": `${REPORT_FONT.body}px`,
                        "font-weight": 800,
                      }}
                      onClick={() => props.onActiveChange(tab.key)}
                    >
                      <span>{dockHelp(tab.key).label}</span>{" "}
                      <span
                        style={{
                          color:
                            active() === tab.key
                              ? pickTextColor(palette.PRIMARY)
                              : palette.TEXT_MUTED,
                        }}
                      >
                        {dockHelp(tab.key).shows}
                      </span>
                    </button>
                  )}
                </For>
                <ActionIcon
                  size="small"
                  aria-label="Close desk dock"
                  onClick={() => props.onActiveChange(null)}
                  className="ml-auto p-[2px] rounded-sm"
                >
                  <IconX size={12} />
                </ActionIcon>
              </div>
              <div
                data-testid={active() ? `desk-dock-body-${active()}` : undefined}
                class="flex-1 min-h-0 overflow-auto p-1"
              >
                {activeTab()?.content}
              </div>
            </div>
          </div>
        </>
      </Show>

      <Show when={!activeTab()}>
        <div
          data-testid="desk-dock-idle"
          class="flex-1 min-h-0 flex items-center justify-center px-2"
        >
          <span class="text-ui-micro" style={{ color: palette.TEXT_MUTED }}>
            Select a desk panel below · ALT+1..{props.tabs.length} to toggle · ESC to close
          </span>
        </div>
      </Show>

      <div
        data-testid="desk-dock"
        data-dock-open={active() ? "true" : "false"}
        class={`sticky bottom-0 z-20 mt-auto flex shrink-0 items-center gap-1 px-2 ${layout().wrap ? "flex-wrap h-auto min-h-[26px] py-0.5 overflow-x-visible overflow-y-visible" : "overflow-x-auto overflow-y-hidden"}`}
        style={{
          "background-color": palette.TERM_HEADER,
          "border-top": `1px solid ${palette.TERM_BORDER}`,
          height: layout().wrap ? "auto" : `${DESK_DOCK_BAR_HEIGHT}px`,
          "min-height": layout().wrap ? "26px" : `${DESK_DOCK_BAR_HEIGHT}px`,
        }}
      >
        <span
          class="shrink-0 whitespace-nowrap font-black tracking-[0.08em] text-ui-micro"
          style={{ color: palette.TEXT, "padding-right": "8px" }}
        >
          DESK BAY
        </span>
        <For each={props.tabs}>
          {(tab, index) => tabButton(tab, index(), () => active() === tab.key)}
        </For>
        <Show when={layout().showHint}>
          <span
            data-testid="desk-dock-hint"
            class="ml-auto shrink-0 whitespace-nowrap text-ui-micro font-normal"
            style={{
              color: palette.TEXT_MUTED,
              "padding-left": "8px",
              "border-left": `1px solid ${palette.TERM_BORDER}`,
              "font-size": `${REPORT_FONT.micro}px`,
            }}
          >
            ALT+1..{props.tabs.length} · ESC
          </span>
        </Show>
      </div>
    </Box>
  );
}
