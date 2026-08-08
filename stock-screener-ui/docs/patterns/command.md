# Command Pattern — Trade Operations

## History & Origin

The Command pattern was formally catalogued by the **Gang of Four (GoF)** in *Design Patterns: Elements of Reusable Object-Oriented Software* (1994), but its roots go much deeper. It evolved from earlier **Callback** and **Action** patterns used in graphical user interfaces and event-driven systems.

In the 1980s, the **Xerox Star workstation** — the first commercial GUI — used Command-style objects for undo/redo, making it one of the earliest known applications of the pattern in a shipped product. The Smalltalk **Model-View-Controller (MVC)** architecture also played a key role: user actions (button clicks, menu selections) were modelled as first-class objects that could be queued, logged, and undone. This was revolutionary at a time when most programs treated user input as ephemeral events.

The pattern gained mainstream traction in the 1990s as GUI frameworks (Swing, MFC, Qt) adopted it for menu items and toolbar buttons. Today it's foundational in domains ranging from text editors to job queues to blockchain transactions.

## Problem Statement

You need to:

1. **Parameterize objects with operations** — a toolbar button, a menu item, and a keyboard shortcut should all trigger the same action. You can't pass a function call directly; you need an object that represents *what* to do.
2. **Queue, log, or replay operations** — operations need to be recorded for deferred execution, audit trails, or macro recording. A direct method call executes immediately and leaves no trace.
3. **Support undo/redo** — reversing an operation requires knowing what was changed *before* the operation. A simple function call has no mechanism to capture prior state.
4. **Compose operations into macros/batches** — a single "Close All Positions" button should run multiple trades but be undoable as one step.

**Why direct method calls fall short:**

```ts
// You can't do this:
button.onClick = closePosition(symbol); // executes immediately, not on click

// You'd have to wrap in a closure, but you still can't:
// - inspect what operation this is
// - serialize it for logging
// - reverse it
// - queue it for later
// - compose it with other operations
```

The Command pattern solves all of this by turning an operation into a first-class object with `execute()` and `undo()` methods.

## Real-World Usage

| Domain | Example | How Command Applies |
|--------|---------|-------------------|
| **Undo/Redo** | Text editors (VS Code, Vim), image editors (Photoshop), CAD (AutoCAD) | Every user action is a Command pushed onto an undo stack |
| **GUI buttons** | Every `onClick` handler in toolbars, menus, context menus | Each button has a bound Command object |
| **Transaction processing** | Database transactions, financial settlements | Atomic sequences of Commands with rollback |
| **Macro recording** | Photoshop Actions, Excel macros, Vim recording | Commands are recorded in order and replayed |
| **Job queues** | Celery (Python), Bull (Node), Sidekiq (Ruby) | Tasks are serialised Command objects processed by workers |
| **Git** | `git add`, `git commit`, `git revert` | Git objects are Commands; `git revert` is inverse of a commit |
| **Workflow engines** | AWS Step Functions, Temporal, Airflow | State machines executing composed Commands |
| **State management** | Redux actions | Every Redux action is a Command (plain object describing a state change); reducers are the executors |
| **Browser APIs** | `document.execCommand('bold')`, `document.execCommand('undo')` | Built-in Command pattern for content editing |
| **Kubernetes** | Reconciliation loop | Controllers process a queue of desired-state Commands |
| **Trading systems** | Our `TradeCommand` implementation | Position modifications as reversible Command objects |

## When to Use / When to Avoid

**Use Command when:**

- You need undo/redo functionality
- You want to parameterise UI elements (buttons, menus, shortcuts) with actions
- You need to queue, log, or schedule operations
- You need to compose operations into batches that act as one atomic unit
- You want to decouple the object that invokes an operation from the object that knows how to perform it
- You're building a macro recording system

**Avoid Command when:**

- The operation is trivial and has no undo requirement (a function reference or callback is simpler)
- The operation's side effects are hard to capture in a snapshot (e.g., operations that affect external systems with no rollback API)
- The undo logic is significantly more complex than the execute logic (consider compensating transactions instead)
- You're in a performance-critical hot path where object allocation per operation matters (though object pools can mitigate this)

## Intent

> **GoF**: Encapsulate a request as an object, thereby letting you parameterize clients with different requests, queue or log requests, and support undoable operations.

