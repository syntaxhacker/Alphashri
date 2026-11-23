// @vitest-environment happy-dom
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyColorScheme, useColorScheme } from "./hooks";
import { UIProvider } from "./theme";

const root = () => document.documentElement;
const body = () => document.body;

/** Keep the module-level scheme signal deterministic across tests in this file. */
function reset(scheme: "light" | "dark") {
  localStorage.clear();
  for (const el of [root(), body()]) {
    el.removeAttribute("data-color-scheme");
    el.style.colorScheme = "";
  }
  applyColorScheme(scheme);
}

beforeEach(() => reset("dark"));
afterEach(() => reset("dark"));

describe("UIProvider colour-scheme contract", () => {
  it("is a pass-through with no scheme props: the bootstrap choice survives", () => {
    // Simulate index.html: a stored preference was painted before the bundle.
    localStorage.setItem("color-scheme", "light");
    applyColorScheme("light");

    render(() => (
      <UIProvider>
        <span>child</span>
      </UIProvider>
    ));

    for (const el of [root(), body()]) {
      expect(el.getAttribute("data-color-scheme")).toBe("light");
      expect(el.style.colorScheme).toBe("light");
    }
    expect(localStorage.getItem("color-scheme")).toBe("light");
  });

  it("forceColorScheme writes the root attribute, wins over storage and default, and never persists", () => {
    localStorage.setItem("color-scheme", "light");
    let readScheme!: () => string;
    function Probe() {
      readScheme = useColorScheme().colorScheme;
      return null;
    }

    render(() => (
      <UIProvider forceColorScheme="dark" defaultColorScheme="light">
        <Probe />
      </UIProvider>
    ));

    for (const el of [root(), body()]) {
      expect(el.getAttribute("data-color-scheme")).toBe("dark");
      expect(el.style.colorScheme).toBe("dark");
    }
    expect(readScheme()).toBe("dark");
    // The stored key belongs to the user's toolbar choice, not to a prop.
    expect(localStorage.getItem("color-scheme")).toBe("light");
  });

  it("defaultColorScheme seeds the scheme only when nothing is stored", () => {
    // The pre-paint bootstrap always writes an attribute, defaulting to dark;
    // presence of that attribute alone is not a user choice.
    expect(root().getAttribute("data-color-scheme")).toBe("dark");

    render(() => (
      <UIProvider defaultColorScheme="light">
        <span>child</span>
      </UIProvider>
    ));

    for (const el of [root(), body()]) {
      expect(el.getAttribute("data-color-scheme")).toBe("light");
    }
    expect(localStorage.getItem("color-scheme")).toBeNull();
  });

  it("defaultColorScheme never overrides a stored choice", () => {
    localStorage.setItem("color-scheme", "dark");
    applyColorScheme("dark");

    render(() => (
      <UIProvider defaultColorScheme="light">
        <span>child</span>
      </UIProvider>
    ));

    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    expect(localStorage.getItem("color-scheme")).toBe("dark");
  });

  it("follows a later forceColorScheme prop change", () => {
    const [scheme, setScheme] = createSignal<"light" | "dark">("dark");
    function Host() {
      return (
        <UIProvider forceColorScheme={scheme()}>
          <span>child</span>
        </UIProvider>
      );
    }
    render(() => <Host />);

    expect(root().getAttribute("data-color-scheme")).toBe("dark");
    setScheme("light");
    expect(root().getAttribute("data-color-scheme")).toBe("light");
    expect(body().getAttribute("data-color-scheme")).toBe("light");
    expect(localStorage.getItem("color-scheme")).toBeNull();
  });
});
