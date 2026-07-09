/**
 * State Pattern — Bot State Machine
 *
 * Implements the GoF State pattern to manage bot lifecycle transitions.
 * A bot moves through a defined set of states (STOPPED, STARTING, RUNNING,
 * STOPPING, ERROR) with transitions driven by events (START, STOP, ERROR,
 * STARTED, STOPPED, RESET). Invalid transitions are rejected, maintaining
 * lifecycle integrity.
 *
 * The pattern decouples state-specific behavior from the bot context and
 * enforces a deterministic transition table rather than ad-hoc conditionals.
 *
 * @see BotStatus in types/bots.ts — the backend mirrors these states via
 *      the `status` field ("running" | "stopped" | "unknown").
 */

// ─── State Enum ───────────────────────────────────────────────────────────────

/** Finite set of states in the bot lifecycle. */
export enum BotState {
  STOPPED = "STOPPED",
  STARTING = "STARTING",
  RUNNING = "RUNNING",
  STOPPING = "STOPPING",
  ERROR = "ERROR",
}

// ─── Events ───────────────────────────────────────────────────────────────────

/** Events that trigger state transitions. */
export type BotEvent = "START" | "STOP" | "ERROR" | "STARTED" | "STOPPED" | "RESET";

// ─── Transition Definition ────────────────────────────────────────────────────

/** Defines a single valid transition rule. */
export interface StateTransition {
  /** Source states allowed for this transition. */
  from: BotState[];
  /** Target state after the transition. */
  to: BotState;
  /** Event that triggers the transition. */
  event: BotEvent;
}

// ─── State Handler Interface ──────────────────────────────────────────────────

/**
 * Abstract handler for per-state logic.
 * Implementations define side-effects on state entry, exit, and event handling.
 */
export interface BotStateHandler {
  /** Called when the machine enters this state. */
  onEnter(machine: BotStateMachine): void;
  /** Called when the machine exits this state. */
  onExit(machine: BotStateMachine): void;
  /**
   * Handle an event in the current state.
   * Return a target state to transition, or null to ignore.
   */
  handle(event: BotEvent, machine: BotStateMachine): BotState | null;
}

// ─── State Machine ────────────────────────────────────────────────────────────

/** Callback signature for state change notifications. */
export type StateChangeCallback = (
  from: BotState,
  to: BotState,
  event: BotEvent,
) => void;

/**
 * BotStateMachine — deterministic finite state machine for bot lifecycle.
 *
 * @example
 * ```ts
 * const sm = new BotStateMachine();
 * sm.context.set("botId", "abc-123");
 *
 * sm.transition("START");       // STOPPED → STARTING
 * sm.transition("STARTED");     // STARTING → RUNNING
 * sm.transition("STOP");        // RUNNING   → STOPPING
 * sm.transition("STOPPED");     // STOPPING  → STOPPED
 * ```
 */
export class BotStateMachine {
  private currentState: BotState;
  private transitions: StateTransition[];
  private observers: StateChangeCallback[] = [];
  private stateHandlers: Map<BotState, BotStateHandler> = new Map();

  /** Arbitrary context storage (botId, pid, error message, etc.). */
  public context: Map<string, unknown> = new Map();

  constructor(initialState: BotState = BotState.STOPPED) {
    this.currentState = initialState;
    this.transitions = this.defaultTransitions();
  }

  /** ── Default transition table ────────────────────────────────────────── */

  private defaultTransitions(): StateTransition[] {
    return [
      { from: [BotState.STOPPED], to: BotState.STARTING, event: "START" },
      { from: [BotState.STARTING], to: BotState.RUNNING, event: "STARTED" },
      { from: [BotState.STARTING], to: BotState.ERROR, event: "ERROR" },
      { from: [BotState.RUNNING], to: BotState.STOPPING, event: "STOP" },
      { from: [BotState.RUNNING], to: BotState.ERROR, event: "ERROR" },
      { from: [BotState.STOPPING], to: BotState.STOPPED, event: "STOPPED" },
      { from: [BotState.STOPPING], to: BotState.ERROR, event: "ERROR" },
      { from: [BotState.ERROR], to: BotState.STOPPED, event: "RESET" },
    ];
  }

  /** ── Public API ──────────────────────────────────────────────────────── */

  /** Returns the current state. */
  getState(): BotState {
    return this.currentState;
  }

  /** Returns a read-only copy of the transition table. */
  getTransitions(): StateTransition[] {
    return [...this.transitions];
  }

  /** Returns all events that can fire from the current state. */
  getValidEvents(): BotEvent[] {
    return this.transitions
      .filter((t) => t.from.includes(this.currentState))
      .map((t) => t.event);
  }

  /** Check whether a given event is valid in the current state. */
  canTransition(event: BotEvent): boolean {
    return this.transitions.some(
      (t) => t.from.includes(this.currentState) && t.event === event,
    );
  }

  /**
   * Attempt to transition on the given event.
   * Returns true if the transition was executed, false if invalid.
   */
  transition(event: BotEvent): boolean {
    const rule = this.transitions.find(
      (t) => t.from.includes(this.currentState) && t.event === event,
    );

    if (!rule) return false;

    const from = this.currentState;

    const handler = this.stateHandlers.get(from);
    handler?.onExit(this);

    this.currentState = rule.to;

    const newHandler = this.stateHandlers.get(rule.to);
    newHandler?.onEnter(this);

    this.notifyObservers(from, rule.to, event);
    return true;
  }

  /**
   * Register a state change observer.
   * Returns an unsubscribe function.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.observers.push(callback);
    return () => {
      this.observers = this.observers.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register a handler for a specific state.
   * The handler's onEnter/onExit are called automatically.
   */
  registerHandler(state: BotState, handler: BotStateHandler): void {
    this.stateHandlers.set(state, handler);
  }

  /** Forcefully set state (bypasses transition table — use sparingly). */
  setState(state: BotState): void {
    const from = this.currentState;
    this.currentState = state;
    this.notifyObservers(from, state, "RESET");
  }

  /** Reset state machine to STOPPED and clear context. */
  reset(): void {
    const from = this.currentState;
    this.currentState = BotState.STOPPED;
    this.context.clear();
    this.notifyObservers(from, BotState.STOPPED, "RESET");
  }

  /** ── Internal ────────────────────────────────────────────────────────── */

  private notifyObservers(from: BotState, to: BotState, event: BotEvent): void {
    for (const cb of this.observers) {
      cb(from, to, event);
    }
  }
}
