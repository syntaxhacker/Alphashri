import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the UI package root (see package.json scripts). The second
// candidate keeps the guard usable if invoked from the monorepo root.
const ROOT = existsSync(join(process.cwd(), "storybook-static"))
  ? process.cwd()
  : join(process.cwd(), "stock-screener-ui");
const MANIFEST = join(ROOT, "storybook-static", "index.json");
const OVERVIEW = join(ROOT, "src", "stories", "design-system", "Overview.stories.tsx");

type Entry = { id: string; title: string; name: string; type: string; importPath?: string };
type Manifest = { v: number; entries: Record<string, Entry> };

// storybook-static is gitignored: a fresh checkout has no manifest until
// `bun run build-storybook` runs. Mark the whole guard skipped, loudly.
const ready = existsSync(MANIFEST) && existsSync(OVERVIEW);
if (!ready) {
  console.info(
    "[storybook-catalog] storybook-static/index.json not found — run `bun run build-storybook` " +
      "to generate it; skipping the Storybook catalog guard.",
  );
}

const catalog = ready ? describe : describe.skip;

catalog("Storybook catalog guard (storybook-static/index.json)", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
  const entries = Object.entries(manifest.entries ?? {});
  const stories = entries.filter(([, entry]) => entry.type === "story");
  const docs = entries.filter(([, entry]) => entry.type === "docs");

  it("has at least 66 story entries", () => {
    expect(stories.length, `expected >= 66 stories, got ${stories.length}`).toBeGreaterThanOrEqual(66);
  });

  it("has 13 docs entries with unique titles", () => {
    expect(docs.length, `expected 13 docs entries, got ${docs.length}`).toBe(13);
    expect(new Set(docs.map(([, entry]) => entry.title)).size, "docs titles must be unique").toBe(docs.length);
  });

  it("has one docs entry per story title", () => {
    const docTitles = new Set(docs.map(([, entry]) => entry.title));
    const withoutDocs = [...new Set(stories.map(([, entry]) => entry.title))].filter((title) => !docTitles.has(title));
    expect(withoutDocs, `story titles with no docs entry: ${withoutDocs.join(", ")}`).toEqual([]);
  });

  it("has unique ids consistent with their keys", () => {
    const keys = entries.map(([key]) => key);
    expect(new Set(keys).size, "duplicate entry ids").toBe(keys.length);
    const mismatches = entries.filter(([key, entry]) => entry.id !== key).map(([key]) => key);
    expect(mismatches, `entry id/key mismatches: ${mismatches.join(", ")}`).toEqual([]);
  });

  it("has no duplicate (title, name) pairs", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [id, entry] of stories) {
      const key = `${entry.title}\u0000${entry.name}`;
      const previous = seen.get(key);
      if (previous) duplicates.push(`${previous} and ${id} both use ${key.replace("\u0000", " / ")}`);
      else seen.set(key, id);
    }
    expect(duplicates, duplicates.join("\n")).toEqual([]);
  });

  it("resolves every ?path=/story/... link in Overview", () => {
    const source = readFileSync(OVERVIEW, "utf8");
    expect(source, "Overview must build links via ?path=/story/").toContain("?path=/story/");
    const refs = [
      ...new Set([...source.matchAll(/(?:id:\s*|id=)["']([a-z0-9-]+--[a-z0-9-]+)["']/g)].map((m) => m[1])),
    ];
    expect(refs.length, "Overview must reference story ids; parsing may have broken").toBeGreaterThan(10);
    const byId = new Map(entries);
    const broken = refs.filter((id) => byId.get(id)?.type !== "story");
    expect(
      broken,
      `Overview links with no story in the manifest: ${broken.join(", ")}. ` +
        "Fix the ids in src/stories/design-system/Overview.stories.tsx and rebuild storybook-static.",
    ).toEqual([]);
  });
});
