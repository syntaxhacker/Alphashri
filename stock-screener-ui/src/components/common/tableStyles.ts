/**
 * Shared table styling constants used across table components.
 * Consolidates common Mantine Table style definitions to avoid duplication.
 */

export const COMMON_TABLE_STYLES = {
  thead: {
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    background: "var(--mantine-color-body)",
  },
  th: {
    padding: "3px 5px",
    fontSize: "10px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
    letterSpacing: "0.5px",
  },
  td: {
    padding: "3px 5px",
    fontSize: "12px",
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
};
