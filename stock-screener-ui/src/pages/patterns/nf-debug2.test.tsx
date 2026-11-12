// @vitest-environment happy-dom
import { it, vi, expect } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { Box, Text, Switch, Select, TextInput, Divider, ToolbarRow, Stack } from "@/ui";

vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  return uiLayoutStub(await importOriginal<Record<string, unknown>>());
});

it("500 stub boxes", () => {
  const t = Date.now();
  render(() => (
    <>
      {Array.from({ length: 500 }).map((_, i) => (
        <Box key={i} data-testid={`b${i}`} className="x y z w" style={{ padding: 4 }}><Text>x</Text></Box>
      ))}
    </>
  ));
  console.log("500 boxes:", Date.now() - t, "ms");
});

it("30 selects and switches", () => {
  const t = Date.now();
  render(() => (
    <>
      {Array.from({ length: 30 }).map((_, i) => (
        <Select key={i} data={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value="a" onChange={() => {}} />
      ))}
      {Array.from({ length: 30 }).map((_, i) => (
        <Switch key={i} checked={false} onChange={() => {}} label="X" />
      ))}
    </>
  ));
  console.log("30+30:", Date.now() - t, "ms");
});
