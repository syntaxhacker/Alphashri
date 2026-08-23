// Common sx helpers — single source for repeated MUI sx patterns
// Import via: import { sxPaper, sxDivider, sxCardBorder } from "@/ui/sx" or "../../ui/sx"

export const sxPaper = { bgcolor: "background.paper", borderColor: "divider" } as const;
export const sxDivider = { borderColor: "divider" } as const;
export const sxCardBorder = { border: 1, borderColor: "divider", bgcolor: "background.paper" } as const;
export const sxPaperBorder = { border: 1, borderColor: "divider", bgcolor: "background.paper" } as const;
export const sxBorderTop = { borderTop: 1, borderColor: "divider" } as const;
export const sxBorderBottom = { borderBottom: 1, borderColor: "divider" } as const;
export const sxBorderDivider = { border: "1px solid", borderColor: "divider" } as const;
export const sxFlexPaper = { display: "flex", flexDirection: "column", minHeight: 0 } as const;
