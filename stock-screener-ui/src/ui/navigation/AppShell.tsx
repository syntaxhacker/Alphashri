import Box from "@mui/material/Box";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Drawer from "@mui/material/Drawer";
import type { UIAppShellProps, UIAppShellHeaderProps, UIAppShellNavbarProps, UIAppShellMainProps, UIAppShellSectionProps } from "../types";

function resolveDimension(v: number | string | undefined, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === "number") return v;
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? fallback : n;
}

function resolveNavbarWidth(width: UIAppShellProps["navbar"] extends infer T ? T extends { width?: infer W } ? W : never : never): number {
  if (width == null) return 280;
  if (typeof width === "number") return width;
  if (typeof width === "string") {
    const n = Number.parseInt(width, 10);
    return Number.isNaN(n) ? 280 : n;
  }
  if (typeof width === "object") {
    const vals = Object.values(width as Record<string, number | string>);
    for (let i = vals.length - 1; i >= 0; i--) {
      const v = vals[i];
      if (typeof v === "number") return v;
      const n = Number.parseInt(String(v), 10);
      if (!Number.isNaN(n)) return n;
    }
    return 280;
  }
  return 280;
}

function isCollapsed(c: boolean | { mobile?: boolean; desktop?: boolean } | undefined): boolean {
  if (c == null) return false;
  if (typeof c === "boolean") return c;
  return Boolean(c.desktop ?? c.mobile);
}

export function AppShell({ header, navbar, padding, children, className, style, "data-testid": testId, ...rest }: UIAppShellProps) {
  const headerHeight = resolveDimension(header?.height as any, 60);
  const headerCollapsed = Boolean(header?.collapsed);
  const navbarWidth = resolveNavbarWidth(navbar?.width as any);
  const navbarCollapsed = isCollapsed(navbar?.collapsed as any);

  // Support compound usage: children contains AppShell.Header / Navbar / Main
  // We also support flat children fallback.
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }} className={className} style={style} data-testid={testId} {...(rest as any)}>
      {!headerCollapsed && header && (
        <AppBar position="fixed" sx={{ height: headerHeight, zIndex: (t) => t.zIndex.drawer + 1 }} data-testid={testId ? `${testId}-header` : undefined}>
          <Toolbar sx={{ minHeight: headerHeight, height: headerHeight }}>{/* header content injected via AppShellHeader if used as compound */}</Toolbar>
        </AppBar>
      )}
      {!navbarCollapsed && navbar && (
        <Drawer
          variant="permanent"
          sx={{
            width: navbarWidth,
            flexShrink: 0,
            [`& .MuiDrawer-paper`]: { width: navbarWidth, boxSizing: "border-box", top: headerCollapsed ? 0 : headerHeight, height: headerCollapsed ? "100%" : `calc(100% - ${headerHeight}px)` },
          }}
          open
        >
          {/* Drawer content will be provided via AppShellNavbar children; this shell drawer is for layout reference.
              Actual content is rendered below via children pass-through with offsets. */}
        </Drawer>
      )}
      {/* Render children with correct offsets — if compound components are used, they will render themselves positioned correctly.
          For the shell-level layout, we also ensure main offset via Box. */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          ml: navbarCollapsed || !navbar ? 0 : `${navbarWidth}px`,
          mt: headerCollapsed || !header ? 0 : `${headerHeight}px`,
          p: padding != null ? (typeof padding === "number" ? `${padding}px` : String(padding)) : 0,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

export function AppShellHeader({ children, className, style, "data-testid": testId, ...rest }: UIAppShellHeaderProps) {
  // When used inside AppShell compound, render as fixed AppBar content
  // For standalone usage, render AppBar
  return (
    <AppBar position="fixed" className={className} style={style} data-testid={testId} {...(rest as any)} sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
      <Toolbar>{children}</Toolbar>
    </AppBar>
  );
}

export function AppShellNavbar({ p, children, className, style, "data-testid": testId, ...rest }: UIAppShellNavbarProps) {
  // Resolve p to padding
  const pad = p != null ? (typeof p === "number" ? `${p}px` : String(p)) : undefined;
  return (
    <Drawer
      variant="permanent"
      className={className}
      style={style}
      data-testid={testId}
      {...(rest as any)}
      sx={{ width: 280, flexShrink: 0, [`& .MuiDrawer-paper`]: { width: 280, boxSizing: "border-box", p: pad } }}
      open
    >
      <Box sx={pad ? { p: pad } : undefined}>{children}</Box>
    </Drawer>
  );
}

export function AppShellMain({ children, className, style, "data-testid": testId, ...rest }: UIAppShellMainProps) {
  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, p: 2 }} className={className} style={style} data-testid={testId} {...(rest as any)}>
      {children}
    </Box>
  );
}

export function AppShellSection({ children, className, style, "data-testid": testId, ...rest }: UIAppShellSectionProps) {
  const { grow, ...other } = rest as any;
  return (
    <Box sx={grow ? { flexGrow: 1 } : undefined} className={className} style={style} data-testid={testId} {...other}>
      {children}
    </Box>
  );
}
AppShell.Header = AppShellHeader;
AppShell.Navbar = AppShellNavbar;
AppShell.Main = AppShellMain;
AppShell.Section = AppShellSection;
