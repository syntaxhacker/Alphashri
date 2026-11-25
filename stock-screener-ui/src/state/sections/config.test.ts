// @vitest-environment happy-dom
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { UserConfig } from "../../api/userConfigs";
import { SAVE_DEBOUNCE_MS, type SavedConfigTransport } from "../savedConfig";
import {
  USER_SECTIONS_SCOPE,
  defaultSectionsConfig,
  normalizeSectionsConfig,
  serializeSectionsConfig,
  useSectionsConfig,
  type SectionsConfig,
} from "./config";
import { DEFAULT_SECTIONS } from "./presets";

const SECTION_A = DEFAULT_SECTIONS[0];
const SECTION_B = DEFAULT_SECTIONS[2];

function envelope(
  config: Record<string, unknown>,
  overrides: Partial<UserConfig<Record<string, unknown>>> = {},
): UserConfig<Record<string, unknown>> {
  return {
    scope: USER_SECTIONS_SCOPE,
    version: 1,
    saved: true,
    updated_at: "2026-11-25T09:41:22.192Z",
    config,
    ...overrides,
  };
}

function makeTransport() {
  const get = vi.fn<SavedConfigTransport["get"]>();
  const put = vi.fn<SavedConfigTransport["put"]>();
  const del = vi.fn<SavedConfigTransport["del"]>();
  put.mockImplementation(async (_scope, config) =>
    envelope(config, { updated_at: `rev-${put.mock.calls.length}` }),
  );
  del.mockResolvedValue({ scope: USER_SECTIONS_SCOPE, deleted: true });
  return { transport: { get, put, del }, get, put, del };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Api = ReturnType<typeof useSectionsConfig>;
const roots: Array<() => void> = [];

function mount(transport: SavedConfigTransport): { api: Api; dispose: () => void } {
  let api!: Api;
  let disposeRoot!: () => void;
  createRoot((d) => {
    disposeRoot = d;
    api = useSectionsConfig({ transport });
  });
  const dispose = () => {
    const i = roots.indexOf(dispose);
    if (i >= 0) roots.splice(i, 1);
    disposeRoot();
  };
  roots.push(dispose);
  return { api, dispose };
}

async function settle(): Promise<void> {
  await vi.runAllTimersAsync();
}

async function flushDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (roots.length) roots.pop()!();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("sections config wire format", () => {
  test("serialize -> JSON -> normalize round-trips without losing definitions", () => {
    const original: SectionsConfig = { sections: [SECTION_A, SECTION_B], version: 1 };
    const wire = serializeSectionsConfig(original);

    expect(wire).toEqual({ v: 1, sections: [SECTION_A, SECTION_B] });
    expect(normalizeSectionsConfig(JSON.parse(JSON.stringify(wire)))).toEqual(original);
  });

  test("defaults come from the presets registry and are cloned per call", () => {
    const first = defaultSectionsConfig();
    expect(first.sections).toEqual(DEFAULT_SECTIONS);

    first.sections[0].name = "mutated";
    expect(defaultSectionsConfig().sections[0].name).toBe(DEFAULT_SECTIONS[0].name);
  });
});

describe("normalizeSectionsConfig (untrusted input)", () => {
  test("non-object and malformed payloads fall back to defaults", () => {
    expect(normalizeSectionsConfig(null)).toEqual(defaultSectionsConfig());
    expect(normalizeSectionsConfig("not json")).toEqual(defaultSectionsConfig());
    expect(normalizeSectionsConfig([])).toEqual(defaultSectionsConfig());
    expect(normalizeSectionsConfig({ sections: "nope" })).toEqual(defaultSectionsConfig());
  });

  test("a JSON string payload is accepted", () => {
    const cfg = normalizeSectionsConfig(JSON.stringify({ sections: [SECTION_A] }));
    expect(cfg.sections).toEqual([SECTION_A]);
  });

  test("invalid defs are dropped, ids deduped, numbers clamped and booleans coerced", () => {
    const cfg = normalizeSectionsConfig({
      sections: [
        SECTION_A,
        { ...SECTION_A, id: "" },
        { ...SECTION_A, id: "bad-concept", concept: 7 },
        { ...SECTION_A, id: SECTION_A.id, name: "duplicate" },
        { ...SECTION_A, id: "clamped", refreshSec: -99, enabled: "yes", pinned: 1 },
        { ...SECTION_A, id: "huge", refreshSec: 999999 },
        null,
        42,
        "x",
        [],
      ],
    });

    expect(cfg.sections.map((def) => def.id)).toEqual([SECTION_A.id, "clamped", "huge"]);
    expect(cfg.sections[1].refreshSec).toBe(5);
    expect(cfg.sections[1].enabled).toBe(false);
    expect(cfg.sections[1].pinned).toBe(false);
    expect(cfg.sections[2].refreshSec).toBe(3600);
  });

  test("an explicit empty list stays empty instead of reverting to defaults", () => {
    expect(normalizeSectionsConfig({ sections: [] }).sections).toEqual([]);
  });
});

describe("useSectionsConfig CRUD", () => {
  test("upsert appends, replaces by id, and never mutates the previous config", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(envelope({ v: 1, sections: [SECTION_A] }));
    const { api } = mount(made.transport);
    await settle();

    const before = api.config();
    api.upsert({ ...SECTION_B, id: "new-section", name: "New section" });
    expect(before.sections).toEqual([SECTION_A]);
    expect(api.config().sections.map((def) => def.id)).toEqual([SECTION_A.id, "new-section"]);

    api.upsert({ ...SECTION_B, id: "new-section", name: "Renamed" });
    expect(api.config().sections).toHaveLength(2);
    expect(api.config().sections[1].name).toBe("Renamed");

    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1]).toMatchObject({
      sections: [{ id: SECTION_A.id }, { id: "new-section", name: "Renamed" }],
    });
  });

  test("remove filters by id, ignores unknown ids and leaves the old config untouched", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(envelope({ v: 1, sections: [SECTION_A, SECTION_B] }));
    const { api } = mount(made.transport);
    await settle();

    const before = api.config();
    api.remove("does-not-exist");
    expect(made.put).not.toHaveBeenCalled();

    api.remove(SECTION_A.id);
    expect(before.sections.map((def) => def.id)).toEqual([SECTION_A.id, SECTION_B.id]);
    expect(api.config().sections.map((def) => def.id)).toEqual([SECTION_B.id]);

    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1]).toMatchObject({ sections: [SECTION_B] });
  });
});

