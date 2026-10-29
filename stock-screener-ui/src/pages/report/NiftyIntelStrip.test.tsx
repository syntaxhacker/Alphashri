// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import { NiftyIntelStrip } from "./NiftyIntelStrip";
import {
  fmtIntelInt,
  fmtIntelOi,
  fmtIntelPcr,
  fmtIntelSigned,
  normalizeNiftyIntel,
} from "./niftyIntel";
import type { NiftyIntel } from "./niftyIntel";

function intel(overrides: Partial<NiftyIntel> = {}): NiftyIntel {
  return {
    date: "2026-10-21",
    expiry: "current_week",
    fii_net: -1149,
    dii_net: 3201,
    dce_oi: 96_000_000,
    dpe_oi: 44_000_000,
    top_dce: [
      { strike: 26000, doi: 12_000_000 },
      { strike: 25900, doi: 3_500_000 },
    ],
    top_dpe: [
      { strike: 25500, doi: 9_000_000 },
      { strike: 25800, doi: -1_200_000 },
    ],
    max_pain: 22900,
    pcr: 0.69,
    news: [
      { heading: "Nifty closes higher", link: "https://example.test/a", published: "10-21 15:29 IST" },
      { heading: "Banks lead the rally", link: "https://example.test/b", published: "10-21 14:02 IST" },
      { heading: "FIIs turn sellers", link: "https://example.test/c", published: "10-21 12:45 IST" },
    ],
    unavailable: [],
    as_of: "2026-10-21T20:00:00+05:30",
    ...overrides,
  };
}

function r(node: React.ReactElement) {
  return render(node, { wrapper: UIProvider });
}

afterEach(cleanup);

describe("NiftyIntelStrip — compact fields", () => {
  test("renders FII, DII, ΔOI, max pain, PCR and the news count", async () => {
    r(<NiftyIntelStrip fetcher={vi.fn().mockResolvedValue(intel())} />);

    expect(await screen.findByTestId("nifty-intel-fii")).toHaveTextContent("−1,149");
    expect(screen.getByTestId("nifty-intel-dii")).toHaveTextContent("+3,201");
    const doi = screen.getByTestId("nifty-intel-doi");
    expect(doi).toHaveTextContent(/ΔOI C\s*\+96M/);
    expect(doi).toHaveTextContent(/\/\s*P\s*\+44M/);
    expect(screen.getByTestId("nifty-intel-mp")).toHaveTextContent("22,900");
    expect(screen.getByTestId("nifty-intel-pcr")).toHaveTextContent("0.69");
    expect(screen.getByTestId("nifty-intel-news")).toHaveTextContent("3 news");
  });

  test("uses the strip's 24px height contract", async () => {
    r(<NiftyIntelStrip fetcher={vi.fn().mockResolvedValue(intel())} />);
    const strip = await screen.findByTestId("nifty-intel-strip");
    expect(strip).toHaveStyle({ height: "24px" });
  });

  test("keeps the strip to a dash per field when only some sources are available", async () => {
    r(
      <NiftyIntelStrip
        fetcher={vi.fn().mockResolvedValue(
          intel({ fii_net: null, dii_net: null, dce_oi: null, dpe_oi: null, max_pain: null, pcr: null, news: [], unavailable: ["fii", "dii"] }),
        )}
      />,
    );
    expect(await screen.findByTestId("nifty-intel-fii")).toHaveTextContent("—");
    expect(screen.getByTestId("nifty-intel-news")).toHaveTextContent("no news");
  });
});

