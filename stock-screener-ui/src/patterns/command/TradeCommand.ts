/**
 * Command Pattern — Trade Operations
 *
 * GoF: Encapsulate a request as an object, thereby letting you parameterize
 * clients with different requests, queue or log requests, and support
 * undoable operations.
 *
 * Trading operations are a natural fit: close a position, modify SL/TP,
 * adjust quantity. Each operation is captured as a Command object that
 * knows how to execute itself and revert its effects, enabling undo/redo.
 *
 * @example
 * ```ts
 * const history = new CommandHistory();
 * const cmd = new ClosePositionCommand(position);
 * await history.execute(cmd);   // closes, pushes to undo stack
 * await history.undo();         // restores from snapshot
 * await history.redo();         // closes again
 * ```
 */

import type { PaperPosition } from "../../types/paperTrading";

// ─── Command Interface ──────────────────────────────────────────────────────────

export interface Command {
  /** Human-readable label (e.g. "Close RELIANCE", "Modify SL → 2450") */
  readonly name: string;
  /** Timestamp (ms since epoch) when the command was created/executed */
  readonly timestamp: number;
  /**
   * Execute the command's operation.
   * Returns true on success, false if the operation cannot be performed.
   */
  execute(): Promise<boolean>;
  /**
   * Reverse the command's operation.
   * Returns true on success, false if undo is not possible.
   */
  undo(): Promise<boolean>;
  /** Whether undo() can be called (e.g. false after a failed execution). */
  canUndo(): boolean;
}

// ─── Snapshot Types ────────────────────────────────────────────────────────────

/** Stored before closing so the position can be restored on undo. */
export interface PositionSnapshot {
  symbol: string;
  quantity: number;
  entryPrice: number;
  side: "BUY" | "SELL";
  stopLoss: number;
  takeProfit: number;
  id?: string;
}

/** Stored before modifying SL/TP so the original value can be restored. */
export interface SlTpSnapshot {
  position: PaperPosition;
  oldValue: number;
  newValue: number;
}

// ─── CommandHistory ────────────────────────────────────────────────────────────

/**
 * Manages undo/redo stacks for trade commands.
 *
 * - `execute(command)` runs the command and pushes it onto the undo stack.
 * - `undo()` pops the top command from the undo stack, calls undo(), and
 *   pushes it onto the redo stack.
 * - `redo()` pops the top command from the redo stack, calls execute(),
 *   and pushes it onto the undo stack.
 */
export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  /**
   * Execute a command and push it onto the undo stack.
   * The redo stack is cleared (a new action invalidates the redo history).
   * Trims the undo stack if it exceeds maxSize.
   */
  async execute(command: Command): Promise<boolean> {
    const ok = await command.execute();
    if (ok) {
      this.undoStack.push(command);
      this.redoStack = [];
      if (this.undoStack.length > this.maxSize) {
        this.undoStack.shift();
      }
    }
    return ok;
  }

  /** Undo the most recent command. */
  async undo(): Promise<boolean> {
    if (this.undoStack.length === 0) return false;
    const command = this.undoStack.pop()!;
    const ok = await command.undo();
    if (ok) {
      this.redoStack.push(command);
    } else {
      this.undoStack.push(command);
    }
    return ok;
  }

  /** Redo the last-undone command. */
  async redo(): Promise<boolean> {
    if (this.redoStack.length === 0) return false;
    const command = this.redoStack.pop()!;
    const ok = await command.execute();
    if (ok) {
      this.undoStack.push(command);
    } else {
      this.redoStack.push(command);
    }
    return ok;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Clear both stacks. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getHistory(): { undoStack: Command[]; redoStack: Command[] } {
    return {
      undoStack: [...this.undoStack],
      redoStack: [...this.redoStack],
    };
  }

  get size(): number {
    return this.undoStack.length;
  }
}

// ─── In-Memory Position Store (simulated) ──────────────────────────────────────

/**
 * Minimal in-memory store for PaperPositions.
 * Commands read/write through this store instead of making API calls.
 */
export class PositionStore {
  private positions: Map<string, PaperPosition> = new Map();

  constructor(initial: PaperPosition[] = []) {
    for (const p of initial) {
      this.positions.set(p.symbol, p);
    }
  }

  get(symbol: string): PaperPosition | undefined {
    return this.positions.get(symbol);
  }

  getAll(): PaperPosition[] {
    return Array.from(this.positions.values());
  }

  set(position: PaperPosition): void {
    this.positions.set(position.symbol, position);
  }

  delete(symbol: string): boolean {
    return this.positions.delete(symbol);
  }

  has(symbol: string): boolean {
    return this.positions.has(symbol);
  }
}

// ─── Concrete Commands ─────────────────────────────────────────────────────────

/**
 * Closes a position by removing it from the store.
 * On undo, restores the position from the snapshot taken at execution time.
 */
export class ClosePositionCommand implements Command {
  readonly name: string;
  readonly timestamp: number;
  private store: PositionStore;
  private _snapshot: PositionSnapshot | null = null;
  private _executed = false;

