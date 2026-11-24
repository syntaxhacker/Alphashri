// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notifications, showError, showNotification, showSuccess } from "./notifications";

const toasts = () => Array.from(document.querySelectorAll('[data-role="toast"]'));

const typeFor = (message: string) => {
  const toast = toasts().find((node) => node.textContent?.includes(message));
  return Array.from(toast?.classList ?? []).find((name) => name.startsWith("sn-type-"));
};

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("notifications", () => {
  it("hosts a real toaster while preserving the wrapped app", () => {
    const { container } = render(() => (
      <Notifications>
        <div data-testid="app-child">app</div>
      </Notifications>
    ));

    expect(container.querySelector(".sn-toaster")).not.toBeNull();
    expect(screen.getByTestId("app-child")).toHaveTextContent("app");
    expect(toasts()).toHaveLength(0);
  });

  it("showNotification opens a real toast with the message and a live region", () => {
    render(() => <Notifications />);

    showNotification({ message: "Screener refreshed" });

    const toast = toasts()[0];
    expect(toast).toBeDefined();
    expect(toast).toHaveTextContent("Screener refreshed");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(typeFor("Screener refreshed")).toBe("sn-type-default");
  });

  it("maps colour names to toast severity types", () => {
    render(() => <Notifications />);

    showNotification({ message: "Saved", color: "success" });
    showNotification({ message: "Broken", color: "danger" });
    showNotification({ message: "Careful", color: "warning" });
    showNotification({ message: "FYI", color: "info" });

    expect(typeFor("Saved")).toBe("sn-type-success");
    expect(typeFor("Broken")).toBe("sn-type-error");
    expect(typeFor("Careful")).toBe("sn-type-warning");
    expect(typeFor("FYI")).toBe("sn-type-info");
  });

  it("maps the primary colour alias to the info tone", () => {
    render(() => <Notifications />);

    showNotification({ message: "Highlight", color: "primary" });

    expect(typeFor("Highlight")).toBe("sn-type-info");
  });

  it("showSuccess and showError use their tones and fall back to the title", () => {
    render(() => <Notifications />);

    showSuccess("Saved", "");
    showError("Failed", "Details");

    expect(typeFor("Saved")).toBe("sn-type-success");
    expect(typeFor("Details")).toBe("sn-type-error");
    expect(toasts()).toHaveLength(2);
  });

  it("auto-closes only once the configured duration elapses", () => {
    vi.useFakeTimers();
    render(() => <Notifications />);

    showNotification({ message: "Temporary", autoClose: 1000 });
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(400);
    expect(toasts()).toHaveLength(0);
  });

  it("autoClose:false keeps the toast open when timers advance", () => {
    vi.useFakeTimers();
    render(() => <Notifications />);

    showNotification({ message: "Sticky", autoClose: false });
    vi.advanceTimersByTime(10_000);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toHaveTextContent("Sticky");
  });

  it("dismiss removes the toast from the DOM", () => {
    vi.useFakeTimers();
    render(() => <Notifications />);

    showNotification({ message: "Dismiss me", autoClose: false });
    expect(toasts()).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("Close notification"));
    vi.advanceTimersByTime(400);

    expect(toasts()).toHaveLength(0);
  });
});
