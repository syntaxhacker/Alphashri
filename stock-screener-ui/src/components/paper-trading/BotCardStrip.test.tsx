// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BotCardStrip } from "./BotCardStrip";
import type { BotSummary } from "../../types/paperTrading";
import { TestWrapper } from "../../test/test-utils";

describe("BotCardStrip", () => {
  const baseBot: BotSummary = {
    id: "1",
    name: "ORB Bot",
    running: true,
    is_active: true,
    position_count: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing visible when bots array is empty", () => {
    render(<BotCardStrip bots={[]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.queryByTestId(/^bot-card-/)).toBeNull();
  });

  it("renders bot cards when bots provided", () => {
    render(<BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("bot-card-1")).toBeInTheDocument();
  });

  it("displays bot name", () => {
    render(<BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText("ORB Bot")).toBeInTheDocument();
  });

  it("displays position count", () => {
    render(<BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText(/2 position/)).toBeInTheDocument();
  });

  it("displays singular when position_count is 1", () => {
    const bot = { ...baseBot, position_count: 1 };
    render(<BotCardStrip bots={[bot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText("1 position")).toBeInTheDocument();
  });

  it("displays zero positions", () => {
    const bot = { ...baseBot, position_count: 0 };
    render(<BotCardStrip bots={[bot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByText("0 positions")).toBeInTheDocument();
  });

  it("calls onSelect when active bot is clicked", () => {
    const onSelect = vi.fn();
    render(<BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={onSelect} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("bot-card-1").click();
    expect(onSelect).toHaveBeenCalledWith("1");
  });

  it("does not call onSelect when inactive bot is clicked", () => {
    const onSelect = vi.fn();
    const inactiveBot = { ...baseBot, is_active: false };
    render(<BotCardStrip bots={[inactiveBot]} selectedBotId={null} onSelect={onSelect} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("bot-card-1").click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not call onSelect when already selected bot is clicked", () => {
    const onSelect = vi.fn();
    render(<BotCardStrip bots={[baseBot]} selectedBotId="1" onSelect={onSelect} />, {
      wrapper: TestWrapper,
    });
    screen.getByTestId("bot-card-1").click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders running indicator for active running bot", () => {
    const runningBot = { ...baseBot, running: true, is_active: true };
    render(<BotCardStrip bots={[runningBot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("bot-card-1")).toBeInTheDocument();
  });

  it("renders stopped indicator for non-running bot", () => {
    const stoppedBot = { ...baseBot, running: false };
    render(<BotCardStrip bots={[stoppedBot]} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("bot-card-1")).toBeInTheDocument();
  });

  it("handles multiple bots", () => {
    const bots: BotSummary[] = [baseBot, { ...baseBot, id: "2", name: "SR Bot", running: false }];
    render(<BotCardStrip bots={bots} selectedBotId={null} onSelect={vi.fn()} />, {
      wrapper: TestWrapper,
    });
    expect(screen.getByTestId("bot-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("bot-card-2")).toBeInTheDocument();
  });
});
