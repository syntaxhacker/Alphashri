import { createMemo, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { DEFAULT_SECTIONS } from "./presets";
import type { SectionConcept, SectionDefinition } from "./types";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import {
  createSavedConfigStore,
  registerSavedConfigScope,
  type SavedConfigScope,
  type SavedConfigStatus,
  type SavedConfigStore,
  type SavedConfigTransport,
} from "../savedConfig";
import { isRecord } from "../../utils/isRecord";

export const USER_SECTIONS_SCOPE = "user.sections";
const USER_SECTIONS_VERSION = 1;

export interface SectionsConfig {
  sections: SectionDefinition[];
  version: 1;
}

const MAX_SECTIONS = 100;
const MAX_ID_LENGTH = 120;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MIN_REFRESH_SEC = 5;
const MAX_REFRESH_SEC = 3600;
const SIDES = new Set(["long", "short", "both"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** Saved config crosses an untrusted boundary: keep JSON scalars/arrays/objects only. */
function jsonSafe(value: unknown, depth: number): unknown {
  if (depth > 6) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => jsonSafe(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const key of Object.keys(value)) {
      if (kept >= 48) break;
      const safe = jsonSafe(value[key], depth + 1);
      if (safe !== undefined) {
        out[key] = safe;
        kept += 1;
      }
    }
    return out;
  }
  return undefined;
}

function isConcept(raw: unknown): raw is SectionConcept {
  return typeof raw === "string" && raw.trim().length > 0;
}

/** Malformed definitions are dropped, never repaired into a half-valid row. */
function sanitizeDefinition(raw: unknown): SectionDefinition | null {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.trim() === "" || raw.id.length > MAX_ID_LENGTH) return null;
  if (typeof raw.name !== "string" || raw.name.trim() === "" || raw.name.length > MAX_NAME_LENGTH) return null;
  if (!isConcept(raw.concept)) return null;
  if (typeof raw.side !== "string" || !SIDES.has(raw.side)) return null;

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const safe = jsonSafe(value, 0);
    if (safe !== undefined) clean[key] = safe;
  }
  clean.id = raw.id.trim();
  clean.name = raw.name.trim();
  clean.concept = raw.concept.trim();
  clean.side = raw.side;
  if (typeof clean.description === "string" && clean.description.length > MAX_DESCRIPTION_LENGTH) {
    clean.description = clean.description.slice(0, MAX_DESCRIPTION_LENGTH);
  }
  if ("enabled" in clean) clean.enabled = clean.enabled === true;
  if ("pinned" in clean) clean.pinned = clean.pinned === true;
  if (typeof clean.refreshSec === "number") {
    clean.refreshSec = Math.min(
      MAX_REFRESH_SEC,
      Math.max(MIN_REFRESH_SEC, Math.round(clean.refreshSec)),
    );
  } else if (clean.refreshSec !== undefined) {
    delete clean.refreshSec;
  }
  if ("conditions" in clean && !Array.isArray(clean.conditions)) delete clean.conditions;
  if ("render" in clean && !isPlainObject(clean.render)) delete clean.render;
  return clean as unknown as SectionDefinition;
}

export function defaultSectionsConfig(): SectionsConfig {
  return { sections: DEFAULT_SECTIONS.map((def) => ({ ...def })), version: USER_SECTIONS_VERSION };
}

export function normalizeSectionsConfig(raw: unknown): SectionsConfig {
  let data: unknown = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return defaultSectionsConfig();
    }
  }
  if (!isPlainObject(data) || !Array.isArray(data.sections)) return defaultSectionsConfig();

  const seen = new Set<string>();
  const sections: SectionDefinition[] = [];
  for (const entry of data.sections) {
    if (sections.length >= MAX_SECTIONS) break;
    const def = sanitizeDefinition(entry);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    sections.push(def);
  }
  return { sections, version: USER_SECTIONS_VERSION };
}

export function serializeSectionsConfig(config: SectionsConfig): Record<string, unknown> {
  return {
    v: USER_SECTIONS_VERSION,
    sections: config.sections.map((def) => ({ ...def })),
  };
}

function sectionsScope(): SavedConfigScope<SectionsConfig> {
  return {
    scope: USER_SECTIONS_SCOPE,
    version: USER_SECTIONS_VERSION,
    defaults: defaultSectionsConfig,
    parse: normalizeSectionsConfig,
    serialize: serializeSectionsConfig,
  };
}

interface StoreEntry {
  store: SavedConfigStore<SectionsConfig>;
  refs: number;
}

let entry: StoreEntry | null = null;

const cloneConfig = (config: SectionsConfig): SectionsConfig => ({
  ...config,
  sections: config.sections.map((def) => ({ ...def })),
});

export function useSectionsConfig(
  deps: { transport?: SavedConfigTransport } = {},
): {
  config: Accessor<SectionsConfig>;
  setConfig(next: SectionsConfig): void;
  upsert(def: SectionDefinition): void;
  remove(id: string): void;
  hydrated: Accessor<boolean>;
  status: Accessor<SavedConfigStatus>;
} {
  if (!entry) {
    const scope = registerSavedConfigScope(sectionsScope());
    entry = { store: createSavedConfigStore(scope, deps), refs: 0 };
  }
  const current = entry;
  current.refs += 1;

  const version = useStoreSubscription(current.store.subscribe);
  const read = (): SectionsConfig => {
    version();
    return current.store.getState().value ?? defaultSectionsConfig();
  };
  const config = createMemo(read);

  onMount(() => current.store.hydrate());
  onCleanup(() => {
    if (entry !== current) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      current.store.dispose();
      entry = null;
    }
  });

  return {
    config,
    setConfig: (next) => current.store.scheduleSave(cloneConfig(next)),
    upsert: (def) => {
      const prev = current.store.getState().value ?? defaultSectionsConfig();
      const exists = prev.sections.some((section) => section.id === def.id);
      const sections = exists
        ? prev.sections.map((section) => (section.id === def.id ? { ...def } : section))
        : [...prev.sections, { ...def }];
      current.store.scheduleSave({ ...prev, sections });
    },
    remove: (id) => {
      const prev = current.store.getState().value ?? defaultSectionsConfig();
      if (!prev.sections.some((section) => section.id === id)) return;
      current.store.scheduleSave({
        ...prev,
        sections: prev.sections.filter((section) => section.id !== id),
      });
    },
    hydrated: () => {
      version();
      return current.store.getState().hydrated;
    },
    status: () => {
      version();
      return current.store.getState().status;
    },
  };
}
