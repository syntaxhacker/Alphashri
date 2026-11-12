// @vitest-environment happy-dom
import { it, expect } from "vitest";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";

it("import cost", () => {
  console.log("rail module imported:", Date.now(), typeof PatternFilterRail);
  expect(typeof PatternFilterRail).toBe("function");
});
