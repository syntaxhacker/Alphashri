// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { BotCardStrip } from "./BotCardStrip";
import type { BotSummary } from "../../types/paperTrading";

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
    render(() => <BotCardStrip bots={[]} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.queryByTestId(/^bot-card-/)).toBeNull();
  });

  it("displays bot name", () => {
    render(() => <BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.getByText("ORB Bot")).toBeInTheDocument();
  });

  it("displays position count", () => {
    render(() => <BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.getByText(/2 position/)).toBeInTheDocument();
  });

  it("displays singular when position_count is 1", () => {
    const bot = { ...baseBot, position_count: 1 };
    render(() => <BotCardStrip bots={[bot]} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.getByText("1 position")).toBeInTheDocument();
  });

  it("displays zero positions", () => {
    const bot = { ...baseBot, position_count: 0 };
    render(() => <BotCardStrip bots={[bot]} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.getByText("0 positions")).toBeInTheDocument();
  });

  it("calls onSelect when active bot is clicked", async () => {
    const onSelect = vi.fn();
    render(() => <BotCardStrip bots={[baseBot]} selectedBotId={null} onSelect={onSelect} />, {
    });
    await fireEvent.click(screen.getByTestId("bot-card-1"));
    expect(onSelect).toHaveBeenCalledWith("1");
  });

  it("does not call onSelect when inactive bot is clicked", async () => {
    const onSelect = vi.fn();
    const inactiveBot = { ...baseBot, is_active: false };
    render(() => <BotCardStrip bots={[inactiveBot]} selectedBotId={null} onSelect={onSelect} />, {
    });
    await fireEvent.click(screen.getByTestId("bot-card-1"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not call onSelect when already selected bot is clicked", async () => {
    const onSelect = vi.fn();
    render(() => <BotCardStrip bots={[baseBot]} selectedBotId="1" onSelect={onSelect} />, {
    });
    await fireEvent.click(screen.getByTestId("bot-card-1"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("handles multiple bots", () => {
    const bots: BotSummary[] = [baseBot, { ...baseBot, id: "2", name: "SR Bot", running: false }];
    render(() => <BotCardStrip bots={bots} selectedBotId={null} onSelect={vi.fn()} />, {
    });
    expect(screen.getByTestId("bot-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("bot-card-2")).toBeInTheDocument();
  });
});
