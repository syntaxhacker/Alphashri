// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CompactPage, CompactPanel, CompactStat, CompactStatGrid } from "./compact";

vi.mock("@/ui", () => ({
  Group: ({ children, ...props }: any) => (
    <div data-testid="group" {...props}>
      {children}
    </div>
  ),
  Box: ({ children, ...props }: any) => (
    <div data-testid="box" {...props}>
      {children}
    </div>
  ),
  Paper: ({ children, ...props }: any) => (
    <div data-testid="paper" {...props}>
      {children}
    </div>
  ),
  SimpleGrid: ({ children, ...props }: any) => (
    <div data-testid="simple-grid" {...props}>
      {children}
    </div>
  ),
  Stack: ({ children, ...props }: any) => (
    <div data-testid="stack" {...props}>
      {children}
    </div>
  ),
  Text: ({ children, ...props }: any) => (
    <span data-testid="text" {...props}>
      {children}
    </span>
  ),
  Title: ({ children, ...props }: any) => (
    <h2 data-testid="title" {...props}>
      {children}
    </h2>
  ),
  Card: ({ children, ...props }: any) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();

  vi.clearAllMocks();
});

describe("CompactPage", () => {
  it("renders children", () => {
    render(<CompactPage>Content</CompactPage>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders string title", () => {
    render(<CompactPage title="My Page">Content</CompactPage>);
    expect(screen.getByText("My Page")).toBeInTheDocument();
  });

  it("renders string description", () => {
    render(<CompactPage description="A description">Content</CompactPage>);
    expect(screen.getByText("A description")).toBeInTheDocument();
  });

  it("renders actions", () => {
    render(<CompactPage actions={<button>Action</button>}>Content</CompactPage>);
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("renders without header when no title, description, or actions", () => {
    const { container } = render(<CompactPage>Content</CompactPage>);
    expect(container.querySelector('[data-testid="group"]')).toBeNull();
  });

  it("renders ReactNode title directly", () => {
    render(<CompactPage title={<span>Custom Title</span>}>Content</CompactPage>);
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });
});

describe("CompactPanel", () => {
  it("renders children", () => {
    render(<CompactPanel>Panel Content</CompactPanel>);
    expect(screen.getByText("Panel Content")).toBeInTheDocument();
  });

  it("renders string title", () => {
    render(<CompactPanel title="Panel Title">Content</CompactPanel>);
    expect(screen.getByText("Panel Title")).toBeInTheDocument();
  });

  it("renders string description", () => {
    render(<CompactPanel description="Panel desc">Content</CompactPanel>);
    expect(screen.getByText("Panel desc")).toBeInTheDocument();
  });

  it("renders action", () => {
    render(<CompactPanel action={<button>Action</button>}>Content</CompactPanel>);
    expect(screen.getByText("Action")).toBeInTheDocument();
  });

  it("sets testId", () => {
    render(<CompactPanel testId="my-panel">Content</CompactPanel>);
    expect(screen.getByText("Content").closest('[data-testid="my-panel"]')).toBeInTheDocument();
  });

  it("renders without header when no title, description, or action", () => {
    const { container } = render(<CompactPanel>Content</CompactPanel>);
    expect(container.querySelector('[data-testid="group"]')).toBeNull();
  });
});

describe("CompactStat", () => {
  it("renders label and value", () => {
    render(<CompactStat label="Score" value={95} />);
    expect(screen.getByText("Score")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("renders string hint", () => {
    render(<CompactStat label="PnL" value={1000} hint="+5%" />);
    expect(screen.getByText("+5%")).toBeInTheDocument();
  });

  it("renders number hint", () => {
    render(<CompactStat label="Count" value={10} hint={5} />);
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders ReactNode hint", () => {
    render(<CompactStat label="Status" value="OK" hint={<em>good</em>} />);
    expect(screen.getByText("good")).toBeInTheDocument();
  });

  it("does not render hint when not provided", () => {
    const { container } = render(<CompactStat label="Label" value="Val" />);
    const texts = container.querySelectorAll('[data-testid="text"]');
    expect(texts.length).toBe(2);
  });
});

describe("CompactStatGrid", () => {
  it("renders children", () => {
    render(
      <CompactStatGrid>
        <div>Stat 1</div>
        <div>Stat 2</div>
      </CompactStatGrid>,
    );
    expect(screen.getByText("Stat 1")).toBeInTheDocument();
    expect(screen.getByText("Stat 2")).toBeInTheDocument();
  });
});
