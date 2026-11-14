/** 24px control height: the chain toolbar is one line, so every control is xs. */
export const CHAIN_CONTROL_H = 24;

/**
 * The kit's `xs` select keeps its own 6px block padding (a 30px glyph inside a
 * 24px box, which bleeds over the band rule). The descendant selector wins on
 * specificity over the utility on the <select> itself.
 */
export const CHAIN_SELECT_CLASS = "[&_select]:py-[3px]";

/** 10px semibold uppercase caption, used as an in-control adornment. */
export const CHAIN_LABEL_CLASS =
  "shrink-0 text-[10px] font-semibold uppercase leading-none tracking-[0.06em] text-fin-text-muted";