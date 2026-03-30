import { describe, it, expect } from "vitest";
import { createSubscriber } from "./createSubscriber";

describe("createSubscriber", () => {
  it("creates subscriber with subscribe and notify", () => {
    const { subscribe, notify } = createSubscriber();
    expect(typeof subscribe).toBe("function");
    expect(typeof notify).toBe("function");
  });

  it("subscribe returns unsubscribe function", () => {
    const { subscribe } = createSubscriber();
    const unsub = subscribe(() => {});
    expect(typeof unsub).toBe("function");
  });

  it("unsubscribe removes callback", () => {
    const { subscribe, notify } = createSubscriber();
    let callCount = 0;
    const unsub = subscribe(() => {
      callCount++;
    });
    unsub();
    notify();
    expect(callCount).toBe(0);
  });

  it("notify calls all subscribers", () => {
    const { subscribe, notify } = createSubscriber();
    let count1 = 0;
    let count2 = 0;
    subscribe(() => count1++);
    subscribe(() => count2++);
    notify();
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("notify calls subscribers multiple times", () => {
    const { subscribe, notify } = createSubscriber();
    let count = 0;
    subscribe(() => count++);
    notify();
    notify();
    expect(count).toBe(2);
  });

  it("handles many subscribers", () => {
    const { subscribe, notify } = createSubscriber();
    const counters = Array.from({ length: 10 }, () => ({ count: 0 }));
    counters.forEach((c) => {
      subscribe(() => c.count++);
    });
    notify();
    counters.forEach((c) => expect(c.count).toBe(1));
  });

  it("subscribe can be called multiple times", () => {
    const { subscribe, notify } = createSubscriber();
    let count = 0;
    const unsub1 = subscribe(() => count++);
    const unsub2 = subscribe(() => count++);
    notify();
    expect(count).toBe(2);
    unsub1();
    notify();
    expect(count).toBe(3);
    unsub2();
    notify();
    expect(count).toBe(3);
  });

  it("unsubscribe is idempotent", () => {
    const { subscribe, notify } = createSubscriber();
    let count = 0;
    const unsub = subscribe(() => count++);
    unsub();
    unsub();
    notify();
    expect(count).toBe(0);
  });
});
