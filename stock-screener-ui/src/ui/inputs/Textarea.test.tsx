// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { Textarea } from "./Textarea";

afterEach(cleanup);

describe("Textarea — form error accessibility", () => {
  test("a string error is associated with the textarea itself", () => {
    render(() => <Textarea data-testid="ta" id="notes" error="Notes are required" />);
    const area = screen.getByTestId("ta");
    const message = screen.getByText("Notes are required");

    expect(area.tagName).toBe("TEXTAREA");
    expect(message.id).toBe("notes-error");
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(area).toHaveAttribute("aria-describedby", message.id);
  });

  test("a JSX error renders as elements, never [object Object]", () => {
    const { container } = render(() => (
      <Textarea data-testid="ta" id="notes" error={<span data-testid="jsx-error"><b>Invalid</b> notes</span>} />
    ));
    const area = screen.getByTestId("ta");
    const message = screen.getByTestId("jsx-error");

    expect(message.tagName).toBe("SPAN");
    expect(message.querySelector("b")).not.toBeNull();
    expect(container.textContent).not.toContain("[object Object]");
    expect(area).toHaveAttribute("aria-invalid", "true");
    expect(area).toHaveAttribute("aria-describedby", message.parentElement!.id);
  });

  test("a description is described by the textarea with aria-invalid false", () => {
    render(() => <Textarea data-testid="ta" id="notes" description="Max 500 characters" />);
    const area = screen.getByTestId("ta");

    expect(area).toHaveAttribute("aria-invalid", "false");
    expect(area).toHaveAttribute("aria-describedby", "notes-error");
    expect(screen.getByText("Max 500 characters")).toHaveAttribute("id", "notes-error");
  });
});
