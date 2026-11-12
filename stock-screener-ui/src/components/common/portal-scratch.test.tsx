import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider, Portal } from "@/ui";

function X() {
  return (
    <Portal>
      <div data-testid="portaled-x">x</div>
    </Portal>
  );
}

afterEach(() => {
  cleanup();
  console.log("BODY after cleanup:", document.body.innerHTML);
});

describe("portal cleanup", () => {
  test("mounts portal content", () => {
    render(() => <X />);
    expect(screen.getByTestId("portaled-x")).toBeInTheDocument();
  });

  test("portal content is gone after cleanup", () => {
    render(() => <X />);
    expect(screen.getByTestId("portaled-x")).toBeInTheDocument();
  });
});
