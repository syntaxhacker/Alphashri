// @ts-nocheck
/**
 * ThemePlayground — floating dev panel to tweak the theme live.
 * Overrides Mantine CSS variables on <html> in real time; persists to
 * localStorage under "alphashri_theme_overrides". Presets included.
 */
import { useEffect, useRef, useState } from "react";

interface Slot {
  key: string;      // CSS variable on <html>
  label: string;
  def: string;      // default (high-contrast dark)
}

const SLOTS: Slot[] = [
  { key: "--mantine-color-body",        label: "Background", def: "#0D1117" },
  { key: "--mantine-color-dark-6",      label: "Surface",    def: "#21262D" },
  { key: "--mantine-color-dark-5",      label: "Surface Alt",def: "#30363D" },
  { key: "--mantine-color-dark-4",      label: "Border",     def: "#484F58" },
  { key: "--mantine-color-dark-0",      label: "Text",       def: "#F0F6FC" },
  { key: "--mantine-color-dark-2",      label: "Muted Text", def: "#8B949E" },
  { key: "--mantine-color-dark-3",      label: "Placeholder",def: "#6E7681" },
  { key: "--mantine-color-blue-8",      label: "Primary Filled", def: "#1449B8" },
  { key: "--mantine-color-blue-6",      label: "Primary Mid", def: "#1F6FEB" },
  { key: "--mantine-color-blue-5",      label: "Primary Bright", def: "#1F7FFF" },
  { key: "--mantine-color-green-5",     label: "Green (up)", def: "#3FB950" },
  { key: "--mantine-color-red-5",       label: "Red (down)", def: "#F85149" },
];

interface Preset { name: string; values: Record<string, string>; }

const PRESETS: Preset[] = [
  { name: "GitHub Dark (default)", values: {} },
  {
    name: "Dracula",
    values: {
      "--mantine-color-body": "#282A36", "--mantine-color-dark-6": "#44475A",
      "--mantine-color-dark-5": "#3A3D4C", "--mantine-color-dark-4": "#6272A4",
      "--mantine-color-dark-0": "#F8F8F2", "--mantine-color-dark-2": "#A7A9BE",
      "--mantine-color-dark-3": "#8A8CA8", "--mantine-color-blue-8": "#44475A",
      "--mantine-color-blue-6": "#BD93F9", "--mantine-color-blue-5": "#BD93F9",
      "--mantine-color-green-5": "#50FA7B", "--mantine-color-red-5": "#FF5555",
    },
  },
  {
    name: "One Dark",
    values: {
      "--mantine-color-body": "#282C34", "--mantine-color-dark-6": "#21252B",
      "--mantine-color-dark-5": "#2C323C", "--mantine-color-dark-4": "#3E4451",
      "--mantine-color-dark-0": "#ABB2BF", "--mantine-color-dark-2": "#6F7680",
      "--mantine-color-dark-3": "#5C6370", "--mantine-color-blue-8": "#2C5E8C",
      "--mantine-color-blue-6": "#61AFEF", "--mantine-color-blue-5": "#61AFEF",
      "--mantine-color-green-5": "#98C379", "--mantine-color-red-5": "#E06C75",
    },
  },
  {
    name: "Nord",
    values: {
      "--mantine-color-body": "#2E3440", "--mantine-color-dark-6": "#3B4252",
      "--mantine-color-dark-5": "#434C5E", "--mantine-color-dark-4": "#4C566A",
      "--mantine-color-dark-0": "#ECEFF4", "--mantine-color-dark-2": "#D8DEE9",
      "--mantine-color-dark-3": "#B9C0CD", "--mantine-color-blue-8": "#2E5A88",
      "--mantine-color-blue-6": "#81A1C1", "--mantine-color-blue-5": "#88C0D0",
      "--mantine-color-green-5": "#A3BE8C", "--mantine-color-red-5": "#BF616A",
    },
  },
  {
    name: "Catppuccin Mocha",
    values: {
      "--mantine-color-body": "#1E1E2E", "--mantine-color-dark-6": "#313244",
      "--mantine-color-dark-5": "#45475A", "--mantine-color-dark-4": "#585B70",
      "--mantine-color-dark-0": "#CDD6F4", "--mantine-color-dark-2": "#A6ADC8",
      "--mantine-color-dark-3": "#9399B2", "--mantine-color-blue-8": "#45475A",
      "--mantine-color-blue-6": "#89B4FA", "--mantine-color-blue-5": "#89B4FA",
      "--mantine-color-green-5": "#A6E3A1", "--mantine-color-red-5": "#F38BA8",
    },
  },
];

