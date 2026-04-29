// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotification } from "./useNotification";

// Mock Mantine notifications
const mockNotifications = vi.hoisted(() => ({
  show: vi.fn(),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: mockNotifications,
}));

describe("useNotification", () => {
  beforeEach(() => {
    mockNotifications.show.mockClear();
  });

  it("returns show, success, and error functions", () => {
    const { result } = renderHook(() => useNotification());

    expect(typeof result.current.show).toBe("function");
    expect(typeof result.current.success).toBe("function");
    expect(typeof result.current.error).toBe("function");
  });

  describe("show", () => {
    it("shows notification with title and message", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.show({ title: "Test", message: "Test message" });
      });

      expect(mockNotifications.show).toHaveBeenCalledWith({
        title: "Test",
        message: "Test message",
        color: "blue",
      });
    });

    it("uses blue as default color", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.show({ title: "Test", message: "Message" });
      });

      expect(mockNotifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ color: "blue" }),
      );
    });

    it("uses custom color when provided", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.show({ title: "Test", message: "Message", color: "red" });
      });

      expect(mockNotifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ color: "red" }),
      );
    });

    it("accepts all supported colors", () => {
      const { result } = renderHook(() => useNotification());
      const colors = [
        "blue",
        "green",
        "red",
        "yellow",
        "orange",
        "violet",
        "indigo",
        "pink",
        "gray",
        "dark",
        "teal",
      ];

      colors.forEach((color) => {
        act(() => {
          result.current.show({ title: "Test", message: "Message", color });
        });
        expect(mockNotifications.show).toHaveBeenCalledWith(expect.objectContaining({ color }));
        mockNotifications.show.mockClear();
      });
    });
  });

  describe("success", () => {
    it("shows notification with green color", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.success("Success Title", "Success message");
      });

      expect(mockNotifications.show).toHaveBeenCalledWith({
        title: "Success Title",
        message: "Success message",
        color: "green",
      });
    });

    it("forwards title and message correctly", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.success("Congratulations!", "Operation completed successfully");
      });

      expect(mockNotifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Congratulations!",
          message: "Operation completed successfully",
        }),
      );
    });
  });

  describe("error", () => {
    it("shows notification with red color", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.error("Error Title", "Error message");
      });

      expect(mockNotifications.show).toHaveBeenCalledWith({
        title: "Error Title",
        message: "Error message",
        color: "red",
      });
    });

    it("forwards title and message correctly", () => {
      const { result } = renderHook(() => useNotification());

      act(() => {
        result.current.error("Failed", "Something went wrong");
      });

      expect(mockNotifications.show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed",
          message: "Something went wrong",
        }),
      );
    });
  });

  describe("function stability", () => {
    it("functions remain stable across re-renders", () => {
      const { result, rerender } = renderHook(() => useNotification());

      const show1 = result.current.show;
      const success1 = result.current.success;
      const error1 = result.current.error;

      rerender();

      expect(result.current.show).toBe(show1);
      expect(result.current.success).toBe(success1);
      expect(result.current.error).toBe(error1);
    });
  });
});
