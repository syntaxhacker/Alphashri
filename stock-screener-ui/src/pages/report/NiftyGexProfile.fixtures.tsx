import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import type { NiftyGex } from "@/types/niftyReport";

// Shared by the stats, chart and state specs so a payload tweak cannot drift between them.
export function TestWrapper(props: { children?: JSX.Element }) {
  return <UIProvider>{props.children}</UIProvider>;
}

export function gex(overrides?: Partial<NiftyGex>): NiftyGex {
  return {
    strikes: [
      { strike: 22700, callGex: 5, putGex: -3, netGex: -2 },
      { strike: 22600, callGex: 1, putGex: 2, netGex: 12 },
      { strike: 22800, callGex: 9, putGex: -9, netGex: -8 },
    ],
    netTotal: 7.5,
    regime: "long",
    topPositive: [{ strike: 22600, netGex: 12 }],
    topNegative: [{ strike: 22800, netGex: -8 }],
    zeroCross: 22650,
    ...overrides,
  };
}
