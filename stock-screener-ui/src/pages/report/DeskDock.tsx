import { createEffect, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { ActionIcon, useMediaQuery } from "@/ui";
import { IconX } from "@/components/common/Icons";
import * as palette from "@/ui/palette";

export type DeskDockKey = "flow" | "setup" | "alerts" | "market";

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
 * Desk bottom dock — the low-frequency panels live here so the chart, chain
 * and walls own the first screen. The tab bar stays visible; one drawer opens
 * at a time; Alt+1..4 toggles, Esc closes (handled on window).
 */
export function DeskDock(props: {
  tabs: DeskDockTab[];
  active: DeskDockKey | null;
  onActiveChange: (key: DeskDockKey | null) => void;
}) {
  const active = () => props.active;
  const mobile = useMediaQuery("(max-width: 600px)");
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

  const tabButton = (tab: DeskDockTab, selected: boolean) => (
    <button
      data-testid={`desk-dock-${tab.key}`}
      type="button"
      aria-pressed={selected}
      onClick={() => toggle(tab.key)}
      class={`flex items-center gap-1 min-w-0 shrink-0 h-[20px] px-1.5 py-0 rounded-sm whitespace-nowrap ${selected ? "bg-fin-primary text-fin-bg" : "bg-fin-surface-alt text-fin-text"}`}
      style={{ "font-size": "8.5px", "font-weight": 800, "letter-spacing": "0.5px" }}
    >
      <span class="font-black text-[8.5px] tracking-[0.5em]">{tab.label}</span>
      <Show when={tab.summary != null}>
        <span class="text-[9px] text-fin-text-muted">{tab.summary}</span>
      </Show>
      <Show when={tab.badge != null && tab.badge > 0}>
        <span
          class="inline-flex items-center justify-center shrink-0 whitespace-nowrap min-w-[15px] h-[14px] rounded-[7px]"
          style={{
            padding: "1px 3px",
            "background-color": palette.NEGATIVE,
            color: "#fff",
            "font-size": "7.5px",
            "font-weight": 800,
            "line-height": 1,
          }}
        >
          {tab.badge}
        </span>
      </Show>
    </button>
  );

  return (
    <>
      <div
        data-testid="desk-dock"
        class="sticky bottom-0 z-20 flex items-center gap-[2px] h-[26px] min-h-[26px] px-1 overflow-x-auto overflow-y-hidden"
        style={{
          "background-color": palette.TERM_HEADER,
          "border-top": `1px solid ${palette.TERM_BORDER}`,
        }}
      >
        <For each={props.tabs}>{(tab) => tabButton(tab, active() === tab.key)}</For>
        <span class="ml-auto pr-1 whitespace-nowrap text-[7.5px]" style={{ color: palette.TEXT_MUTED }}>
          ALT+1..{props.tabs.length} · ESC
        </span>
      </div>

      <Show when={activeTab()}>
        <>
          <div
            data-testid="desk-dock-backdrop"
            class="fixed inset-0 z-40"
            style={{ "background-color": "rgba(0,0,0,0.6)" }}
            onClick={() => props.onActiveChange(null)}
          />
          <div
            id="desk-dock-drawer"
            data-testid="desk-dock-drawer"
            class="fixed z-50 bottom-0 left-0 right-0 border-t border-fin-border"
            style={{
              "left": mobile() ? "0" : "var(--app-nav-width, 0px)",
              "right": "0",
              "width": "auto",
              "height": mobile() ? "100%" : activeTab()?.height != null ? `${activeTab()?.height}px` : "auto",
              "max-height": mobile() ? "100%" : "55vh",
              "background-color": palette.TERM_BG,
              "background-image": "none",
              "border-top": `1px solid ${palette.TERM_BORDER}`,
              "box-shadow": "0 -8px 24px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex flex-col h-full min-h-0">
              <div
                class="flex items-center gap-[2px] h-[24px] min-h-[24px] px-1 border-b border-fin-border"
                style={{ "background-color": palette.TERM_HEADER }}
              >
                <For each={props.tabs}>
                {(tab) => (
                  <button
                    type="button"
                    class={`flex items-center gap-1 min-w-0 shrink-0 h-[20px] px-1.5 py-0 rounded-sm whitespace-nowrap ${active() === tab.key ? "bg-fin-primary text-fin-bg" : "bg-fin-surface-alt text-fin-text"}`}
                    onClick={() => props.onActiveChange(tab.key)}
                    style={{ "font-size": "8.5px", "font-weight": 800, "letter-spacing": "0.4px" }}
                  >
                    {tab.label}
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
    </>
  );
}
