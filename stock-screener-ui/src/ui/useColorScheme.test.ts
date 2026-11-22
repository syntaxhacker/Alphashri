// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useColorScheme } from "./hooks";

const root = () => document.documentElement;

const setSystemScheme = (scheme: "light" | "dark") => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? scheme === "dark" : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
};

describe("useColorScheme", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    root().removeAttribute("data-color-scheme");
    root().style.colorScheme = "";
    vi.resetModules();
  });

  it("gives every caller the same scheme", () => {
    const toolbar = useColorScheme();
    const chart = useColorScheme();

    toolbar.setColorScheme("dark");
    expect(chart.colorScheme()).toBe("dark");
    expect(chart.isDark()).toBe(true);

    toolbar.toggleColorScheme();
    expect(chart.colorScheme()).toBe("light");
    expect(chart.isDark()).toBe(false);
  });

  it("writes the scheme to <html> and to the stored key", () => {
    const scheme = useColorScheme();

    scheme.setColorScheme("dark");
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(localStorage.getItem("color-scheme")).toBe("dark");

    scheme.setColorScheme("light");
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(localStorage.getItem("color-scheme")).toBe("light");
  });

  it("reads the stored scheme in preference to the system", async () => {
    localStorage.setItem("color-scheme", "light");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("light");
  });

  it("prefers the modern key over the legacy mui-color-scheme one", async () => {
    localStorage.setItem("color-scheme", "light");
    localStorage.setItem("mui-color-scheme", "dark");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("light");
  });

  it("still honours the legacy key when it is the only one", async () => {
    localStorage.setItem("mui-color-scheme", "dark");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("dark");
  });

  it("follows an applied dark attribute with no storage and a light system", async () => {
    setSystemScheme("light");
    root().setAttribute("data-color-scheme", "dark");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().isDark()).toBe(true);
    expect(fresh().colorScheme()).toBe("dark");
  });

  it("lets an applied light attribute win over a dark system preference", async () => {
    setSystemScheme("dark");
    root().setAttribute("data-color-scheme", "light");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("light");
    expect(fresh().isDark()).toBe(false);
  });

  it("lets an applied attribute win over a conflicting stored key", async () => {
    setSystemScheme("dark");
    localStorage.setItem("color-scheme", "dark");
    root().setAttribute("data-color-scheme", "light");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("light");
  });

  it("still prefers a stored key over a dark system when no attribute is applied", async () => {
    setSystemScheme("dark");
    localStorage.setItem("color-scheme", "light");
    const { useColorScheme: fresh } = await import("./hooks");
    expect(fresh().colorScheme()).toBe("light");
  });

  it("toggle writes both the attribute and the stored key", () => {
    const scheme = useColorScheme();
    scheme.setColorScheme("light");

    scheme.toggleColorScheme();
    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(localStorage.getItem("color-scheme")).toBe("dark");

    scheme.toggleColorScheme();
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(localStorage.getItem("color-scheme")).toBe("light");
  });
});

describe("pre-paint bootstrap", () => {
  // index.html duplicates the storage contract in ES5 because it has to run
  // before the bundle. That copy cannot import SCHEME_KEYS, so it drifts
  // silently unless something compares the two.
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const hookSource = readFileSync(resolve(process.cwd(), "src/ui/hooks.ts"), "utf8");
  const position = (source: string, key: string) => source.indexOf(`"${key}"`);

  it("reads both scheme keys, in the same order as the hook", () => {
    for (const key of ["color-scheme", "mui-color-scheme"]) {
      expect(position(html, key)).toBeGreaterThan(-1);
      expect(position(hookSource, key)).toBeGreaterThan(-1);
    }
    expect(position(html, "color-scheme")).toBeLessThan(position(html, "mui-color-scheme"));
    expect(position(hookSource, "color-scheme")).toBeLessThan(position(hookSource, "mui-color-scheme"));
  });

  it("sets the attribute the CSS keys off, before the app script runs", () => {
    expect(html).toContain('setAttribute("data-color-scheme"');
    expect(html.indexOf('setAttribute("data-color-scheme"')).toBeLessThan(
      html.indexOf('type="module"'),
    );
  });
});
