// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { screen } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import {
  BROKER_AUTH_ACTION,
  BROKER_AUTH_HREF,
  BROKER_AUTH_MESSAGE,
  BROKER_AUTH_MESSAGE_TESTID,
  BrokerAuthNotice,
  isBrokerAuthKind,
} from "./BrokerAuthNotice";

describe("isBrokerAuthKind", () => {
  test("accepts only the two typed unauthorized kinds", () => {
    expect(isBrokerAuthKind("auth")).toBe(true);
    expect(isBrokerAuthKind("unauthorized")).toBe(true);
    for (const kind of [null, undefined, "", "AUTH", "upstream", "500", "no token"]) {
      expect(isBrokerAuthKind(kind)).toBe(false);
    }
  });
});

describe("BrokerAuthNotice", () => {
  test("renders the canonical message, a Settings link and the caller's connect testid", () => {
    renderWithProviders(() => <BrokerAuthNotice connectTestId="chain-connect" />);

    const message = screen.getByTestId(BROKER_AUTH_MESSAGE_TESTID);
    expect(message).toHaveTextContent(BROKER_AUTH_MESSAGE);
    expect(message).toHaveTextContent("Upstox connection required");

    const action = screen.getByTestId("chain-connect");
    expect(action).toHaveAccessibleName(BROKER_AUTH_ACTION);
    expect(action).toHaveAttribute("href", BROKER_AUTH_HREF);
    expect(action).toHaveAttribute("href", "/settings");

    // The same group carries both halves; a panel can render the copy without
    // a second, independently authored action string.
    expect(message.parentElement).toContainElement(action);
  });

  test("honours per-surface testids and the larger text size", () => {
    renderWithProviders(() => (
      <BrokerAuthNotice connectTestId="positioning-connect" messageTestId="positioning-auth" size="sm" />
    ));

    expect(screen.getByTestId("positioning-auth")).toHaveClass("text-ui-label");
    expect(screen.getByTestId("positioning-connect")).toHaveClass("text-ui-label");
    expect(screen.queryByTestId(BROKER_AUTH_MESSAGE_TESTID)).not.toBeInTheDocument();
    expect(screen.getByTestId("positioning-connect")).toHaveTextContent(BROKER_AUTH_ACTION);
  });

  test("defaults to the micro text tier and an xs link", () => {
    renderWithProviders(() => <BrokerAuthNotice connectTestId="analytics-reconnect" />);

    expect(screen.getByTestId(BROKER_AUTH_MESSAGE_TESTID)).toHaveClass("text-ui-micro");
    expect(screen.getByTestId("analytics-reconnect")).toHaveClass("text-ui-micro");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
