// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyColorScheme } from "@/ui/hooks";
import * as palette from "@/ui/palette";
import { UIProvider } from "@/ui/theme";
import { TOKEN_NAMES, tokenColor, tokenVar, useTokenColor } from "@/ui/tokens";

const root = () => document.documentElement;

afterEach(() => {
  vi.unstubAllGlobals();
  root().style.removeProperty("--color-fin-primary");
  applyColorScheme("dark");
});

describe("theme contract", () => {
  it("forceColorScheme writes the root attribute without persisting it", () => {
    localStorage.clear();
    localStorage.setItem("color-scheme", "light");

    createRoot(() => UIProvider({ forceColorScheme: "dark", children: "child" }));

    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(root().style.colorScheme).toBe("dark");
    expect(localStorage.getItem("color-scheme")).toBe("light");
  });

  it("defaultColorScheme writes the root attribute when there is no stored choice", () => {
    localStorage.clear();
    // index.html already painted its dark fallback onto <html>.
    applyColorScheme("dark");

    createRoot(() => UIProvider({ defaultColorScheme: "light", children: "child" }));

    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(localStorage.getItem("color-scheme")).toBeNull();
  });

  it("tokenColor reads the CSS variable and falls back to the palette anchor", () => {
    root().style.removeProperty("--color-fin-primary");
    expect(tokenColor("primary")).toBe(palette.PRIMARY);

    root().style.setProperty("--color-fin-primary", "rgb(1, 2, 3)");
    expect(tokenColor("primary")).toBe("rgb(1, 2, 3)");

    // No DOM (SSR / pre-hydration) must never throw.
    vi.stubGlobal("document", undefined);
    expect(tokenColor("bg")).toBe(palette.BG_COLOR);
  });

  it("useTokenColor follows a changed CSS variable without listeners", () => {
    root().style.setProperty("--color-fin-primary", "rgb(4, 5, 6)");
    let read!: () => string;
    const dispose = createRoot((dispose) => {
      read = useTokenColor("primary");
      return dispose;
    });

    expect(read()).toBe("rgb(4, 5, 6)");
    root().style.setProperty("--color-fin-primary", "rgb(7, 8, 9)");
    expect(read()).toBe("rgb(7, 8, 9)");
    dispose();
  });

  it("every token name has a dark declaration and a light override in CSS", () => {
    const css = readFileSync(resolve(process.cwd(), "src/tailwind.css"), "utf8");
    const names = (source: string) =>
      new Set([...source.matchAll(/--color-fin-([a-z-]+)\s*:/g)].map((match) => match[1]));
    const dark = names(css);
    const lightBlock = /:root\[data-color-scheme="light"\]\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? "";
    const light = names(lightBlock);

    const undeclared = TOKEN_NAMES.filter((name) => !dark.has(name));
    const unthemed = TOKEN_NAMES.filter((name) => !light.has(name));
    expect(undeclared, undeclared.map(tokenVar).join(", ")).toEqual([]);
    expect(unthemed, unthemed.map(tokenVar).join(", ")).toEqual([]);
  });
});
