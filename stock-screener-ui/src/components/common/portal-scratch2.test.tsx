import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { PanelModal } from "./PanelModal";

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

afterEach(() => {
  cleanup();
  console.log("BODY:", document.body.innerHTML.slice(0, 200));
});

describe("panel modal cleanup", () => {
  test("mount one", () => {
    r(<PanelModal open title="A" onClose={() => {}}><div>b</div></PanelModal>);
    expect(screen.getByTestId("panel-modal")).toBeInTheDocument();
  });

  test("mount two", () => {
    r(<PanelModal open title="B" onClose={() => {}}><div>b</div></PanelModal>);
    expect(screen.getByTestId("panel-modal")).toBeInTheDocument();
  });
});