The Command pattern turns an operation (close a position, modify SL/TP, adjust quantity) into a standalone object. Each command knows how to execute itself **and** how to reverse its effects, making undo/redo straightforward. Because commands are plain objects, they can be stored in a history stack, serialized for replay, or composed into batches.

Trading operations are perfect for Command — close, modify SL/TP, adjust lots. Undo is critical for user confidence.

## Structure

### Classic GoF Command Pattern

```
┌──────────┐     invokes     ┌──────────────┐
│  Client   │ ──────────────► │   Invoker     │
└──────────┘                  │──────────────│
                              │ + invoke()    │
                              └──────┬───────┘
                                     │
                                     │ calls execute()
                                     ▼
                             ┌──────────────────┐
                             │   Command (iface) │
                             │──────────────────│
                             │ + execute()       │
                             │ + undo()          │
                             └────────┬─────────┘
                                      │ implements
                                      ▼
                             ┌──────────────────┐
                             │ ConcreteCommand  │
                             │──────────────────│
                             │ - state           │
                             │──────────────────│
                             │ + execute()       │
                             │ + undo()          │
                             └────────┬─────────┘
                                      │ operates on
                                      ▼
                             ┌──────────────────┐
                             │    Receiver       │
                             │──────────────────│
                             │ + action()        │
                             └──────────────────┘
```

**Mappings in our implementation:**

| GoF Role | Our Implementation |
|----------|-------------------|
| **Command** | `Command` interface (`name`, `timestamp`, `execute()`, `undo()`, `canUndo()`) |
| **ConcreteCommand** | `ClosePositionCommand`, `ModifyStopLossCommand`, `ModifyTakeProfitCommand`, `BatchCloseCommand` |
| **Invoker** | `CommandHistory` (manages undo/redo stacks, executes commands through the stacks) |
| **Receiver** | `PositionStore` (the in-memory data store that commands read/write) |
| **Client** | The UI layer (React components, keyboard shortcuts) that creates commands and passes them to the invoker |

### Our Structure

```
┌──────────────────────────────────────────────────────────────┐
│                     Command (interface)                       │
│──────────────────────────────────────────────────────────────│
│  + readonly name: string                                      │
│  + readonly timestamp: number                                 │
│──────────────────────────────────────────────────────────────│
│  + execute(): Promise<boolean>                                │
│  + undo():     Promise<boolean>                               │
│  + canUndo():  boolean                                        │
└────────────────────────┬─────────────────────────────────────┘
                         │ implements
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌───────────────────┐
│ ClosePosition    │ │ModifySL     │ │ ModifyTP          │
│ Command          │ │Command      │ │ Command           │
│─────────────────│ │─────────────│ │───────────────────│
│ - snapshot       │ │ - snapshot  │ │ - snapshot        │
│─────────────────│ │─────────────│ │───────────────────│
│ + execute()      │ │ + execute() │ │ + execute()       │
│ + undo()         │ │ + undo()    │ │ + undo()          │
└────────┬─────────┘ └─────────────┘ └───────────────────┘
         │ composes
         ▼
┌──────────────────────┐
│ BatchCloseCommand     │  ◄── Composite pattern
│──────────────────────│
│ - commands: array     │
│──────────────────────│
│ + execute() (all)     │
│ + undo() (all)        │
└──────────────────────┘

┌───────────────────────────────┐
│       CommandHistory           │
│───────────────────────────────│
│ - undoStack: Command[]         │
│ - redoStack: Command[]         │
│ - maxSize: number              │
│───────────────────────────────│
│ + execute(cmd): Promise<bool>  │
│ + undo():       Promise<bool>  │
│ + redo():       Promise<bool>  │
│ + canUndo():    boolean        │
│ + canRedo():    boolean        │
│ + clear():      void           │
│ + getHistory(): {...}          │
└───────────────────────────────┘
         │ reads/writes
         ▼
┌───────────────────────────────┐
│        PositionStore           │
│───────────────────────────────│
│ (in-memory simulated store)   │
└───────────────────────────────┘
```

## Command vs Strategy

Both Command and Strategy are behavioural patterns that "encapsulate behaviour as objects", but they serve different purposes:

| Aspect | Command | Strategy |
|--------|---------|----------|
| **What it encapsulates** | A **REQUEST** (do something / undo something) | An **ALGORITHM** (how to compute something) |
| **State** | Has state (snapshot of what to restore on undo) | Stateless (or configuration only) |
| **Undo** | Has `undo()` — knows how to reverse itself | No undo concept |
| **When chosen** | At invocation time (user clicks a button) | At configuration time (pick a sorting algorithm) |
| **Intent** | "Here's a thing to do, and how to reverse it" | "Here's how to compute this, interchangeable with other ways" |

