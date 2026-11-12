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

describe("useDebouncedValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at the input value", () => {
    let result: string;
    createRoot(() => {
      const [debounced] = useDebouncedValue("hello", 100);
      result = debounced();
    });
    expect(result).toBe("hello");
  });
});

describe("useDisclosure", () => {
  it("opens, closes and toggles", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    let opened: boolean;
    createRoot(() => {
      const [o, { open, close, toggle }] = useDisclosure(false, { onOpen, onClose });
      expect(o()).toBe(false);
      open();
      expect(o()).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
      close();
      expect(o()).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
      toggle();
      expect(o()).toBe(true);
      opened = o();
    });
    expect(opened).toBe(true);
  });
});

describe("useColorScheme", () => {
  it("reads the stored scheme and applies data-color-scheme", () => {
    localStorage.setItem("color-scheme", "dark");
    let cs: any;
    createRoot(() => {
      cs = useColorScheme();
    });
    expect(cs.colorScheme()).toBe("dark");
    expect(cs.isDark()).toBe(true);
    expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
  });

  it("toggles the scheme", () => {
    localStorage.removeItem("color-scheme");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    let cs: any;
    createRoot(() => {
      cs = useColorScheme();
    });
    expect(cs.colorScheme()).toBe("light");
    cs.toggleColorScheme();
    expect(cs.colorScheme()).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
  });
});

describe("useTheme / useUICore", () => {
  it("returns the sxTheme", () => {
    let theme: any;
    createRoot(() => {
      theme = useTheme();
    });
    expect(theme).toBeDefined();
    expect(useUICore()).toBe(theme);
  });
});

describe("useTree", () => {
  it("toggles and sets expanded values", () => {
    let vals: string;
    createRoot(() => {
      const { expanded, toggleExpanded, setExpanded } = useTree({ initialExpandedState: ["a"] });
      vals = expanded().join(",");
      expect(vals).toBe("a");
      toggleExpanded("b");
      expect(expanded().join(",")).toBe("a,b");
      setExpanded(["z"]);
      expect(expanded().join(",")).toBe("z");
    });
    expect(vals).toBe("a");
  });
});

describe("getTreeExpandedState", () => {
  const data = [
    { value: "a", children: [{ value: "a1" }, { value: "a2" }] },
    { value: "b" },
  ];

  it("expands every node with '*'", () => {
    expect(getTreeExpandedState(data, "*")).toEqual(["a", "a1", "a2", "b"]);
  });

  it("passes arrays through", () => {
    expect(getTreeExpandedState(data, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("reads a record of value->bool", () => {
    expect(getTreeExpandedState(data, { a: true, b: false })).toEqual(["a"]);
  });

  it("returns [] for unknown input", () => {
    expect(getTreeExpandedState(data, null)).toEqual([]);
    expect(getTreeExpandedState(data, undefined)).toEqual([]);
  });
});
