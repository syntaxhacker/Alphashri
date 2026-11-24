// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import h from "solid-js/h";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UIProvider } from "@/ui";
import { fetchSectionScan, type SectionScanResult } from "../../api/sections";
import type { DockPanelApi, DockPanelContext } from "../../components/dock/types";
import { getPanelSpec } from "../../components/window/panelRegistry";
import type { SectionDefinition } from "../../state/sections/types";
import {
  createSectionPanelSpec,
  getSectionPanelSpecs,
  isSectionPanelId,
  resetSectionPanels,
  SectionPanel,
  sectionPanelId,
  syncSectionPanels,
} from "./homeSectionPanels";

vi.mock("../../api/sections", () => ({ fetchSectionScan: vi.fn() }));

const scan = vi.mocked(fetchSectionScan);

const SECTION: SectionDefinition = {
  id: "vwap-reclaim",
  name: "VWAP Reclaim",
  description: "Close above VWAP",
  concept: "vwap_above",
  side: "long",
  conditions: [{ metric: "close", op: "gt", value: null }],
  render: { type: "table", columns: ["close", "VWAP"] },
  refreshSec: 30,
  enabled: true,
  pinned: true,
};

const ROW = {
  symbol: "HDFCBANK",
  name: "HDFC Bank",
  fields: { close: 1700, VWAP: 1690 },
  signals: { "vwap-reclaim": true },
};

const result = (rows: typeof ROW[]): SectionScanResult => ({
  market: "india",
  generated_at: "2026-11-25T10:00:00+05:30",
  row_count: rows.length,
  delayed_rows: 0,
  note: null,
  rows,
});

const noopApi: DockPanelApi = { data: () => undefined, commands: {} };
const ctx = (): DockPanelContext => ({ market: "india", symbol: "NIFTY" });

function mountSection(def: SectionDefinition = SECTION) {
  return render(() =>
    h(UIProvider, {}, h(SectionPanel, { section: def, market: "india" }))(),
  );
}

beforeEach(() => {
  scan.mockReset();
  resetSectionPanels();
});

afterEach(() => {
  cleanup();
  resetSectionPanels();
});

describe("dynamic section panel specs", () => {
  it("uses section:<id>, carries the section's own title and is a screener panel", () => {
    const spec = createSectionPanelSpec(SECTION);

    expect(spec.id).toBe("section:vwap-reclaim");
    expect(isSectionPanelId(spec.id)).toBe(true);
    expect(spec.title).toBe("VWAP Reclaim");
    expect(spec.page).toBe("screener");
    expect(spec.requires).toEqual([]);
    expect(sectionPanelId(SECTION.id)).toBe(spec.id);
  });

  it("registers into the one desk registry so picker and window manager share it", () => {
    const { live } = syncSectionPanels([SECTION]);

    expect(live.map((spec) => spec.id)).toEqual(["section:vwap-reclaim"]);
    expect(getSectionPanelSpecs().map((spec) => spec.id)).toEqual(["section:vwap-reclaim"]);
    expect(getPanelSpec("section:vwap-reclaim")?.title).toBe("VWAP Reclaim");
  });

  it("deleting a pinned section leaves a named empty state instead of an unknown-panel crash", () => {
    syncSectionPanels([SECTION]);
    const { tombstones } = syncSectionPanels([]);

    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe("section:vwap-reclaim");
    const spec = getPanelSpec("section:vwap-reclaim")!;
    expect(getSectionPanelSpecs()).toEqual([]);

    render(() => h(UIProvider, {}, spec.mount(ctx, noopApi))());
    expect(screen.getByTestId("section-panel-deleted-vwap-reclaim")).toHaveTextContent(
      "This section was deleted",
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("re-registering the same id replaces the spec in place after a rename", () => {
    syncSectionPanels([SECTION]);
    syncSectionPanels([{ ...SECTION, name: "VWAP Reclaim v2" }]);

    expect(getPanelSpec("section:vwap-reclaim")?.title).toBe("VWAP Reclaim v2");
  });
});

describe("section panel mount", () => {
  it("fetches the real section scan and renders SectionTable rows", async () => {
    scan.mockResolvedValue(result([ROW]));

    mountSection();

    expect(await screen.findByText("HDFCBANK")).toBeInTheDocument();
    expect(screen.getByTestId("section-window-vwap-reclaim")).toHaveTextContent("VWAP Reclaim");
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledWith("india", [SECTION], true);
    expect(screen.queryByTestId("section-table-empty-vwap-reclaim")).not.toBeInTheDocument();
  });

  it("names an empty result instead of showing placeholder text", async () => {
    scan.mockResolvedValue(result([]));

    mountSection();

    expect(await screen.findByTestId("section-table-empty-vwap-reclaim")).toHaveTextContent(
      "No symbols matched VWAP Reclaim",
    );
  });

  it("names a failed scan and retries through the same fetch", async () => {
    scan.mockRejectedValueOnce(new Error("scan unavailable")).mockResolvedValueOnce(result([ROW]));

    mountSection();

    const error = await screen.findByTestId("section-table-error-vwap-reclaim");
    expect(error).toHaveTextContent("scan unavailable");
    fireEvent.click(screen.getByTestId("section-panel-retry-vwap-reclaim"));
    expect(await screen.findByText("HDFCBANK")).toBeInTheDocument();
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