**They can complement each other**: a Command could internally use a Strategy. For example, a `CalculatePnLCommand` could use different PnL calculation strategies (FIFO, LIFO, weighted average) — the Command encapsulates the *request* to calculate, and the Strategy encapsulates the *algorithm* to calculate it.

## Undo/Redo Mechanics

### Two approaches

**1. Memento-style snapshot approach**

Store the entire system state before each operation. On undo, restore the full snapshot.

```
State A  ──[Op1]──►  State B  ──[Op2]──►  State C
              ▲                              │
              └──────── ──[Undo]─────────────┘
                  (restore State B snapshot)
```

**Pros**: Simple, works for any operation. **Cons**: Memory-intensive (storing entire state snapshots).

**2. Command-based approach (what we use)**

Each command stores only the *minimal* data needed to reverse itself.

```
ClosePositionCommand snapshot:
  { symbol: "RELIANCE", quantity: 10, entryPrice: 2500, side: "BUY", ... }

ModifyStopLossCommand snapshot:
  { position: ref, oldValue: 2475, newValue: 2485 }
```

**Pros**: Memory-efficient, each command owns its own reversal logic. **Cons**: Each command type must implement its own undo logic.

### What happens to the redo stack on new command?

When a new command is executed (not via redo), the redo stack is **cleared**. This is because the timeline has branched — you can't redo commands that were undone if a new action has been taken after the undo, as their effects would conflict with the new state.

```
Timeline:  [A] → [B] → [C]
                ↑ undo B
                ↓
          [A] (undo stack: [B], redo stack: [C])
                ↓
          New command [D] executed
                ↓
          [A] → [D] (undo stack: [A, D], redo stack: [])  ← C is lost
```

This is the same behaviour as every text editor — undo a few steps, make an edit, and the redone commands are gone.

### Our stack implementation

```ts
// In CommandHistory.execute():
async execute(command: Command): Promise<boolean> {
  const ok = await command.execute();
  if (ok) {
    this.undoStack.push(command);
    this.redoStack = [];          // ← clear redo stack
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();     // ← trim to maxSize
    }
  }
  return ok;
}
```

## Implementation explanation

The implementation lives in `src/patterns/command/TradeCommand.ts` and has four layers:

1. **Command interface** — The contract every operation must fulfil. A `name` for display, a `timestamp` for ordering, `execute()` to perform the action, `undo()` to reverse it, and `canUndo()` to check if reversal is possible.

2. **CommandHistory** — Manages two stacks (undo and redo). Calling `execute(command)` runs the command and pushes it onto the undo stack (clearing the redo stack since a new action invalidates the redo history). `undo()` pops from the undo stack, calls `command.undo()`, and pushes onto the redo stack. `redo()` does the reverse. A `maxSize` (default 50) prevents unbounded memory growth by trimming old entries.

3. **Concrete commands** — Each command stores a snapshot of the data it needs to reverse itself:
   - `ClosePositionCommand` captures the full position details (`symbol`, `quantity`, `entryPrice`, `side`, `stopLoss`, `takeProfit`) *before* closing. `execute()` removes the position from the store; `undo()` reconstructs and re-inserts it.
   - `ModifyStopLossCommand` and `ModifyTakeProfitCommand` both capture the position reference, the old value, and the new value. `execute()` applies the new value; `undo()` restores the old value.
   - `BatchCloseCommand` is a composite that holds an array of `ClosePositionCommand`s and delegates to them. This lets the UI close all positions in one undoable action.

4. **PositionStore** — A simple in-memory `Map<string, PaperPosition>` that simulates the real position data. Commands read and write through this store instead of making HTTP calls, keeping the pattern easy to test and reason about.

## Code walkthrough

### Basic command lifecycle

