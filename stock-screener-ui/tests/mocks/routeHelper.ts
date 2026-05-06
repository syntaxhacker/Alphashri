function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function convertWildcards(path: string): string {
  return path.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]+");
}

/**
 * Creates a regex that matches only localhost:8765 API requests.
 * Prevents accidentally matching Vite module imports from src/api/.
 *
 * Example: apiRoute("auth/me") matches localhost:8765/api/auth/me
 * but NOT src/api/auth.ts (which a glob with ** followed by /api/auth/me would catch)
 */
export function apiRoute(path: string): RegExp {
  const escaped = escapeRegExp(path);
  const withWildcards = convertWildcards(escaped);
  return new RegExp(`localhost:8765/api/${withWildcards}`);
}
