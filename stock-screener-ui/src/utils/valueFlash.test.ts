// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { flashClass, useValueFlash } from "./valueFlash";

/** happy-dom exposes a non-file `import.meta.url`, so resolve from the repo root. */
const readSrc = (rel: string): string => readFileSync(resolve(process.cwd(), "src", rel), "utf8");

/** Keep the flash active for the lifetime of a unit test; auto-clear is covered separately. */
const LONG_FLASH_MS = 60_000;

const flush = () => Promise.resolve();

function mount(value: () => number | null | undefined, durationMs = LONG_FLASH_MS) {
  let api!: ReturnType<typeof useValueFlash>;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    api = useValueFlash(value, durationMs);
  });
  return { api, dispose };
}

describe("flashClass", () => {
  it("returns the up class when the value increases", () => {
    expect(flashClass(110, 100)).toBe("value-flash-up");
  });

  it("returns the down class when the value decreases", () => {
    expect(flashClass(90, 100)).toBe("value-flash-down");
  });

  it("returns no class for equal values", () => {
    expect(flashClass(100, 100)).toBe("");
  });

  it("returns no class on the first render (no previous value)", () => {
    expect(flashClass(100, null)).toBe("");
    expect(flashClass(100, undefined)).toBe("");
  });

  it("returns no class for non-finite current values", () => {
    expect(flashClass(Number.NaN, 100)).toBe("");
    expect(flashClass(Number.POSITIVE_INFINITY, 100)).toBe("");
    expect(flashClass(Number.NEGATIVE_INFINITY, 100)).toBe("");
    expect(flashClass(null, 100)).toBe("");
    expect(flashClass(undefined, 100)).toBe("");
  });

  it("returns no class for non-finite previous values", () => {
    expect(flashClass(100, Number.NaN)).toBe("");
    expect(flashClass(100, Number.POSITIVE_INFINITY)).toBe("");
    expect(flashClass(100, Number.NEGATIVE_INFINITY)).toBe("");
  });
});

describe("useValueFlash", () => {
  it("starts flat with key 0 and no class on the first render", async () => {
    const [value] = createSignal<number | null | undefined>(100);
    const { api, dispose } = mount(value);
    await flush();

    expect(api.direction()).toBe("flat");
    expect(api.className()).toBe("");
    expect(api.key()).toBe(0);
    dispose();
  });

  it("does not flash when a null first value becomes a number", async () => {
    const [value, setValue] = createSignal<number | null | undefined>(null);
    const { api, dispose } = mount(value);
    await flush();

    setValue(100);
    await flush();
    expect(api.direction()).toBe("flat");
    expect(api.className()).toBe("");
    expect(api.key()).toBe(0);
    dispose();
  });

  it("reports up/down and increments the sequence on each real change", async () => {
    const [value, setValue] = createSignal<number | null | undefined>(100);
    const { api, dispose } = mount(value);
    await flush();

    setValue(110);
    await flush();
    expect(api.direction()).toBe("up");
    expect(api.className()).toBe("value-flash-up");
    expect(api.key()).toBe(1);

    setValue(90);
    await flush();
    expect(api.direction()).toBe("down");
    expect(api.className()).toBe("value-flash-down");
    expect(api.key()).toBe(2);
    dispose();
  });

  it("does not increment the sequence or flash on an equal value", async () => {
    const [value, setValue] = createSignal<number | null | undefined>(100);
    const [tick, setTick] = createSignal(0);
    // A second dependency forces the effect to observe an unchanged value —
    // setting a Solid signal to the same value on its own is a no-op.
    const observed = () => {
      tick();
      return value();
    };
    const { api, dispose } = mount(observed);
    await flush();

    setValue(110);
    await flush();
    expect(api.key()).toBe(1);
    expect(api.direction()).toBe("up");

    setTick(1);
    await flush();
    expect(api.direction()).toBe("flat");
    expect(api.className()).toBe("");
    expect(api.key()).toBe(1);
    dispose();
  });

  it("treats a non-finite tick as flat and keeps the sequence stable", async () => {
    const [value, setValue] = createSignal<number | null | undefined>(100);
    const { api, dispose } = mount(value);
    await flush();

    setValue(Number.NaN);
    await flush();
    expect(api.direction()).toBe("flat");
    expect(api.className()).toBe("");
    expect(api.key()).toBe(0);
    dispose();
  });

  it("clears the flash after durationMs", async () => {
    const [value, setValue] = createSignal<number | null | undefined>(100);
    const { api, dispose } = mount(value, 10);
    await flush();

    setValue(110);
    await flush();
    expect(api.className()).toBe("value-flash-up");

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.direction()).toBe("flat");
    expect(api.className()).toBe("");
    dispose();
  });
});

describe("valueFlash CSS", () => {
  const css = readSrc("tailwind.css");

  it("defines both keyframes from the palette tokens", () => {
    expect(css).toMatch(/@keyframes valueFlashUp\s*\{/);
    expect(css).toMatch(/@keyframes valueFlashDown\s*\{/);
    expect(css).toMatch(/color-mix\(in srgb,\s*var\(--color-fin-positive\)\s+26%,\s*transparent\)/);
    expect(css).toMatch(/color-mix\(in srgb,\s*var\(--color-fin-negative\)\s+26%,\s*transparent\)/);
  });

  it("binds both classes to the matching animation", () => {
    expect(css).toMatch(/\.value-flash-up\s*\{[^}]*animation:\s*valueFlashUp 600ms ease-out/);
    expect(css).toMatch(/\.value-flash-down\s*\{[^}]*animation:\s*valueFlashDown 600ms ease-out/);
  });

  it("disables the animation under prefers-reduced-motion", () => {
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.value-flash-up[\s\S]*?\.value-flash-down[\s\S]*?animation:\s*none/,
    );
  });
});

describe("valueFlash source", () => {
  it("uses no raw hex colours", () => {
    expect(readSrc("utils/valueFlash.ts")).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