```ts
import {
  CommandHistory,
  PositionStore,
  ClosePositionCommand,
  ModifyStopLossCommand,
} from "../patterns/command/TradeCommand";

// Seed the store with open positions
const store = new PositionStore([
  {
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    entry_price: 2500,
    current_price: 2520,
    stop_loss: 2475,
    take_profit: 2600,
    /* ... other fields ... */
  },
]);

const history = new CommandHistory();

// Close a position
const closeCmd = new ClosePositionCommand(
  store,
  store.get("RELIANCE")!,
);
await history.execute(closeCmd);
console.log(store.get("RELIANCE")); // undefined

// Undo — restores the position
await history.undo();
console.log(store.get("RELIANCE")?.symbol); // "RELIANCE"

// Redo — closes again
await history.redo();
console.log(store.get("RELIANCE")); // undefined
```

### Modifying SL/TP with undo

```ts
const pos = store.get("RELIANCE")!;
console.log(pos.stop_loss); // 2475

const modifySl = new ModifyStopLossCommand(store, pos, 2485);
await history.execute(modifySl);
console.log(pos.stop_loss); // 2485

await history.undo();
console.log(pos.stop_loss); // 2475 (restored)
```

### Batch close

```ts
const batch = new BatchCloseCommand([
  new ClosePositionCommand(store, store.get("RELIANCE")!),
  new ClosePositionCommand(store, store.get("TCS")!),
]);

await history.execute(batch);     // both closed
await history.undo();             // both restored
```

### Inspecting history

```ts
const { undoStack, redoStack } = history.getHistory();
console.log(undoStack.map((c) => c.name));
// ["Close RELIANCE", "Modify SL RELIANCE: 2475 → 2485"]
```

## How to use

1. **Import** `CommandHistory`, `PositionStore`, and the concrete command classes from `src/patterns/command/TradeCommand.ts`.
2. **Create a store** with the current open positions: `new PositionStore(existingPositions)`.
3. **Instantiate commands** for the desired operation, passing the store and the relevant position.
4. **Execute via history**: `await history.execute(command)` — never call `command.execute()` directly (doing so bypasses undo tracking).
5. **Bind undo/redo** to UI buttons or keyboard shortcuts (`Ctrl+Z` / `Ctrl+Shift+Z`).
6. **Use `BatchCloseCommand`** for bulk operations so the whole batch is a single undo step.

### Keyboard shortcuts example

```ts
document.addEventListener("keydown", async (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === "z") {
    await history.redo();
  } else if (e.ctrlKey && e.key === "z") {
    await history.undo();
  }
});
```

### React integration tip

Keep the `CommandHistory` and `PositionStore` as stable references (e.g., via `useRef` or a subscriber store). After every `execute()` / `undo()` / `redo()`, trigger a re-render so the UI reflects the updated store state:

```ts
const [version, setVersion] = useState(0);

async function handleClose(position: PaperPosition) {
  const cmd = new ClosePositionCommand(store, position);
  await history.execute(cmd);
  setVersion((v) => v + 1); // force re-render
}
```

## Composite Commands

`BatchCloseCommand` demonstrates the **Composite pattern**: individual commands are treated uniformly as a single command.

```ts
class BatchCloseCommand implements Command {
  constructor(private commands: ClosePositionCommand[]) {}
  //                          ^^^^^^^^^^^^^^^^^^^^^^^
  // Could be generalized to Command[] for any batch of heterogeneous commands

  async execute(): Promise<boolean> {
    for (const cmd of this.commands) {
      if (!(await cmd.execute())) return false;
    }
    return true;
  }

  async undo(): Promise<boolean> {
    // Reverse order: last closed should be first restored
    for (const cmd of [...this.commands].reverse()) {
      if (!(await cmd.undo())) return false;
    }
    return true;
  }
}
```

**Key detail**: undo reverses in reverse order. If you close RELIANCE then TCS, you should restore TCS first then RELIANCE. This LIFO ordering is essential when commands have dependencies (e.g., fund availability).

### Extending to heterogeneous batches

The batch pattern can be extended to compose different command types:

```ts
class MacroCommand implements Command {
  constructor(private commands: Command[]) {}

  async execute(): Promise<boolean> {
    for (const cmd of this.commands) {
      if (!(await cmd.execute())) return false;
    }
    return true;
  }

  async undo(): Promise<boolean> {
    for (const cmd of [...this.commands].reverse()) {
      if (!(await cmd.undo())) return false;
    }
    return true;
  }
}
```

This is exactly how macro recorders work — every recorded action becomes a Command in a `MacroCommand`, which is itself a Command that can be undone as one unit.

## Relations to Other Patterns

