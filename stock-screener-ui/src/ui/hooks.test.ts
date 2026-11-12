import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createRoot } from "solid-js";
import {
  rem,
  useMediaQuery,
  useDebouncedValue,
  useDisclosure,
  useColorScheme,
  useTheme,
  useUICore,
  useTree,
  getTreeExpandedState,
} from "./hooks";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rem", () => {
  it("converts px to rem", () => {
    expect(rem(16)).toBe("1rem");
    expect(rem(32)).toBe("2rem");
    expect(rem("32")).toBe("2rem");
    expect(rem("auto")).toBe("auto");
  });
});

describe("useMediaQuery", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });

  it("returns the default when matchMedia is absent", () => {
    (window.matchMedia as any).mockImplementation(() => undefined as any);
    let result: () => boolean;
    createRoot(() => {
      result = useMediaQuery("(min-width: 1200px)", true);
    });
    expect(result()).toBe(true);
  });

  it("reacts to matchMedia changes", () => {
    const mql = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    (window.matchMedia as any).mockReturnValue(mql);
    let result: () => boolean;
    createRoot(() => {
      result = useMediaQuery("(min-width: 1200px)");
    });
    expect(result()).toBe(false);
    mql.matches = true;
    (mql.addEventListener as any).mock.calls[0]?.[1]?.({ matches: true } as any);
    expect(result()).toBe(true);
  });
});

