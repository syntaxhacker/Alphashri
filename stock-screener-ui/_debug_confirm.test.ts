// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
describe("debug", () => {
  test("check confirm", () => {
    expect(typeof window.confirm).toBe("function");
    expect(typeof window.alert).toBe("function");
  });
});
