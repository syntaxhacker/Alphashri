import { describe, expect, test } from "vitest";
import {
  ClosePositionCommand,
  CommandHistory,
  ModifyStopLossCommand,
  ModifyTakeProfitCommand,
  PositionStore,
} from "./TradeCommand";
import type { PaperPosition } from "../../types/paperTrading";

function makePosition(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    entry_price: 2500,
    current_price: 2500,
    entry_time: "2026-09-10T09:15:00Z",
    stop_loss: 2400,
    take_profit: 2700,
    pnl: 0,
    pnl_pct: 0,
    margin_used: 0,
    order_id: "order-1",
    strategy_id: 1,
    strategy_name: "ORB",
    ...overrides,
  };
}

describe("ModifyStopLossCommand", () => {
  test("execute updates stop_loss only and undo restores it", async () => {
    const store = new PositionStore([makePosition()]);
    const cmd = new ModifyStopLossCommand(store, makePosition(), 2450);

    expect(cmd.canUndo()).toBe(false);
    await expect(cmd.execute()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2450);
    expect(store.get("RELIANCE")?.take_profit).toBe(2700);
    expect(cmd.canUndo()).toBe(true);

    await expect(cmd.undo()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);
    expect(store.get("RELIANCE")?.take_profit).toBe(2700);
    expect(cmd.canUndo()).toBe(false);
  });

  test("name carries symbol and old -> new values", () => {
    const store = new PositionStore();
    const cmd = new ModifyStopLossCommand(store, makePosition(), 2450);
    expect(cmd.name).toBe("Modify SL RELIANCE: 2400 → 2450");
  });

  test("execute fails when the position is missing", async () => {
    const store = new PositionStore();
    const cmd = new ModifyStopLossCommand(store, makePosition(), 2450);
    await expect(cmd.execute()).resolves.toBe(false);
    expect(cmd.canUndo()).toBe(false);
  });

  test("undo fails before a successful execute", async () => {
    const store = new PositionStore([makePosition()]);
    const cmd = new ModifyStopLossCommand(store, makePosition(), 2450);
    await expect(cmd.undo()).resolves.toBe(false);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);
  });
});

describe("ModifyTakeProfitCommand", () => {
  test("execute updates take_profit only and undo restores it", async () => {
    const store = new PositionStore([makePosition()]);
    const cmd = new ModifyTakeProfitCommand(store, makePosition(), 2750);

    expect(cmd.canUndo()).toBe(false);
    await expect(cmd.execute()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.take_profit).toBe(2750);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);
    expect(cmd.canUndo()).toBe(true);

    await expect(cmd.undo()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.take_profit).toBe(2700);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);
    expect(cmd.canUndo()).toBe(false);
  });

  test("name carries symbol and old -> new values", () => {
    const store = new PositionStore();
    const cmd = new ModifyTakeProfitCommand(store, makePosition(), 2750);
    expect(cmd.name).toBe("Modify TP RELIANCE: 2700 → 2750");
  });

  test("execute fails when the position is missing", async () => {
    const store = new PositionStore();
    const cmd = new ModifyTakeProfitCommand(store, makePosition(), 2750);
    await expect(cmd.execute()).resolves.toBe(false);
    expect(cmd.canUndo()).toBe(false);
  });
});

describe("ModifyLevelCommand shared base", () => {
  test("SL and TP commands are independent", async () => {
    const store = new PositionStore([makePosition()]);
    const sl = new ModifyStopLossCommand(store, makePosition(), 2450);
    const tp = new ModifyTakeProfitCommand(store, makePosition(), 2750);

    await sl.execute();
    await tp.execute();
    expect(store.get("RELIANCE")?.stop_loss).toBe(2450);
    expect(store.get("RELIANCE")?.take_profit).toBe(2750);

    await sl.undo();
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);
    expect(store.get("RELIANCE")?.take_profit).toBe(2750);

    await tp.undo();
    expect(store.get("RELIANCE")?.take_profit).toBe(2700);
  });

  test("history undo/redo round-trips a modify command", async () => {
    const store = new PositionStore([makePosition()]);
    const history = new CommandHistory();
    const cmd = new ModifyStopLossCommand(store, makePosition(), 2450);

    await expect(history.execute(cmd)).resolves.toBe(true);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2450);

    await expect(history.undo()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2400);

    await expect(history.redo()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.stop_loss).toBe(2450);
  });

  test("close command still removes and restores the position", async () => {
    const store = new PositionStore([makePosition()]);
    const cmd = new ClosePositionCommand(store, makePosition());
    await expect(cmd.execute()).resolves.toBe(true);
    expect(store.get("RELIANCE")).toBeUndefined();
    await expect(cmd.undo()).resolves.toBe(true);
    expect(store.get("RELIANCE")?.symbol).toBe("RELIANCE");
  });
});
