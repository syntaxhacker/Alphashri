import createCache from "@emotion/cache";

// Single shared Emotion cache for the whole app.
//
// `speedy: true` makes Emotion batch every rule into ONE <style> element via
// CSSOM `insertRule` (up to 65k rules per sheet). Emotion's default is
// `speedy: !isDev`, i.e. only production gets that path — in dev every rule
// gets its own <style> tag (for per-rule source maps), which measured ~924
// tags / 938 rules on the Nifty report page. Forcing it on in dev too keeps
// the dashboard cheap to recalc and makes dev rendering representative of
// production. The tradeoff is that rules are not editable in devtools.
//
// `prepend: true` keeps MUI's styles first in <head> so app CSS overrides win.
//
// `key: "mui"` scopes the generated class prefix; no app CSS targets `.css-*`,
// so this is safe (verified).
export const emotionCache = createCache({ key: "mui", prepend: true, speedy: true });
