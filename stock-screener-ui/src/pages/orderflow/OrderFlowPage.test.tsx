// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderFlowPage } from "./OrderFlowPage";
import { getBrokerStatus } from "@/api/brokers";

vi.mock("@/api/brokers", () => ({
  getBrokerStatus: vi.fn(),
  connectUpstox: vi.fn(),
}));

const mockStatus = vi.mocked(getBrokerStatus);

beforeEach(() => {
  vi.clearAllMocks();
  mockStatus.mockResolvedValue({ connected: true, broker: "upstox", expires_in_hours: 12, expires_at: null });
  // Prevent happy-dom from fetching the iframe src during tests.
  const happyDOM = (window as unknown as { happyDOM?: { settings: Record<string, unknown> } }).happyDOM;
  if (happyDOM) happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function iframeParams(): Promise<URLSearchParams> {
  const iframe = (await screen.findByTestId("orderflow-iframe")) as HTMLIFrameElement;
  const url = new URL(iframe.getAttribute("src") || "", "http://localhost");
  return url.searchParams;
}

describe("OrderFlowPage", () => {
  test("embeds the visualizer with bridge url, symbol and autoconnect", async () => {
    render(<OrderFlowPage />);
    const iframe = await screen.findByTestId("orderflow-iframe");
    expect(iframe.getAttribute("src")).toContain("/orderflow/index.html");

    const params = await iframeParams();
    expect(params.get("ws")).toBe("ws://localhost:8765/ws/orderflow");
    expect(params.get("symbol")).toBe("RELIANCE");
    expect(params.get("tick")).toBe("0.05");
    expect(params.get("autoconnect")).toBe("1");
  });

  test("connect reloads the iframe with the entered symbol", async () => {
    const user = userEvent.setup();
    render(<OrderFlowPage />);
    await screen.findByTestId("orderflow-iframe");

    await user.clear(screen.getByTestId("orderflow-symbol"));
    await user.type(screen.getByTestId("orderflow-symbol"), "tcs");
    await user.click(screen.getByTestId("orderflow-connect"));

    expect((await iframeParams()).get("symbol")).toBe("TCS");
  });

  test("disables autoconnect and offers broker connect when disconnected", async () => {
    mockStatus.mockResolvedValue({ connected: false, broker: "upstox", expires_in_hours: null, expires_at: null });
    render(<OrderFlowPage />);

    expect(await screen.findByTestId("orderflow-broker-warning")).toBeInTheDocument();
    expect(screen.getByTestId("orderflow-connect-broker")).toBeInTheDocument();
    expect((await iframeParams()).get("autoconnect")).toBe("0");
  });
});
