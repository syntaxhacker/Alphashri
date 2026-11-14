import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

const lazyImports = Array.from(appSource.matchAll(/lazy\(\(\)\s*=>\s*import\("([^"]+)"\)/g)).map(
  (match) => match[1],
);

const routeModules = import.meta.glob("../**/*.{ts,tsx}");

function resolveModule(specifier: string): (() => Promise<unknown>) | undefined {
  const base = specifier.startsWith(".") ? `..${specifier.slice(1)}` : specifier;
  const candidates = [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`];
  const key = candidates.find((candidate) => candidate in routeModules);
  return key ? (routeModules[key] as () => Promise<unknown>) : undefined;
}

describe("route modules", () => {
  it("App.tsx declares lazy route modules", () => {
    expect(lazyImports.length).toBeGreaterThan(20);
  });

  it(
    "every lazy route specifier resolves and evaluates without throwing",
    async () => {
      const failures: string[] = [];
      for (const specifier of lazyImports) {
        const load = resolveModule(specifier);
        if (!load) {
          failures.push(`${specifier}: module not found`);
          continue;
        }
        try {
          const mod = (await load()) as Record<string, unknown>;
          const hasComponent = Object.values(mod).some((value) => typeof value === "function");
          if (!hasComponent) failures.push(`${specifier}: module has no function export`);
        } catch (error) {
          failures.push(`${specifier}: ${(error as Error).message}`);
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    },
    120000,
  );
});