  constructor(store: PositionStore, position: PaperPosition) {
    this.store = store;
    this.name = `Close ${position.symbol}`;
    this.timestamp = Date.now();
    this._snapshot = {
      symbol: position.symbol,
      quantity: position.quantity,
      entryPrice: position.entry_price,
      side: position.side,
      stopLoss: position.stop_loss,
      takeProfit: position.take_profit,
      id: position.id,
    };
  }

  async execute(): Promise<boolean> {
    if (!this._snapshot) return false;
    const pos = this.store.get(this._snapshot.symbol);
    if (!pos) return false;
    this.store.delete(this._snapshot.symbol);
    this._executed = true;
    return true;
  }

  async undo(): Promise<boolean> {
    if (!this._snapshot || !this._executed) return false;
    const restored: PaperPosition = {
      symbol: this._snapshot.symbol,
      side: this._snapshot.side,
      quantity: this._snapshot.quantity,
      entry_price: this._snapshot.entryPrice,
      current_price: this._snapshot.entryPrice,
      stop_loss: this._snapshot.stopLoss,
      take_profit: this._snapshot.takeProfit,
      pnl: 0,
      pnl_pct: 0,
      margin_used: 0,
      entry_time: new Date().toISOString(),
      order_id: `undo-${Date.now()}`,
      strategy_id: 0,
      strategy_name: "Manual",
      id: this._snapshot.id,
    };
    this.store.set(restored);
    this._executed = false;
    return true;
  }

  canUndo(): boolean {
    return this._executed && this._snapshot !== null;
  }
}

/**
 * Modifies the stop-loss of an open position.
 * On undo, restores the previous SL value.
 */
export class ModifyStopLossCommand implements Command {
  readonly name: string;
  readonly timestamp: number;
  private store: PositionStore;
  private _snapshot: SlTpSnapshot | null = null;
  private _executed = false;

  constructor(
    store: PositionStore,
    position: PaperPosition,
    newSl: number,
  ) {
    this.store = store;
    this.name = `Modify SL ${position.symbol}: ${position.stop_loss} → ${newSl}`;
    this.timestamp = Date.now();
    this._snapshot = {
      position: { ...position },
      oldValue: position.stop_loss,
      newValue: newSl,
    };
  }

  async execute(): Promise<boolean> {
    if (!this._snapshot) return false;
    const pos = this.store.get(this._snapshot.position.symbol);
    if (!pos) return false;
    pos.stop_loss = this._snapshot.newValue;
    this.store.set(pos);
    this._snapshot.position = pos;
    this._executed = true;
    return true;
  }

  async undo(): Promise<boolean> {
    if (!this._snapshot || !this._executed) return false;
    const pos = this.store.get(this._snapshot.position.symbol);
    if (!pos) return false;
    pos.stop_loss = this._snapshot.oldValue;
    this.store.set(pos);
    this._executed = false;
    return true;
  }

  canUndo(): boolean {
    return this._executed && this._snapshot !== null;
  }
}

/**
 * Modifies the take-profit of an open position.
 * On undo, restores the previous TP value.
 */
export class ModifyTakeProfitCommand implements Command {
  readonly name: string;
  readonly timestamp: number;
  private store: PositionStore;
  private _snapshot: SlTpSnapshot | null = null;
  private _executed = false;

  constructor(
    store: PositionStore,
    position: PaperPosition,
    newTp: number,
  ) {
    this.store = store;
    this.name = `Modify TP ${position.symbol}: ${position.take_profit} → ${newTp}`;
    this.timestamp = Date.now();
    this._snapshot = {
      position: { ...position },
      oldValue: position.take_profit,
      newValue: newTp,
    };
  }

  async execute(): Promise<boolean> {
    if (!this._snapshot) return false;
    const pos = this.store.get(this._snapshot.position.symbol);
    if (!pos) return false;
    pos.take_profit = this._snapshot.newValue;
    this.store.set(pos);
    this._snapshot.position = pos;
    this._executed = true;
    return true;
  }

  async undo(): Promise<boolean> {
    if (!this._snapshot || !this._executed) return false;
    const pos = this.store.get(this._snapshot.position.symbol);
    if (!pos) return false;
    pos.take_profit = this._snapshot.oldValue;
    this.store.set(pos);
    this._executed = false;
    return true;
  }

  canUndo(): boolean {
    return this._executed && this._snapshot !== null;
  }
}

/**
 * Composite command that closes multiple positions in a single operation.
 * Undo restores every position that was closed.
 */
export class BatchCloseCommand implements Command {
  readonly name: string;
  readonly timestamp: number;
  private commands: ClosePositionCommand[];

  constructor(commands: ClosePositionCommand[]) {
    this.commands = commands;
    this.name = `Batch close (${commands.length} positions)`;
    this.timestamp = Date.now();
  }

  async execute(): Promise<boolean> {
    const results = await Promise.all(
      this.commands.map((c) => c.execute()),
    );
    return results.every(Boolean);
  }

  async undo(): Promise<boolean> {
    const results = await Promise.all(
      this.commands.map((c) => c.undo()),
    );
    return results.every(Boolean);
  }

  canUndo(): boolean {
    return this.commands.every((c) => c.canUndo());
  }

  getCommands(): readonly ClosePositionCommand[] {
    return this.commands;
  }
}
