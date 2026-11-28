// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createSignal } from "solid-js";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { TEXT, VIZ_SCALE } from "@/ui/palette";
import { fetchWithAuth } from "@/state/auth";
import type { VisRenderProps } from "./MarketMapView";
import {
  CorrelationMatrixView,
  correlationColor,
  formatAsOfShort,
  formatCorrelation,
  normalizeCorrelationPayload,
  shortSectorLabel,
} from "./CorrelationMatrixView";

const REAL_SECTOR_NAMES = [
  "NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY FMCG", "NIFTY PHARMA",
  "NIFTY AUTO", "NIFTY ENERGY", "NIFTY REALTY", "NIFTY METAL", "NIFTY CONSUMPTION",
];
const REAL_SECTOR_CODES = [
  "N50", "NBK", "NIT", "NFMC", "NPHAR", "NAUT", "NENR", "NRLT", "NMET", "NCONS",
];

vi.mock("@/state/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/auth")>();
  return { ...actual, fetchWithAuth: vi.fn() };
});

const mockedFetch = vi.mocked(fetchWithAuth);

const PAYLOAD_A = {
  sectors: [],
  sector_names: ["IT", "Banks", "Pharma"],
  correlation_matrix: [
    [1, 0.42, -0.37],
    [0.42, 1, 0.05],
    [-0.37, 0.05, 1],
  ],
  last_updated: "2026-11-28T10:00:00+05:30",
};

const PAYLOAD_B = {
  sectors: [],
  sector_names: ["Energy"],
  correlation_matrix: [[1]],
  last_updated: "2026-11-28T11:00:00+05:30",
};

function okResponse(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload } as Response;
}

function renderView(props: Partial<VisRenderProps> = {}) {
  const merged: VisRenderProps = { rows: [], ...props };
  return renderWithProviders(() => <CorrelationMatrixView {...merged} />);
}

const viewport = vi.hoisted(() => ({ narrow: false }));
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: query.includes("min-width: 640px") ? !viewport.narrow : false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}) as unknown as MediaQueryList);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  viewport.narrow = false;
});

afterEach(cleanup);

