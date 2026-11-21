// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { UIProvider } from "@/ui";
import type { DockPanelApi, DockPanelContext, DockPanelSpec } from "../dock/types";
import { getPanelSpec, WINDOW_PANELS, WINDOW_PANEL_TYPES } from "./panelRegistry";
import { CATALYST_RADAR_PANEL } from "./panels/catalystRadar";
import { lazyPanelSpec } from "./panels/lazyPanel";
import { NEWS_FEED_PANEL } from "./panels/newsFeed";
import { SECTOR_MOVERS_PANEL } from "./panels/sectorMovers";

const ctx = (): DockPanelContext => ({});
const api: DockPanelApi = { data: () => undefined, commands: {} };

afterEach(cleanup);

describe("lazy panel registry", () => {
  it("(a) every WINDOW_PANELS id still resolves through the string lookup", () => {
    for (const spec of WINDOW_PANELS) {
      expect(getPanelSpec(spec.id), spec.id).toBe(spec);
    }
  });

  it("(b) a lazy panel paints a real skeleton, then its content", async () => {
    let resolveLoad!: (spec: DockPanelSpec) => void;
    const pending = new Promise<DockPanelSpec>((resolve) => {
      resolveLoad = resolve;
    });
    const lazy = lazyPanelSpec(
      {
        id: "test.lazy",
        page: "report",
        title: "TEST LAZY",
        size: 1,
        minWidth: 100,
        singleton: true,
        requires: [],
      },
      () => pending,
    );

    render(() => (
      <UIProvider>
        {lazy.mount(ctx, api)}
      </UIProvider>
    ));

    expect(screen.getByTestId("panel-skeleton-test.lazy")).toBeInTheDocument();
    expect(screen.getByTestId("panel-skeleton-test.lazy")).toHaveTextContent("Loading TEST LAZY");

    resolveLoad({ ...lazy, mount: () => <div data-testid="lazy-content" /> });

    expect(await screen.findByTestId("lazy-content")).toBeInTheDocument();
    expect(screen.queryByTestId("panel-skeleton-test.lazy")).not.toBeInTheDocument();
  });

  it("(c) always-mounted Monitor panels stay eager and resolve synchronously", () => {
    expect(getPanelSpec("catalyst.radar")).toBe(CATALYST_RADAR_PANEL);
    expect(getPanelSpec("news.feed")).toBe(NEWS_FEED_PANEL);
    expect(getPanelSpec("sector.movers")).toBe(SECTOR_MOVERS_PANEL);
  });

  it("(d) an unknown panel type still degrades to undefined", () => {
    expect(getPanelSpec("no.such.panel")).toBeUndefined();
    expect(WINDOW_PANEL_TYPES.has("no.such.panel")).toBe(false);
  });
});
