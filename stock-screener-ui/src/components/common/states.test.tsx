// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import type { JSX } from "solid-js";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { InlineLoader, EmptyState, ErrorAlert } from "./states";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Wrapper({ children }: { children: JSX.Element }) {
  return <UIProvider>{children}</UIProvider>;
}

describe("InlineLoader", () => {
  it("renders a progressbar", () => {
    render(() => (<InlineLoader />), { wrapper: Wrapper });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(() => (<EmptyState title="No data" description="Try again later" />), { wrapper: Wrapper });
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Try again later")).toBeInTheDocument();
  });

  it("renders without description", () => {
    render(() => (<EmptyState title="Empty" />), { wrapper: Wrapper });
    expect(screen.getByText("Empty")).toBeInTheDocument();
  });
});

describe("ErrorAlert", () => {
  it("renders error message", () => {
    render(() => (<ErrorAlert message="Something went wrong" />), { wrapper: Wrapper });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
