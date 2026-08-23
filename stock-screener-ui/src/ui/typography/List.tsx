import MuiList from "@mui/material/List";
import MuiListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import Box from "@mui/material/Box";
import type { UIListProps, UIListItemProps } from "../types";

const sizeMap: Record<string, string> = {
  xs: "0.75rem",
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

export function List({
  children,
  type,
  withPadding,
  size,
  spacing,
  listStyleType,
  center,
  icon,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UIListProps) {
  const isOrdered = type === "ordered";
  const sx: Record<string, unknown> = {
    ...(size != null && { fontSize: sizeMap[size as string] ?? (size as string) }),
    ...(withPadding && { pl: 3 }),
    ...(listStyleType && { listStyleType: listStyleType as string }),
    ...(center && { textAlign: "center" }),
    ...(spacing != null && { "& > li + li": { mt: typeof spacing === "number" ? `${spacing}px` : spacing } }),
    ...(isOrdered ? {} : { listStyleType: listStyleType ?? "disc" }),
  };

  // Use Box as native ul/ol wrapper for listStyleType support, with MuiList for styling
  return (
    <Box
      component={isOrdered ? "ol" : "ul"}
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={{
        m: 0,
        p: 0,
        pl: withPadding ? 3 : 0,
        listStylePosition: "inside",
        ...sx,
      }}
      {...(rest as Record<string, unknown>)}
    >
      <MuiList
        dense
        disablePadding
        sx={{
          listStyleType: "inherit",
          p: 0,
          "& .MuiListItem-root": {
            display: "list-item",
            listStyleType: "inherit",
            px: 0,
            py: 0.25,
          },
        }}
      >
        {/* Pass icon via context-like: clone children if needed, but keep simple */}
        {icon ? (
          <Box sx={{ "& .MuiListItemIcon-root": { minWidth: 28 } }}>{children}</Box>
        ) : (
          children
        )}
      </MuiList>
    </Box>
  );
}

export function ListItem({ children, className, style, "data-testid": testId, id, ...rest }: UIListItemProps & { icon?: React.ReactNode }) {
  const icon = (rest as Record<string, unknown>).icon as React.ReactNode | undefined;
  // Strip icon from rest to avoid DOM warning
  const { icon: _omit, ...cleanRest } = rest as Record<string, unknown>;
  return (
    <MuiListItem className={className} style={style} id={id} data-testid={testId} sx={{ alignItems: "flex-start" }} {...(cleanRest as Record<string, unknown>)}>
      {icon ? <ListItemIcon sx={{ minWidth: 28, mt: 0.25 }}>{icon}</ListItemIcon> : null}
      {(() => { const LIT: any = ListItemText; return <LIT primary={children} primaryTypographyProps={{ component: "span", variant: "body2" }} sx={{ m: 0 }} />; })()}
    </MuiListItem>
  );
}

List.Item = ListItem;
