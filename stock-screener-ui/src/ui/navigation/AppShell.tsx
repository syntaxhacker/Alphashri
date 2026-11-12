import { splitProps } from "solid-js";
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

export function AppShell(props: UIAppShellProps) {
  const [known, _rest] = splitProps(props, ["header", "navbar", "padding", "children", "className", "style", "data-testid"]);

  const headerHeight = resolveDimension(known.header?.height as any, 60);
  const headerCollapsed = Boolean(known.header?.collapsed);
  const navbarWidth = resolveNavbarWidth(known.navbar?.width as any);
  const navbarCollapsed = isCollapsed(known.navbar?.collapsed as any);

  return (
    <div
      className={cn("flex min-h-screen", known.className)}
      style={known.style}
      data-testid={known["data-testid"]}
    >
      {!headerCollapsed && known.header && (
        <header
          className="fixed inset-x-0 top-0 z-40"
          style={{ height: `${headerHeight}px` }}
          data-testid={known["data-testid"] ? `${known["data-testid"]}-header` : undefined}
        />
      )}
      {!navbarCollapsed && known.navbar && (
        <nav
          className="fixed inset-y-0 left-0 z-40 flex-shrink-0"
          style={{
            width: `${navbarWidth}px`,
            top: headerCollapsed ? 0 : headerHeight,
            height: headerCollapsed ? "100%" : `calc(100% - ${headerHeight}px)`,
          }}
          data-testid={known["data-testid"] ? `${known["data-testid"]}-navbar` : undefined}
        />
      )}
      <main
        className="flex-1 min-w-0 min-h-0"
        style={{
          marginLeft: navbarCollapsed || !known.navbar ? 0 : navbarWidth,
          marginTop: headerCollapsed || !known.header ? 0 : headerHeight,
          padding: known.padding != null ? (typeof known.padding === "number" ? `${known.padding}px` : String(known.padding)) : 0,
          minWidth: 0,
          minHeight: 0,
        }}
        data-testid={known["data-testid"] ? `${known["data-testid"]}-main` : undefined}
      >
        {known.children}
      </main>
    </div>
  );
}

export function AppShellHeader(props: UIAppShellHeaderProps) {
  const [known, _rest] = splitProps(props, ["children", "className", "style", "data-testid", "id"]);
  return (
    <header
      className={cn("fixed inset-x-0 top-0 z-40", known.className)}
      style={known.style}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </header>
  );
}

export function AppShellNavbar(props: UIAppShellNavbarProps) {
  const [known, _rest] = splitProps(props, ["p", "children", "className", "style", "data-testid", "id"]);
  const pad = known.p != null ? (typeof known.p === "number" ? `${known.p * 8}px` : String(known.p)) : undefined;
  return (
    <nav
      className={cn("fixed inset-y-0 left-0 z-40 flex-shrink-0 w-[280px]", known.className)}
      style={{ width: "280px", padding: pad, ...known.style }}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </nav>
  );
}

export function AppShellMain(props: UIAppShellMainProps) {
  const [known, _rest] = splitProps(props, ["children", "className", "style", "data-testid", "id"]);
  return (
    <main
      className={cn("flex-1 min-w-0 min-h-0 p-4", known.className)}
      style={known.style}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </main>
  );
}

export function AppShellSection(props: UIAppShellSectionProps) {
  const [known, _rest] = splitProps(props, ["children", "className", "style", "data-testid", "id", "grow"]);
  return (
    <section
      className={cn(known.grow ? "flex-1" : "", known.className)}
      style={known.style}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </section>
  );
}

AppShell.Header = AppShellHeader;
AppShell.Navbar = AppShellNavbar;
AppShell.Main = AppShellMain;
AppShell.Section = AppShellSection;
