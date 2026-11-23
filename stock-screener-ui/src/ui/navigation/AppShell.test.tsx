// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen, within } from "@solidjs/testing-library";
import {
  AppShell, AppShellHeader, AppShellMain, AppShellNavbar, AppShellSection,
} from "./AppShell";

afterEach(cleanup);

describe("AppShell", () => {
  test("config props build a header, navbar and main with matching offsets", () => {
    render(() => (
      <AppShell data-testid="shell" header={{ height: 48 }} navbar={{ width: 220 }} padding={16}>
        <p data-testid="content">Screener</p>
      </AppShell>
    ));

    const header = screen.getByTestId("shell-header");
    const navbar = screen.getByTestId("shell-navbar");
    const main = screen.getByTestId("shell-main");

    expect(screen.getByTestId("shell").className).toContain("flex");
    expect(header.tagName).toBe("HEADER");
    expect(header.style.height).toBe("48px");
    expect(navbar.tagName).toBe("NAV");
    expect(navbar.style.width).toBe("220px");
    expect(navbar.style.top).toBe("48px");
    expect(main.tagName).toBe("MAIN");
    expect(main.style.marginLeft).toBe("220px");
    expect(main.style.marginTop).toBe("48px");
    expect(main.style.padding).toBe("16px");
    expect(within(main).getByTestId("content")).toHaveTextContent("Screener");
  });

  test("parseable string dimensions produce the same pixel offsets", () => {
    render(() => (
      <AppShell data-testid="shell" header={{ height: "72px" }} navbar={{ width: "240px" }}>
        <p>content</p>
      </AppShell>
    ));

    expect(screen.getByTestId("shell-header").style.height).toBe("72px");
    expect(screen.getByTestId("shell-navbar").style.width).toBe("240px");
    expect(screen.getByTestId("shell-main").style.marginLeft).toBe("240px");
    expect(screen.getByTestId("shell-main").style.marginTop).toBe("72px");
  });

  test("collapsed chrome removes both bars and their main margins", () => {
    render(() => (
      <AppShell
        data-testid="shell"
        header={{ height: 48, collapsed: true }}
        navbar={{ width: 220, collapsed: { desktop: true } }}
      >
        <p data-testid="content">Still visible</p>
      </AppShell>
    ));

    expect(screen.queryByTestId("shell-header")).toBeNull();
    expect(screen.queryByTestId("shell-navbar")).toBeNull();
    const main = screen.getByTestId("shell-main");
    expect(main.style.marginLeft).toBe("0px");
    expect(main.style.marginTop).toBe("0px");
    expect(within(main).getByTestId("content")).toHaveTextContent("Still visible");
  });

  test("a navbar width map resolves its last declared value for the main offset", () => {
    render(() => (
      <AppShell data-testid="shell" navbar={{ width: { base: 180, lg: 280 } }}>
        <p>content</p>
      </AppShell>
    ));

    expect(screen.getByTestId("shell-navbar").style.width).toBe("280px");
    expect(screen.getByTestId("shell-main").style.marginLeft).toBe("280px");
  });

  test("exported parts render semantic elements and forward their own props", () => {
    render(() => (
      <>
        <AppShellHeader data-testid="header-part" id="chrome-header">Brand</AppShellHeader>
        <AppShellNavbar data-testid="navbar-part" p={1}>Nav</AppShellNavbar>
        <AppShellMain data-testid="main-part" className="p-4">
          <AppShellSection data-testid="section-part" grow>Section</AppShellSection>
        </AppShellMain>
      </>
    ));

    const header = screen.getByTestId("header-part");
    const navbar = screen.getByTestId("navbar-part");
    const main = screen.getByTestId("main-part");
    const section = screen.getByTestId("section-part");

    expect(header.tagName).toBe("HEADER");
    expect(header).toHaveAttribute("id", "chrome-header");
    expect(header).toHaveTextContent("Brand");
    expect(navbar.tagName).toBe("NAV");
    expect(navbar.style.width).toBe("280px");
    expect(navbar.style.padding).toBe("8px");
    expect(navbar).toHaveTextContent("Nav");
    expect(main.tagName).toBe("MAIN");
    expect(main.className).toContain("p-4");
    expect(section.tagName).toBe("SECTION");
    expect(section.className).toContain("flex-1");
    expect(section).toHaveTextContent("Section");
  });
});