const STORAGE_KEY = "alphashri_theme_overrides";

function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function apply(overrides: Record<string, string>) {
  const root = document.documentElement;
  // clear all our previous vars first
  SLOTS.forEach((s) => root.style.removeProperty(s.key));
  Object.entries(overrides).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function ThemePlayground() {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState("GitHub Dark (default)");
  // Live values live in a ref so color-drag ticks mutate the DOM directly
  // without triggering a React re-render or localStorage write per frame.
  const liveRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const saved = loadOverrides();
    liveRef.current = { ...saved };
    if (Object.keys(saved).length) {
      setOverrides(saved);
      apply(saved);
    }
  }, []);

  const persist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(liveRef.current));
  };

  const setVar = (key: string, value: string) => {
    liveRef.current[key] = value;
    apply(liveRef.current);
    setOverrides({ ...liveRef.current });
    persist();
  };

  // Fast path: apply a single var to the DOM immediately (no state, no storage).
  // Fired via onInput on the color picker — runs every drag tick, stays cheap.
  const setVarFast = (key: string, value: string) => {
    liveRef.current[key] = value;
    document.documentElement.style.setProperty(key, value);
  };

  // Slow path: called once when the user releases the picker (onChange).
  const commitVar = (key: string) => {
    setOverrides({ ...liveRef.current });
    persist();
  };

  const choosePreset = (name: string) => {
    setPreset(name);
    const p = PRESETS.find((x) => x.name === name)!;
    const next = { ...p.values };
    liveRef.current = { ...next };
    setOverrides(next);
    apply(next);
    persist();
  };

  const reset = () => {
    liveRef.current = {};
    setOverrides({});
    apply({});
    localStorage.removeItem(STORAGE_KEY);
    setPreset("GitHub Dark (default)");
  };

  const current = (slot: Slot) =>
    liveRef.current[slot.key] ?? slot.def;

  return (
    <>
      {/* floating toggle */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: "fixed", bottom: 16, right: 16, zIndex: 9999,
          width: 44, height: 44, borderRadius: 22, cursor: "pointer",
          border: "1px solid var(--mantine-color-default-border)",
          background: "var(--mantine-color-body)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          fontSize: 20,
        }}
        title="Theme playground"
        data-testid="theme-playground-toggle"
      >
        🎨
      </button>

      {open && (
        <div
          data-testid="theme-playground"
          style={{
            position: "fixed", bottom: 68, right: 16, zIndex: 9999,
            width: 300, maxHeight: "calc(100vh - 100px)", overflow: "auto",
            borderRadius: 12, padding: 14,
            border: "1px solid var(--mantine-color-default-border)",
            background: "var(--mantine-color-body)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            fontFamily: "ui-monospace, monospace", fontSize: 12,
            color: "var(--mantine-color-text)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <strong>🎨 Theme Playground</strong>
            <button onClick={reset} style={{ cursor: "pointer", fontSize: 11 }}>Reset</button>
          </div>

          <label style={{ display: "block", marginBottom: 10 }}>
            Preset
            <select
              value={preset}
              onChange={(e) => choosePreset(e.target.value)}
              style={{
                display: "block", width: "100%", marginTop: 4, padding: "4px 6px",
                background: "var(--mantine-color-body)", color: "var(--mantine-color-text)",
                border: "1px solid var(--mantine-color-default-border)", borderRadius: 6,
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </label>

          {SLOTS.map((slot) => (
            <label key={slot.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ width: 110 }}>{slot.label}</span>
              <input
                type="color"
                value={current(slot)}
                onInput={(e) => setVarFast(slot.key, (e.target as HTMLInputElement).value)}
                onChange={(e) => commitVar(slot.key)}
                style={{ width: 44, height: 24, padding: 0, border: "1px solid var(--mantine-color-default-border)", background: "transparent", cursor: "pointer" }}
              />
              <input
                type="text"
                value={current(slot)}
                onChange={(e) => setVar(slot.key, e.target.value)}
                style={{
                  width: 92, padding: "2px 4px", fontSize: 11,
                  background: "var(--mantine-color-body)", color: "var(--mantine-color-text)",
                  border: "1px solid var(--mantine-color-default-border)", borderRadius: 4,
                  fontFamily: "ui-monospace, monospace",
                }}
              />
            </label>
          ))}

          <div style={{ marginTop: 10, fontSize: 10, opacity: 0.7 }}>
            Live CSS-var overrides on &lt;html&gt;. Chart marker colors are code constants (palette.ts) and won't change here.
          </div>
        </div>
      )}
    </>
  );
}
