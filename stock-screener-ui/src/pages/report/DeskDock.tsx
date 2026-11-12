import { useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { ActionIcon, useMediaQuery, useTheme } from "@/ui";
import { IconX } from "@tabler/icons-react";
import * as palette from "@/ui/palette";

export type DeskDockKey = "flow" | "setup" | "alerts" | "market";

export interface DeskDockTab {
  key: DeskDockKey;
  label: string;
  /** Compact live value shown in the closed tab bar. */
  summary: ReactNode;
  content: ReactNode;
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
export function DeskDock({
  tabs,
  active,
  onActiveChange,
}: {
  tabs: DeskDockKey[];
  active: DeskDockKey | null;
  onActiveChange: (key: DeskDockKey | null) => void;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down("sm"));
  const activeTab = tabs.find((tab) => tab.key === active) ?? null;

  const toggle = useCallback(
    (key: DeskDockKey) => onActiveChange(active === key ? null : key),
    [active, onActiveChange],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= tabs.length) return;
      event.preventDefault();
      toggle(tabs[index].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabs, toggle]);

  const tabButton = (tab: DeskDockTab, selected: boolean) => (
    <button
      key={tab.key}
      data-testid={`desk-dock-${tab.key}`}
      type="button"
      aria-pressed={selected}
      onClick={() => toggle(tab.key)}
      className={`flex items-center gap-1 min-w-0 shrink-0 h-[20px] px-1.5 py-0 rounded-sm whitespace-nowrap ${selected ? "bg-fin-primary text-fin-bg" : "bg-fin-surface-alt text-fin-text"}`}
      style={{ "font-size": 8.5, "font-weight": 800, "letter-spacing": 0.5 }}
    >
      <span className="font-black text-[8.5px] tracking-[0.5em]">{tab.label}</span>
      {tab.summary != null ? (
        <span className="text-[8px] text-fin-text-muted">{tab.summary}</span>
      ) : null}
      {tab.badge && tab.badge > 0 ? (
        <span
          className="inline-flex items-center justify-center shrink-0 whitespace-nowrap min-w-[15px] h-[14px] rounded-[7px]"
          style={{
            padding: "1px 3px",
            "background-color": palette.NEGATIVE,
            color: "#fff",
            "font-size": 7.5,
            "font-weight": 800,
            "line-height": 1,
          }}
        >
          {tab.badge}
        </span>
      ) : null}
    </button>
  );

  return (
    <>
      <div
        data-testid="desk-dock"
        className="sticky bottom-0 z-20 flex items-center gap-[2px] h-[26px] min-h-[26px] px-1 overflow-x-auto overflow-y-hidden"
        style={{
          "background-color": palette.TERM_HEADER,
          "border-top": `1px solid ${palette.TERM_BORDER}`,
        }}
      >
        {tabs.map((tab) => tabButton(tab, active === tab.key))}
        <span className="ml-auto pr-1 whitespace-nowrap text-[7.5px]" style={{ color: palette.TEXT_MUTED }}>
          ALT+1..{tabs.length} · ESC
        </span>
      </div>

      {activeTab && (
        <>
          <div
            data-testid="desk-dock-backdrop"
            className="fixed inset-0 z-40"
            style={{ "background-color": "rgba(0,0,0,0.6)" }}
            onClick={() => onActiveChange(null)}
          />
          <div
            id="desk-dock-drawer"
            data-testid="desk-dock-drawer"
            className="fixed z-50 bottom-0 left-0 right-0 border-t border-fin-border"
            style={{
              left: mobile ? 0 : "var(--app-nav-width, 0px)",
              right: 0,
              width: "auto",
              height: mobile ? "100%" : activeTab?.height ?? "auto",
              "max-height": mobile ? "100%" : "55vh",
              "background-color": palette.TERM_BG,
              "background-image": "none",
              "border-top": `1px solid ${palette.TERM_BORDER}`,
              "box-shadow": "0 -8px 24px rgba(0,0,0,0.45)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col h-full min-h-0">
              <div
                className="flex items-center gap-[2px] h-[24px] min-h-[24px] px-1 border-b border-fin-border"
                style={{ "background-color": palette.TERM_HEADER }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    className={`flex items-center gap-1 min-w-0 shrink-0 h-[20px] px-1.5 py-0 rounded-sm whitespace-nowrap ${active === tab.key ? "bg-fin-primary text-fin-bg" : "bg-fin-surface-alt text-fin-text"}`}
                    onClick={() => onActiveChange(tab.key)}
                    style={{ "font-size": 8.5, "font-weight": 800, "letter-spacing": 0.4 }}
                  >
                    {tab.label}
                  </button>
                ))}
                <ActionIcon
                  size="small"
                  aria-label="Close desk dock"
                  onClick={() => onActiveChange(null)}
                  className="ml-auto p-[2px] rounded-sm"
                >
                  <IconX size={12} />
                </ActionIcon>
              </div>
              <div
                data-testid={active ? `desk-dock-body-${active}` : undefined}
                className="flex-1 min-h-0 overflow-auto p-1"
              >
                {activeTab?.content}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
