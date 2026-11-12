// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { useDisclosure } from "@/ui/hooks";
import type { JSX } from "solid-js";

afterEach(cleanup);

describe("useDisclosure probe", () => {
  test("toggle flips state", async () => {
    function Probe() {
      const [opened, { toggle }] = useDisclosure(false);
      return (
        <button data-testid="t" onClick={() => { console.log("BEFORE toggle, opened():", opened()); toggle(); console.log("AFTER toggle, opened():", opened()); }}>
          {opened() ? "on" : "off"}
        </button>
      );
    }
    render(() => <Probe />);
    const t = screen.getByTestId("t");
    console.log("TEXT BEFORE CLICK:", t.textContent);
    await fireEvent.click(t);
    console.log("TEXT AFTER CLICK:", t.textContent);
    expect(t.textContent).toBe("on");
  });
});
