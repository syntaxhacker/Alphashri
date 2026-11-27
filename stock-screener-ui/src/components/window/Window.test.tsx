// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelContext, DockPanelSpec } from "../dock/types";
import { Window } from "./Window";
import type { WindowState } from "./types";

const STUB_SPEC: DockPanelSpec = {
  id: "stub",
  page: "report",
  title: "STUB",
  size: 1,
  minWidth: 0,
  singleton: false,
  requires: [],
  mount: () => <div data-testid="panel-stub" />,
};

function renderWindow(title: string): HTMLElement {
  const state: WindowState = {
    id: "a",
    type: "stub",
    title,
    x: 0,
    y: 0,
    w: 320,
    h: 472,
    z: 1,
  };
  render(() => (
    <UIProvider>
      <Window
        state={state}
        canvas={() => ({ w: 320, h: 472 })}
        spec={STUB_SPEC}
        context={() => ({}) as DockPanelContext}
        focused={false}
        locked={false}
        onFocus={vi.fn()}
        onRectChange={vi.fn()}
        onMinimize={vi.fn()}
        onMaximize={vi.fn()}
        onClose={vi.fn()}
        onPopOut={vi.fn()}
      />
    </UIProvider>
  ));
  return screen.getByTestId("window-title-a") as HTMLElement;
}

afterEach(cleanup);

describe("Window — truncated title hover affordance", () => {
  it.each(["OPTIONS ANALYTICS", "OPTION-CHAIN OPEN INTEREST & GREEKS"])(
    "exposes the full title '%s' as a native tooltip on the truncated span",
    (title) => {
      const bar = renderWindow(title);
      const spans = bar.querySelectorAll("span.truncate");
      expect(spans).toHaveLength(1);
      const span = spans[0] as HTMLElement;
      expect(span).toHaveTextContent(title);
      expect(span).toHaveAttribute("title", title);
      // The tooltip lives on the existing text node: no extra title element,
      // no focusable/selectable-text change.
      expect(span).not.toHaveAttribute("tabindex");
      expect(span.tagName).toBe("SPAN");
    },
  );
});
