// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UIProvider } from "@/ui";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";
import { PatternImageManager } from "./PatternImageManager";

vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: vi.fn(),
  uploadPatternImage: vi.fn(),
  deletePatternImage: vi.fn(),
}));

vi.mock("@/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ui")>();
  return { ...actual, showSuccess: vi.fn(), showError: vi.fn() };
});

import {
  fetchPatternImages,
  uploadPatternImage,
  deletePatternImage,
} from "@/api/patternImages";

const mockedFetch = vi.mocked(fetchPatternImages);
const mockedUpload = vi.mocked(uploadPatternImage);
const mockedDelete = vi.mocked(deletePatternImage);

function r(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => <UIProvider>{children}</UIProvider>,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupBrowserMocks();
});

afterEach(() => cleanup());

describe("PatternImageManager", () => {
  test("renders one card per pattern (19) with placeholders until images exist", async () => {
    mockedFetch.mockResolvedValue({});

    r(<PatternImageManager />);

    const cards = await screen.findAllByTestId(/^pattern-image-card-/);
    expect(cards).toHaveLength(19);
    expect(screen.getAllByTestId("pattern-image-placeholder")).toHaveLength(19);
  });

  test("uploading a file calls the API and refreshes the card", async () => {
    mockedFetch
      .mockResolvedValueOnce({})
      .mockResolvedValue({ falling_wedge: "/api/chart-patterns/image/falling_wedge" });
    mockedUpload.mockResolvedValue({
      pattern_id: "falling_wedge",
      url: "/api/chart-patterns/image/falling_wedge",
    });

    r(<PatternImageManager />);

    const input = await screen.findByTestId("pattern-image-upload-falling_wedge");
    const file = new File(["pixels"], "wedge.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith("falling_wedge", file));
    await waitFor(() =>
      expect(screen.getByTestId("pattern-image-falling_wedge")).toBeInTheDocument(),
    );
  });

  test("delete is disabled when no image exists", async () => {
    mockedFetch.mockResolvedValue({});
    r(<PatternImageManager />);

    const del = await screen.findByTestId("pattern-image-delete-falling_wedge");
    expect(del).toBeDisabled();
  });

  test("delete calls the API and returns the card to the placeholder", async () => {
    mockedFetch
      .mockResolvedValueOnce({ falling_wedge: "/api/chart-patterns/image/falling_wedge" })
      .mockResolvedValue({});
    mockedDelete.mockResolvedValue(undefined);

    r(<PatternImageManager />);

    const del = await screen.findByTestId("pattern-image-delete-falling_wedge");
    expect(del).toBeEnabled();
    fireEvent.click(del);

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("falling_wedge"));
    await waitFor(() =>
      expect(screen.getAllByTestId("pattern-image-placeholder").length).toBe(19),
    );
  });

  test("shows a per-card error when upload fails", async () => {
    mockedFetch.mockResolvedValue({});
    mockedUpload.mockRejectedValue(new Error("unsupported image type"));

    r(<PatternImageManager />);

    const input = await screen.findByTestId("pattern-image-upload-falling_wedge");
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByTestId("pattern-image-error-falling_wedge")).toHaveTextContent(
      "unsupported image type",
    );
  });

  test("shows a load error when the images request fails", async () => {
    mockedFetch.mockRejectedValue(new Error("boom"));
    r(<PatternImageManager />);

    expect(await screen.findByTestId("pattern-image-manager-error")).toHaveTextContent("boom");
  });

  test("lists uploaded images as <img> with Replace, others with Upload", async () => {
    mockedFetch.mockResolvedValue({ falling_wedge: "/img/wedge.png" });
    r(<PatternImageManager />);

    await screen.findByTestId("pattern-image-falling_wedge");
    const withImage = within(screen.getByTestId("pattern-image-card-falling_wedge"));
    expect(withImage.getByTestId("pattern-image-falling_wedge").tagName).toBe("IMG");
    expect(withImage.getByRole("button", { name: /replace/i })).toBeInTheDocument();

    const withoutImage = within(screen.getByTestId("pattern-image-card-rising_wedge"));
    expect(
      withoutImage.queryByTestId("pattern-image-rising_wedge"),
    ).not.toBeInTheDocument();
    expect(
      withoutImage.getByTestId("pattern-image-placeholder"),
    ).toBeInTheDocument();
    expect(withoutImage.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });

  test("shows a per-card error when delete fails and keeps the image", async () => {
    mockedFetch.mockResolvedValue({ falling_wedge: "/img/wedge.png" });
    mockedDelete.mockRejectedValue(new Error("delete boom"));

    r(<PatternImageManager />);

    const del = await screen.findByTestId("pattern-image-delete-falling_wedge");
    expect(del).toBeEnabled();
    fireEvent.click(del);

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("falling_wedge"));
    expect(await screen.findByTestId("pattern-image-error-falling_wedge")).toHaveTextContent(
      "delete boom",
    );
    // Failed clear keeps the uploaded image wired to the card.
    expect(screen.getByTestId("pattern-image-falling_wedge")).toBeInTheDocument();
  });

  test("refreshes the image map after a successful delete (clear wiring)", async () => {
    mockedFetch
      .mockResolvedValueOnce({ falling_wedge: "/img/wedge.png" })
      .mockResolvedValueOnce({});
    mockedDelete.mockResolvedValue(undefined);

    r(<PatternImageManager />);

    fireEvent.click(await screen.findByTestId("pattern-image-delete-falling_wedge"));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("falling_wedge"));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  });
});
