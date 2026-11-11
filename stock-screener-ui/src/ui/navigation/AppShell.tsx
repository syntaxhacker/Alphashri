import { cn } from "../cn";
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

  return (
    <div
      className={cn("flex min-h-screen", className)}
      style={style}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {!headerCollapsed && header && (
        <header
          className="fixed inset-x-0 top-0 z-40"
          style={{ height: `${headerHeight}px` }}
          data-testid={testId ? `${testId}-header` : undefined}
        />
      )}
      {!navbarCollapsed && navbar && (
        <nav
          className="fixed inset-y-0 left-0 z-40 flex-shrink-0"
          style={{
            width: `${navbarWidth}px`,
            top: headerCollapsed ? 0 : headerHeight,
            height: headerCollapsed ? "100%" : `calc(100% - ${headerHeight}px)`,
          }}
          data-testid={testId ? `${testId}-navbar` : undefined}
        />
      )}
      <main
        className="flex-1 min-w-0 min-h-0"
        style={{
          marginLeft: navbarCollapsed || !navbar ? 0 : navbarWidth,
          marginTop: headerCollapsed || !header ? 0 : headerHeight,
          padding: padding != null ? (typeof padding === "number" ? `${padding}px` : String(padding)) : 0,
          minWidth: 0,
          minHeight: 0,
        }}
        data-testid={testId ? `${testId}-main` : undefined}
      >
        {children}
      </main>
    </div>
  );
}

export function AppShellHeader({ children, className, style, "data-testid": testId, id, ...rest }: UIAppShellHeaderProps) {
  return (
    <header
      className={cn("fixed inset-x-0 top-0 z-40", className)}
      style={style}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </header>
  );
}

export function AppShellNavbar({ p, children, className, style, "data-testid": testId, id, ...rest }: UIAppShellNavbarProps) {
  const pad = p != null ? (typeof p === "number" ? `${p * 8}px` : String(p)) : undefined;
  return (
    <nav
      className={cn("fixed inset-y-0 left-0 z-40 flex-shrink-0 w-[280px]", className)}
      style={{ width: "280px", padding: pad, ...style }}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </nav>
  );
}

export function AppShellMain({ children, className, style, "data-testid": testId, id, ...rest }: UIAppShellMainProps) {
  return (
    <main
      className={cn("flex-1 min-w-0 min-h-0 p-4", className)}
      style={style}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </main>
  );
}

export function AppShellSection({ children, className, style, "data-testid": testId, id, grow, component: _component, ...rest }: UIAppShellSectionProps) {
  return (
    <section
      className={cn(grow ? "flex-1" : "", className)}
      style={style}
      id={id}
      data-testid={testId}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </section>
  );
}
AppShell.Header = AppShellHeader;
AppShell.Navbar = AppShellNavbar;
AppShell.Main = AppShellMain;
AppShell.Section = AppShellSection;
