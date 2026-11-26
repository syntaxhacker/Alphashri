// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { screen, within } from "@solidjs/testing-library";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import {
  BROKER_AUTH_ACTION,
  BROKER_AUTH_HREF,
  BROKER_AUTH_MESSAGE,
  BROKER_AUTH_MESSAGE_TESTID,
  BROKER_AUTH_NOTICE_TESTID,
  BROKER_AUTH_TITLE,
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
  test("renders title, description and action inside one warning alert", () => {
    renderWithProviders(() => <BrokerAuthNotice connectTestId="chain-connect" />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", BROKER_AUTH_NOTICE_TESTID);
    expect(alert).toHaveClass("flex-wrap");
    expect(within(alert).getByText(BROKER_AUTH_TITLE)).toBeInTheDocument();
    expect(alert.querySelector('[aria-hidden="true"]')).not.toBeNull();

    const message = within(alert).getByTestId(BROKER_AUTH_MESSAGE_TESTID);
    expect(message.textContent).toBe(BROKER_AUTH_MESSAGE);

    const action = within(alert).getByTestId("chain-connect");
    expect(action).toHaveAccessibleName(BROKER_AUTH_ACTION);
    expect(action).toHaveAttribute("href", BROKER_AUTH_HREF);
    expect(action).toHaveAttribute("href", "/settings");

    // The action is a flex sibling of the text block, never a second row
    // authored inside the description.
    const textBlock = message.parentElement?.parentElement;
    expect(textBlock).not.toContainElement(action);
    expect(action.parentElement?.previousElementSibling).toBe(textBlock);
  });

  test("has no input or row fallback and exactly one Settings link", () => {
    renderWithProviders(() => <BrokerAuthNotice connectTestId="chain-connect" />);

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
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
