import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Evidence specs write captures outside the repo, but the shared workspace
 * artifact root is not writable by every CI runner. Keep that path when it is
 * writable and fall back to Playwright's own output tree otherwise.
 */
const SHARED_ROOT = "/workspaces/test-rag/.agent-artifacts/ui-a-plus";

export function uiArtifactRoot(...segments: string[]): string {
  const configured = process.env.UI_A_PLUS_ARTIFACT_ROOT;
  const candidates = configured
    ? [configured]
    : [SHARED_ROOT, path.resolve("test-results/ui-a-plus")];
  let lastError: unknown;
  for (const base of candidates) {
    const target = path.join(base, ...segments);
    try {
      mkdirSync(target, { recursive: true });
      return target;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
