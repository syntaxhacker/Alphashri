export const TABLE_STYLES = {
  thead: {
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    background: "var(--mantine-color-body)",
  },
  th: {
    padding: "4px 6px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "3px 6px",
    fontSize: "12px",
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
};
