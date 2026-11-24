// @vitest-environment happy-dom
// Harness first: its vi.mock registrations must run before PageShell loads.
import { r, resetHarness, testHooks } from "./PatternsPage.mainHarness";
import { Tabs } from "@/ui";
import { PageShell } from "./page/PageShell";

const { afterEach, beforeEach, describe, expect, test, cleanup, fireEvent, screen, vi } = testHooks;

describe("Patterns page shell", () => {
  beforeEach(resetHarness);
  afterEach(() => cleanup());

  test("mounts the tab frame and routes tab clicks through the model", () => {
    const onTabChange = vi.fn();
    r(() => (
      <PageShell
        model={{ activeTab: () => "scan", handleTabChange: onTabChange }}
        header={
          <Tabs.List>
            <Tabs.Tab value="scan" data-testid="shell-tab-scan">Scan</Tabs.Tab>
            <Tabs.Tab value="watch" data-testid="shell-tab-watch">Watch</Tabs.Tab>
          </Tabs.List>
        }
        scanPanel={<Tabs.Panel value="scan" data-testid="shell-panel-scan">scan</Tabs.Panel>}
        watchPanel={<Tabs.Panel value="watch" data-testid="shell-panel-watch">watch</Tabs.Panel>}
        overlays={<div data-testid="shell-overlay" />}
      />
    ));
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("shell-panel-scan")).toBeInTheDocument();
    expect(screen.queryByTestId("shell-panel-watch")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("shell-tab-watch"));
    expect(onTabChange).toHaveBeenCalledWith("watch");
    expect(screen.getByTestId("shell-overlay")).toBeInTheDocument();
  });
});
