// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { MembersButton } from "./MembersButton";

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("MembersButton", () => {
  afterEach(() => cleanup());

  test("renders an index-members button keyed by its testId", () => {
    const onShowMembers = vi.fn();
    r(<MembersButton symbol="NIFTY" testId="patterns-members-NIFTY" onShowMembers={onShowMembers} />);

    const button = screen.getByTestId("patterns-members-NIFTY");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "View NIFTY members");
    expect(button).toHaveAttribute("aria-label", "View NIFTY members");
    expect(button).toHaveAttribute("data-testid", "patterns-members-NIFTY");
    expect(screen.getByRole("button", { name: "View NIFTY members" })).toBeInTheDocument();
    expect(screen.getByTestId("patterns-members-NIFTY").querySelector("svg")).not.toBeNull();
  });

  test("fires onShowMembers with the symbol and stops propagation", async () => {
    const onShowMembers = vi.fn();
    const parentOnClick = vi.fn();
    r(
      <div data-testid="members-wrap" onClick={parentOnClick}>
        <MembersButton symbol="SENSEX" testId="cb-members" onShowMembers={onShowMembers} />
      </div>,
    );

    await fireEvent.click(screen.getByTestId("cb-members"));
    expect(onShowMembers).toHaveBeenCalledTimes(1);
    expect(onShowMembers).toHaveBeenCalledWith("SENSEX");
    expect(parentOnClick).not.toHaveBeenCalled();
  });

  test("uses the default size 16 / icon 12", () => {
    r(<MembersButton symbol="NIFTY" testId="default-members" onShowMembers={vi.fn()} />);
    const svg = screen.getByTestId("default-members").querySelector("svg");
    expect(svg).toHaveAttribute("width", "12");
    expect(svg).toHaveAttribute("height", "12");
  });

  test("applies custom size and iconSize", () => {
    r(
      <MembersButton
        symbol="BANKNIFTY"
        testId="sized-members"
        onShowMembers={vi.fn()}
        size={14}
        iconSize={11}
      />,
    );
    const svg = screen.getByTestId("sized-members").querySelector("svg");
    expect(svg).toHaveAttribute("width", "11");
    expect(svg).toHaveAttribute("height", "11");
  });

});