describe("CorrelationMatrixView", () => {
  test("renders a 3×3 heatmap with formatted values, titles and square cells", async () => {
    mockedFetch.mockResolvedValue(okResponse(PAYLOAD_A));
    renderView();

    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));

    const cells = screen.getAllByTestId("correlation-cell");
    expect(cells.map((cell) => cell.textContent)).toEqual([
      "1.00", "0.42", "-0.37",
      "0.42", "1.00", "0.05",
      "-0.37", "0.05", "1.00",
    ]);
    expect(cells[1]).toHaveAttribute("title", "IT × Banks = 0.42");
    expect(cells[2]).toHaveAttribute("title", "IT × Pharma = -0.37");
    expect(cells[4]).toHaveTextContent("1.00");
    expect(screen.getAllByTestId("correlation-row-label")).toHaveLength(3);
    expect(screen.getAllByTestId("correlation-row-label")[0]).toHaveAttribute("title", "IT");
    expect(screen.getAllByTestId("correlation-col-label")).toHaveLength(3);
    expect(screen.getAllByTestId("correlation-col-label")[0]).toHaveAttribute("title", "IT");
    expect(screen.getByTestId("correlation-count")).toHaveTextContent("3 × 3 sectors");
    expect(cells[0].style.backgroundColor).toBe(VIZ_SCALE[8]);
    expect(cells[0].style.color).toBe(TEXT);
  });

  test("column headers use distinct short codes while row labels keep full names", async () => {
    mockedFetch.mockResolvedValue(okResponse({
      ...PAYLOAD_A,
      sector_names: REAL_SECTOR_NAMES,
      correlation_matrix: REAL_SECTOR_NAMES.map(() => REAL_SECTOR_NAMES.map(() => 0.42)),
    }));
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(100));

    const columns = screen.getAllByTestId("correlation-col-label");
    expect(columns.map((column) => column.textContent)).toEqual(REAL_SECTOR_CODES);
    expect(new Set(columns.map((column) => column.textContent)).size).toBe(10);
    columns.forEach((column, index) => {
      expect(column).toHaveAttribute("title", REAL_SECTOR_NAMES[index]);
      expect(column).toHaveAttribute("aria-label", REAL_SECTOR_NAMES[index]);
      expect(column.className).not.toContain("truncate");
      expect(column.textContent).not.toContain("…");
    });
    expect(screen.getAllByTestId("correlation-row-label").map((row) => row.textContent)).toEqual(
      REAL_SECTOR_NAMES,
    );
    expect(screen.getAllByTestId("correlation-cell")[0]).toHaveTextContent("0.42");
  });

  test("uses the non-P&L diverging ramp and names it as correlation, not gain/loss", async () => {
    mockedFetch.mockResolvedValue(okResponse(PAYLOAD_A));
    renderView();

    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));
    const legend = screen.getByTestId("correlation-legend");
    expect(legend).toHaveTextContent("−1");
    expect(legend).toHaveTextContent("0");
    expect(legend).toHaveTextContent("+1");
    expect(screen.getByTestId("correlation-caption")).toHaveTextContent(
      "correlation, not gain/loss",
    );
    expect(correlationColor(-1)).toBe(VIZ_SCALE[0]);
    expect(correlationColor(0)).toBe(VIZ_SCALE[4]);
    expect(correlationColor(1)).toBe(VIZ_SCALE[8]);
  });

  test("shows a skeleton while loading", () => {
    mockedFetch.mockReturnValue(deferred<Response>().promise);
    renderView();

    expect(screen.getByTestId("correlation-loading")).toBeInTheDocument();
    expect(screen.getAllByTestId("correlation-skeleton")).toHaveLength(16);
    expect(screen.queryAllByTestId("correlation-cell")).toHaveLength(0);
  });

  test("shows an error and retries on a failed response", async () => {
    mockedFetch
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce(okResponse(PAYLOAD_A));
    renderView();

    await waitFor(() => expect(screen.getByTestId("correlation-error")).toBeInTheDocument());
    expect(screen.getByTestId("correlation-error")).toHaveTextContent("503");

    fireEvent.click(screen.getByTestId("correlation-retry"));
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("correlation-error")).not.toBeInTheDocument();
  });

  test("aborts the in-flight request on unmount without surfacing an error", () => {
    let signal: AbortSignal | undefined;
    mockedFetch.mockImplementation((_url, options) => {
      signal = options?.signal ?? undefined;
      return deferred<Response>().promise;
    });

    const { unmount } = renderView();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);

    unmount();
    expect(signal!.aborted).toBe(true);
  });

  test("a late first response cannot overwrite a newer refresh", async () => {
    const requests = [deferred<Response>(), deferred<Response>()];
    let count = 0;
    mockedFetch.mockImplementation(() => requests[count++]!.promise);
    renderView();

    await waitFor(() => expect(requests[0].promise).toBeDefined());
    fireEvent.click(screen.getByTestId("correlation-refresh"));
    expect(mockedFetch).toHaveBeenCalledTimes(2);

    requests[1]!.resolve(okResponse(PAYLOAD_B));
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(1));
    expect(screen.getByTestId("correlation-count")).toHaveTextContent("1 × 1 sectors");

    requests[0]!.resolve(okResponse(PAYLOAD_A));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getAllByTestId("correlation-cell")).toHaveLength(1);
    expect(screen.getByTestId("correlation-count")).toHaveTextContent("1 × 1 sectors");
  });

  test("renders the empty state for an empty matrix", async () => {
    mockedFetch.mockResolvedValue(okResponse({
      sectors: [],
      sector_names: [],
      correlation_matrix: [],
      last_updated: "2026-11-28T10:00:00+05:30",
    }));
    renderView();

    await waitFor(() => expect(screen.getByTestId("correlation-empty")).toBeInTheDocument());
    expect(screen.queryAllByTestId("correlation-cell")).toHaveLength(0);
  });

  test("treats a malformed payload as an error rather than a broken grid", async () => {
    mockedFetch.mockResolvedValue(okResponse({
      sector_names: ["IT", "Banks"],
      correlation_matrix: [[1]],
      last_updated: "2026-11-28T10:00:00+05:30",
    }));
    renderView();

    await waitFor(() => expect(screen.getByTestId("correlation-error")).toBeInTheDocument());
    expect(screen.getByTestId("correlation-error")).toHaveTextContent(
      "Unexpected sector correlation payload.",
    );
    expect(screen.queryAllByTestId("correlation-cell")).toHaveLength(0);
  });

  test("formats correlations without a negative zero", () => {
    expect(formatCorrelation(1)).toBe("1.00");
    expect(formatCorrelation(-0.0001)).toBe("0.00");
    expect(formatCorrelation(-1)).toBe("-1.00");
    expect(formatCorrelation(0.426)).toBe("0.43");
  });

  test("a currency switch refetches the new market, rejects the stale response and aborts on unmount", async () => {
    const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    let count = 0;
    let lastSignal: AbortSignal | undefined;
    mockedFetch.mockImplementation((_url, options) => {
      lastSignal = options?.signal ?? undefined;
      return requests[count++]!.promise;
    });

    let setCurrency!: (value: "INR" | "USD") => void;
    function Harness() {
      const [currency, set] = createSignal<"INR" | "USD">("INR");
      setCurrency = set;
      return <CorrelationMatrixView rows={[]} currency={currency()} />;
    }
    const { unmount } = renderWithProviders(() => <Harness />);

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
    expect(mockedFetch.mock.calls[0]![0]).toContain("market=india");

    setCurrency("USD");
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedFetch.mock.calls[1]![0]).toContain("market=america");

    requests[1]!.resolve(okResponse(PAYLOAD_B));
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(1));
    expect(screen.getByTestId("correlation-count")).toHaveTextContent("1 × 1 sectors");

    requests[0]!.resolve(okResponse(PAYLOAD_A));
    await Promise.resolve();
    expect(screen.getAllByTestId("correlation-cell")).toHaveLength(1);
    expect(screen.getByTestId("correlation-count")).toHaveTextContent("1 × 1 sectors");

    fireEvent.click(screen.getByTestId("correlation-refresh"));
    expect(mockedFetch).toHaveBeenCalledTimes(3);
    const pending = lastSignal!;
    expect(pending.aborted).toBe(false);
    unmount();
    expect(pending.aborted).toBe(true);
  });

  test("narrow toolbar keeps Refresh reachable on a second band and shortens the timestamp", async () => {
    viewport.narrow = true;
    mockedFetch.mockResolvedValue(okResponse(PAYLOAD_A));
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));

    const toolbar = screen.getByTestId("correlation-toolbar");
    expect(toolbar).toHaveClass("flex-col");
    expect(toolbar).not.toHaveClass("overflow-hidden");
    const refresh = screen.getByTestId("correlation-refresh");
    expect(toolbar).toContainElement(refresh);
    expect(refresh).toHaveClass("shrink-0");
    expect(refresh.parentElement).toBe(toolbar.lastElementChild);
    expect(screen.getByTestId("correlation-updated")).toHaveTextContent("as of 28 Nov");
    expect(formatAsOfShort("2026-11-28T10:00:00+05:30")).toBe("28 Nov");
  });

  test("narrow legend splits the scale from both captions without clipping", async () => {
    viewport.narrow = true;
    mockedFetch.mockResolvedValue(okResponse(PAYLOAD_A));
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));

    const legend = screen.getByTestId("correlation-legend");
    expect(legend).toHaveClass("flex-col");
    expect(legend).not.toHaveClass("overflow-hidden");
    const scale = screen.getByTestId("correlation-scale");
    const caption = screen.getByTestId("correlation-caption");
    const detail = screen.getByTestId("correlation-caption-detail");
    expect(scale).toBe(legend.firstElementChild);
    expect(screen.getByTestId("correlation-ramp").parentElement).toBe(scale);
    expect(caption.parentElement).toBe(detail.parentElement);
    expect(caption.parentElement).toBe(legend.lastElementChild);
    expect(caption).toHaveTextContent("correlation, not gain/loss");
    expect(detail).toHaveTextContent("−1 inverse · +1 co-movement");
    expect(legend).toHaveTextContent("−1");
    expect(legend).toHaveTextContent("+1");
  });

  test("matrix scrollport is a labelled focusable region with one visible scroll cue", async () => {
    mockedFetch.mockResolvedValue(okResponse(PAYLOAD_A));
    renderView();
    await waitFor(() => expect(screen.getAllByTestId("correlation-cell")).toHaveLength(9));

    const scroll = screen.getByTestId("correlation-scroll");
    expect(scroll).toHaveAttribute("role", "region");
    expect(scroll).toHaveAttribute("aria-label", "Sector correlation matrix (scrollable)");
    expect(scroll).toHaveAttribute("tabindex", "0");
    const cues = screen.getAllByTestId("correlation-scroll-cue");
    expect(cues).toHaveLength(1);
    expect(cues[0]).toBeVisible();
    expect(cues[0]).toHaveTextContent("horizontal");
  });
});

