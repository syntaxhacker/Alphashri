// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Box, Flex } from "@/ui";

// Regression: @/ui Box/Flex used to spread a caller's `sx` over their built-in
// sx, wiping shorthand props (e.g. Flex's `display:flex`/`height`). They now merge.
describe("@/ui Box/Flex sx merging", () => {
  test("Flex keeps its built flex styles when a caller passes sx", () => {
    const { container } = render(
      <Flex direction="column" h="100%" sx={{ minHeight: 0 }}>
        <span>x</span>
      </Flex>,
    );
    const el = container.firstElementChild as HTMLElement;
    const cs = getComputedStyle(el);
    expect(cs.display).toBe("flex");
    expect(cs.flexDirection).toBe("column");
    expect(cs.height).toBe("100%");
    expect(["0px", "0"]).toContain(cs.minHeight);
  });

  test("Box keeps shorthand props alongside a caller sx", () => {
    const { container } = render(
      <Box w={120} sx={{ color: "rgb(255, 0, 0)" }}>
        x
      </Box>,
    );
    const el = container.firstElementChild as HTMLElement;
    const cs = getComputedStyle(el);
    expect(cs.width).toBe("120px");
    expect(cs.color).toBe("rgb(255, 0, 0)");
  });
});
