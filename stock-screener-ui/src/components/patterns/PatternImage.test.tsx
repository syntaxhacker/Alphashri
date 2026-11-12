// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { PatternImage } from "./PatternImage";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/patterns/solidUiMock");
  return mockSolidUi();
});

afterEach(() => cleanup());

describe("PatternImage", () => {
  test("renders the <img> when a URL exists", () => {
    render(() => (
      <PatternImage
        patternId="falling_wedge"
        images={{ falling_wedge: "/api/chart-patterns/image/falling_wedge" }}
      />
    ));

    const img = screen.getByTestId("pattern-image-falling_wedge");
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.queryByTestId("pattern-image-placeholder")).toBeNull();
  });

  test("renders the placeholder when no image exists", () => {
    render(() => <PatternImage patternId="falling_wedge" images={{}} />);

    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-image-placeholder-label")).toHaveTextContent(
      "Falling Wedge",
    );
    expect(screen.queryByTestId("pattern-image-falling_wedge")).toBeNull();
  });

  test("falls back to the placeholder when the image fails to load", () => {
    render(() => <PatternImage patternId="falling_wedge" images={{ falling_wedge: "/broken" }} />);

    fireEvent.error(screen.getByTestId("pattern-image-falling_wedge"));

    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();
    expect(screen.queryByTestId("pattern-image-falling_wedge")).toBeNull();
  });

  test("uses the raw id as the label for unknown patterns", () => {
    render(() => <PatternImage patternId="mystery_shape" images={{}} />);
    expect(screen.getByTestId("pattern-image-placeholder-label")).toHaveTextContent(
      "mystery_shape",
    );
  });

  test("hides the placeholder label in tile mode", () => {
    render(() => <PatternImage patternId="falling_wedge" images={{}} showPlaceholderLabel={false} />);
    const label = screen.getByTestId("pattern-image-placeholder-label");
    expect(label).toHaveTextContent("Falling Wedge");
    expect(label).toHaveStyle({ display: "none" });
  });

  test("uses custom alt text for the rendered image", () => {
    render(() => (
      <PatternImage
        patternId="falling_wedge"
        images={{ falling_wedge: "/img/wedge.png" }}
        alt="Wedge example"
      />
    ));

    const img = screen.getByTestId("pattern-image-falling_wedge");
    expect(img).toHaveAttribute("alt", "Wedge example");
    expect(img).toHaveAttribute("src", "/img/wedge.png");
  });

  test("uses custom alt text for the placeholder label", () => {
    render(() => <PatternImage patternId="falling_wedge" images={{}} alt="Custom placeholder" />);

    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-image-placeholder-label")).toHaveTextContent(
      "Custom placeholder",
    );
  });

  test("recovers the image when the url prop changes after an error", () => {
    let setImages!: (images: Record<string, string>) => void;
    render(() => {
      const [images, _setImages] = createSignal<Record<string, string>>({ falling_wedge: "/broken" });
      setImages = _setImages;
      return <PatternImage patternId="falling_wedge" images={images()} />;
    });

    fireEvent.error(screen.getByTestId("pattern-image-falling_wedge"));
    expect(screen.getByTestId("pattern-image-placeholder")).toBeInTheDocument();

    setImages({ falling_wedge: "/fixed.png" });
    const img = screen.getByTestId("pattern-image-falling_wedge");
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "/fixed.png");
    expect(screen.queryByTestId("pattern-image-placeholder")).not.toBeInTheDocument();
  });
});
