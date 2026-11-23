import { describe, expect, test } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { TYPE_SCALE, TYPE_CLASS, typeSize } from "@/ui";
import { BadgeCell, SymbolCell } from "./tableCells";
import { KeyValue } from "./KeyValue";

describe("component typography contract", () => {
  test("dense table text uses the shared micro tier, never a private pixel size", () => {
    render(() => (
      <>
        <SymbolCell symbol="RELIANCE" name="Reliance Industries" testId="token-symbol" />
        <BadgeCell label="EQ" testId="token-badge" />
        <KeyValue label="LTP" value="2,850" testId="token-kv" />
      </>
    ));

    expect(screen.getByText("Reliance Industries").className).toContain(TYPE_CLASS.micro);
    expect(screen.getByTestId("token-badge").style.fontSize).toBe(`${typeSize("micro")}px`);
    expect(screen.getByTestId("token-kv-label").style.fontSize).toBe(`${typeSize("micro")}px`);
    expect(TYPE_SCALE.micro.size).toBe(typeSize("micro"));
  });
});
