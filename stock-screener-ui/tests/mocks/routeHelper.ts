function convertWildcards(path: string): string {
  return path.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]+");
}

/**
 * Escape regex special characters, but preserve [...]+ character class patterns.
 * This ensures regex patterns like [a-f0-9-]+ work correctly inside the path.
 */
function smartEscape(path: string): string {
  // Tokenize: capture character classes with optional quantifier ([...]+/*/?/{n,m})
  // OR single regex special chars. Everything else passes through unchanged.
  const tokenRegex = /\[[^\]]*\][+*?{]?|[.+?^${}()|[\]\\]/g;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(path)) !== null) {
    // Append text between last match and current match
    if (match.index > lastIndex) {
      result += path.slice(lastIndex, match.index);
    }

    const token = match[0];
    if (token.startsWith("[")) {
      // Character class with optional quantifier — preserve as-is
      result += token;
    } else {
      // Special regex char — escape it
      result += "\\" + token;
    }

    lastIndex = tokenRegex.lastIndex;
  }

  // Append remaining tail
  if (lastIndex < path.length) {
    result += path.slice(lastIndex);
  }

  return result;
}

/**
 * Creates a regex matching only localhost:8765 API routes.
 * Use instead of broad glob patterns that accidentally match Vite module imports.
 *
 * Supports: * (single segment), ** (any depth), and regex patterns like [a-f0-9-]+
 */
export function apiRoute(path: string): RegExp {
  const escaped = smartEscape(path);
  const withWildcards = convertWildcards(escaped);
  return new RegExp(`localhost:8765/api/${withWildcards}`);
}