describe("shortSectorLabel", () => {
  test("gives the real sector set ten unique, ellipsis-free tokens", () => {
    const tokens = REAL_SECTOR_NAMES.map(shortSectorLabel);
    expect(tokens).toEqual(REAL_SECTOR_CODES);
    expect(new Set(tokens).size).toBe(10);
    expect(tokens.some((token) => token.includes("…"))).toBe(false);
    expect(tokens.every((token) => token.length <= 5)).toBe(true);
  });

  test("falls back to a deterministic, distinct acronym for unlisted sectors", () => {
    expect(shortSectorLabel("NIFTY FIN_SERVICE")).toBe("NFIN");
    const custom = shortSectorLabel("NIFTY CUSTOM");
    expect(shortSectorLabel(" nifty custom ")).toBe(custom);
    expect(custom).not.toContain("…");
    expect(custom).not.toBe(shortSectorLabel("NIFTY OTHER"));
  });
});

describe("normalizeCorrelationPayload", () => {
  test("rejects non-arrays, ragged rows and non-finite values", () => {
    expect(normalizeCorrelationPayload(null)).toBeNull();
    expect(normalizeCorrelationPayload({ sector_names: "IT" })).toBeNull();
    expect(normalizeCorrelationPayload({
      sector_names: ["A", "B"],
      correlation_matrix: [[1, 0.2]],
    })).toBeNull();
    expect(normalizeCorrelationPayload({
      sector_names: ["A", "B"],
      correlation_matrix: [[1, Number.NaN], [0, 1]],
    })).toBeNull();
  });

  test("keeps matrix order and copies the rows", () => {
    const matrix = [[1, 0.5], [0.5, 1]];
    const result = normalizeCorrelationPayload({
      sector_names: ["Banks", "IT"],
      correlation_matrix: matrix,
      last_updated: "now",
    });
    expect(result).toEqual({
      names: ["Banks", "IT"],
      matrix,
      lastUpdated: "now",
    });
    expect(result?.matrix).not.toBe(matrix);
  });
});