| Pattern | Relationship |
|---------|-------------|
| **Composite** | Commands can be composed into macro/batch commands (as `BatchCloseCommand` does). The batch itself implements `Command`, so it's treated identically to a single command by the invoker. |
| **Memento** | Alternative approach to undo: the entire system state is captured in a Memento before each operation. Our implementation stores snapshots *inside* each command instead, which is more memory-efficient and decentralised. These aren't mutually exclusive — a command could use Memento internally to capture complex state. |
| **Strategy** | Both encapsulate behaviour as objects, but Command encapsulates a *request* (with undo), while Strategy encapsulates an *algorithm* (interchangeable). See the comparison table above. |
| **Observer** | The invoker (`CommandHistory`) can notify observers when a command is executed, undone, or redone. This is useful for audit logging, telemetry, or updating the UI. |
| **Chain of Responsibility** | Commands can be linked in a processing pipeline where each command decides whether to handle the request or pass it to the next handler. This is useful for validation chains (validate → authorise → execute). |
| **Prototype** | Commands can be cloned for replication or distribution. A prototype registry of command types allows creating new commands without knowing their concrete class. |

## Interview Tips

### Common Questions

**Q: "What's the difference between Command and Strategy?"**

Both encapsulate behaviour as objects, but Command encapsulates a *request* (including how to undo it), while Strategy encapsulates an *algorithm* that can be swapped at runtime. Commands have state (snapshots for undo); Strategies are typically stateless. See the detailed comparison above.

**Q: "How does the Command pattern support undo/redo?"**

Each command stores a snapshot of the state it will modify *before* executing. The `undo()` method uses this snapshot to restore the original state. An invoker (`CommandHistory`) maintains two stacks: `undoStack` (commands that have been executed) and `redoStack` (commands that have been undone). Executing a new command pushes to `undoStack` and clears `redoStack`.

**Q: "What's the difference between storing state in the Command vs using Memento?"**

Command-based undo: each command stores only the data it needs to reverse itself (fine-grained, memory-efficient, but each command type must implement its own undo). Memento-based undo: the entire system state is captured in an external memento before each operation (simple and uniform, but memory-intensive for large states). Trade-off: memory vs complexity.

**Q: "How would you implement a macro recorder with Command?"**

Every user action creates a Command object and appends it to a list. "Stop recording" wraps the list in a `MacroCommand` (composite). The MacroCommand can be saved, loaded, and replayed by calling `execute()`. Since MacroCommand implements `Command`, it can also be undone as one unit.

**Q: "What happens to the redo stack when a new command is executed after undo?"**

It's cleared. The timeline has branched — the undone commands are no longer valid because the new command has changed the system state. This is the standard behaviour in every mainstream undo system.

**Q: "How would undo/redo work in a real-time collaborative system?"**

Collaborative undo requires **Operational Transformation (OT)** or **CRDTs** (Conflict-free Replicated Data Types). OT transforms the undo operation so it makes sense in the context of other users' concurrent changes. Simple stack-based undo breaks down because the "previous state" may have been modified by another user. This is a deep topic on its own — Google Docs, Figma, and VS Code Live Share all use OT or CRDTs.

**Q: "How does Redux use the Command pattern?"**

Every Redux action is a Command — a plain object with a `type` and payload that describes a state change. Reducers are the executors that interpret the command and produce new state. Middleware can log, queue, or replay actions. Redux DevTools implements undo/redo by recording all past actions and replaying from a given point. Key difference: Redux actions don't carry their own `undo()` logic — the undo is achieved by replaying all actions *except* the one being undone.

### Talking Points for Whiteboard Sessions

- Draw the classic GoF Command structure, then map it to your code
- Point out the redo-stack-clearing behaviour on new command — interviewers love this detail
- Mention that Command and Composite naturally pair (BatchCloseCommand)
- If asked about distributed systems: Kafka topics are essentially command logs — each message is a serialised Command

## Real-world note

In the real paper-trading system `ClosePositionCommand` would call `POST /api/paper/close` and `ModifyStopLossCommand` would call `PATCH /api/paper/positions/{id}`. The in-memory `PositionStore` is a stand-in that makes the pattern testable without network calls. For production, inject an API adapter and let the command call the adapter instead — the snapshot-and-restore logic remains identical.

> **Production adapter pattern**: Swap `PositionStore` for an `ApiPositionStore` that translates `get/update/delete` into HTTP calls. The commands don't change — they only depend on the store interface.