describe("NiftyIntelStrip — drawer", () => {
  test("clicking the strip opens the modal with ΔOI strikes and linked headlines", async () => {
    const user = userEvent.setup();
    r(<NiftyIntelStrip fetcher={vi.fn().mockResolvedValue(intel())} />);

    await user.click(await screen.findByTestId("nifty-intel-strip"));

    const modal = await screen.findByTestId("nifty-intel-modal");
    expect(within(modal).getByTestId("nifty-intel-modal-date")).toHaveTextContent("2026-10-21");
    expect(within(modal).getByTestId("nifty-intel-modal-expiry")).toHaveTextContent("current_week");
    expect(within(modal).getByTestId("nifty-intel-modal-asof")).toHaveTextContent("as of 21 Oct 2026");
    expect(within(modal).getByTestId("nifty-intel-modal-asof")).toHaveTextContent("IST");
    expect(within(modal).queryByTestId("nifty-intel-modal-eod")).not.toBeInTheDocument();
    expect(within(modal).getByTestId("nifty-intel-modal-call-26000")).toHaveTextContent("26,000");
    expect(within(modal).getByTestId("nifty-intel-modal-call-26000")).toHaveTextContent("+12M");
    expect(within(modal).getByTestId("nifty-intel-modal-put-25500")).toHaveTextContent("+9.0M");
    expect(within(modal).getByTestId("nifty-intel-modal-put-25800")).toHaveTextContent("−1.2M");

    const firstNews = within(modal).getByTestId("nifty-intel-news-item-0");
    expect(firstNews).toHaveTextContent("10-21 15:29 IST");
    expect(within(modal).getByTestId("nifty-intel-news-link-0")).toHaveAttribute(
      "href",
      "https://example.test/a",
    );
    expect(within(modal).getByTestId("nifty-intel-news-link-0")).toHaveAttribute("target", "_blank");
    expect(within(modal).getByText("Nifty closes higher")).toBeInTheDocument();
  });

  test("keyboard Enter opens the drawer", async () => {
    const user = userEvent.setup();
    r(<NiftyIntelStrip fetcher={vi.fn().mockResolvedValue(intel())} />);

    const strip = await screen.findByTestId("nifty-intel-strip");
    strip.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("nifty-intel-modal")).toBeInTheDocument();
  });

  test("EOD labels the block as the latest session, not the replay frame", async () => {
    const user = userEvent.setup();
    r(<NiftyIntelStrip eod fetcher={vi.fn().mockResolvedValue(intel())} />);

    const strip = await screen.findByTestId("nifty-intel-strip");
    expect(strip).toHaveAttribute("title", expect.stringContaining("latest session, not this frame"));
    await user.click(strip);

    const modal = await screen.findByTestId("nifty-intel-modal");
    expect(within(modal).getByTestId("nifty-intel-modal-eod")).toHaveTextContent(
      "latest session — not this replay frame",
    );
  });
});

describe("NiftyIntelStrip — empty state", () => {
  test("a failed first fetch shows INTEL unavailable instead of crashing", async () => {
    r(<NiftyIntelStrip fetcher={vi.fn().mockRejectedValue(new Error("network down"))} />);

    expect(await screen.findByTestId("nifty-intel-unavailable")).toHaveTextContent("INTEL unavailable");
    expect(screen.getByTestId("nifty-intel-strip")).toHaveAttribute("data-state", "unavailable");
  });
});

describe("niftyIntel formatters", () => {
  test("signed rupees use Indian grouping and a true minus", () => {
    expect(fmtIntelSigned(-1149)).toBe("−1,149");
    expect(fmtIntelSigned(3201)).toBe("+3,201");
    expect(fmtIntelSigned(0)).toBe("0");
    expect(fmtIntelSigned(null)).toBe("—");
  });

  test("ΔOI is compact but keeps a decimal under 10M", () => {
    expect(fmtIntelOi(96_000_000)).toBe("+96M");
    expect(fmtIntelOi(-1_200_000)).toBe("−1.2M");
    expect(fmtIntelOi(3_500_000)).toBe("+3.5M");
    expect(fmtIntelOi(null)).toBe("—");
  });

  test("integers and PCR fall back to a dash", () => {
    expect(fmtIntelInt(22900)).toBe("22,900");
    expect(fmtIntelInt(undefined)).toBe("—");
    expect(fmtIntelPcr(0.69)).toBe("0.69");
    expect(fmtIntelPcr(null)).toBe("—");
  });

  test("normalizeNiftyIntel tolerates a partial payload", () => {
    const out = normalizeNiftyIntel({ fii_net: "-1149", news: [{ heading: "x" }] });
    expect(out.fii_net).toBe(-1149);
    expect(out.dii_net).toBeNull();
    expect(out.top_dce).toEqual([]);
    expect(out.news[0]).toEqual({ heading: "x", link: "", published: "—" });
  });
});
