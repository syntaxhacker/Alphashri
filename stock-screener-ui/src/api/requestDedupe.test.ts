import { describe, expect, it, vi } from "vitest";
import { dedupeInFlight } from "./requestDedupe";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("dedupeInFlight", () => {
  it("shares one loader between simultaneous callers", async () => {
    const load = vi.fn(async () => "value");

    const [a, b] = await Promise.all([
      dedupeInFlight("share", load),
      dedupeInFlight("share", load),
    ]);

    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("settles null for an aborted caller while another keeps the loader result", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const controller = new AbortController();
    const aborted = dedupeInFlight("abort", load, controller.signal);
    const staying = dedupeInFlight("abort", load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    controller.abort();

    await expect(aborted).resolves.toBeNull();
    pending.resolve("payload");
    await expect(staying).resolves.toBe("payload");
  });

  it("returns null for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      dedupeInFlight("pre-aborted", async () => "value", controller.signal),
    ).resolves.toBeNull();
  });

  it("removes an aborted flight so a later call starts a fresh loader", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const controller = new AbortController();
    const first = dedupeInFlight("reuse", load, controller.signal);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(first).resolves.toBeNull();

    const second = dedupeInFlight("reuse", load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    pending.resolve("ignored");
    await expect(second).resolves.toBe("ignored");
  });

  it("propagates a loader rejection to a caller that did not abort", async () => {
    const load = vi.fn(() => Promise.reject(new Error("boom")));

    await expect(dedupeInFlight("reject", load)).rejects.toThrow("boom");
  });

  it("an aborted caller stays null even when the loader rejects afterwards", async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const controller = new AbortController();
    const aborted = dedupeInFlight("abort-reject", load, controller.signal);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(aborted).resolves.toBeNull();
    pending.reject(new Error("boom"));
    await Promise.resolve();
  });
});