describe("useSectionsConfig persistence", () => {
  test("hydrates from the user.sections scope v1 without writing back", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(envelope({ v: 1, sections: [SECTION_B] }));
    const { api } = mount(made.transport);
    await settle();

    expect(made.get).toHaveBeenCalledWith(USER_SECTIONS_SCOPE);
    expect(api.hydrated()).toBe(true);
    expect(api.status()).toBe("ready");
    expect(api.config().sections).toEqual([SECTION_B]);
    expect(made.put).not.toHaveBeenCalled();
  });

  test("setConfig PUTs exactly once after the 800ms debounce", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(envelope({ v: 1, sections: [SECTION_A] }));
    const { api } = mount(made.transport);
    await settle();

    const next: SectionsConfig = { sections: [SECTION_A, SECTION_B], version: 1 };
    api.setConfig(next);
    expect(made.put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(made.put).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][0]).toBe(USER_SECTIONS_SCOPE);
    expect(made.put.mock.calls[0][1]).toEqual(serializeSectionsConfig(next));
    expect(made.put.mock.calls[0][2]).toMatchObject({ version: 1 });
  });

  test("several edits inside the window coalesce into one trailing PUT", async () => {
    const made = makeTransport();
    made.get.mockResolvedValue(envelope({ v: 1, sections: [SECTION_A] }));
    const { api } = mount(made.transport);
    await settle();

    api.upsert({ ...SECTION_B, id: "first" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2);
    api.upsert({ ...SECTION_B, id: "second" });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS / 2);
    expect(made.put).not.toHaveBeenCalled();

    await flushDebounce();
    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1]).toMatchObject({
      sections: [SECTION_A, { id: "first" }, { id: "second" }],
    });
  });

  test("no PUT before hydration; a pending local edit wins over a slow GET", async () => {
    const made = makeTransport();
    const pending = deferred<UserConfig<Record<string, unknown>>>();
    made.get.mockReturnValue(pending.promise);
    const { api } = mount(made.transport);
    await settle();

    const local: SectionsConfig = { sections: [SECTION_A, SECTION_B], version: 1 };
    api.setConfig(local);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(made.put).not.toHaveBeenCalled();

    pending.resolve(envelope({ v: 1, sections: [SECTION_B] }));
    await flushDebounce();

    expect(made.put).toHaveBeenCalledTimes(1);
    expect(made.put.mock.calls[0][1]).toEqual(serializeSectionsConfig(local));
  });
});
