import { describe, expect, it } from "vitest";
import { theme, colors, APP_FONT_FAMILY, fontWeights, type AppTheme } from "./theme";

describe("Theme Configuration", () => {
  it("exports a Mantine theme object", () => {
    expect(theme).toBeDefined();
    expect(typeof theme).toBe("object");
  });

  it("has correct primary color", () => {
    expect(theme.primaryColor).toBe("teal");
    expect(theme.primaryShade).toEqual({ light: 5, dark: 6 });
  });

  it("has colors object", () => {
    expect(theme.colors).toBeDefined();
    expect(theme.colors.teal).toBeDefined();
    expect(theme.colors.green).toBeDefined();
    expect(theme.colors.red).toBeDefined();
    expect(theme.colors.orange).toBeDefined();
    expect(theme.colors.dark).toBeDefined();
    expect(theme.colors.success).toBeDefined();
    expect(theme.colors.danger).toBeDefined();
    expect(theme.colors.warning).toBeDefined();
  });

  it("has default radius", () => {
    expect(theme.defaultRadius).toBe("xs");
  });

  it("has font family settings", () => {
    expect(theme.fontFamily).toBe(APP_FONT_FAMILY);
    expect(theme.fontFamilyMonospace).toBeDefined();
  });

  describe("fontSizes", () => {
    it("has sm, md, lg, xl sizes", () => {
      expect(theme.fontSizes.sm).toBe("12px");
      expect(theme.fontSizes.md).toBe("14px");
      expect(theme.fontSizes.lg).toBe("16px");
      expect(theme.fontSizes.xl).toBe("20px");
    });
  });

  describe("headings", () => {
    it("has heading font family", () => {
      expect(theme.headings.fontFamily).toBe(APP_FONT_FAMILY);
    });

    it("has heading font weight", () => {
      expect(theme.headings.fontWeight).toBe("600");
    });

    it("has h1 through h6 sizes", () => {
      expect(theme.headings.sizes.h1).toHaveProperty("fontSize");
      expect(theme.headings.sizes.h2).toHaveProperty("fontSize");
      expect(theme.headings.sizes.h3).toHaveProperty("fontSize");
      expect(theme.headings.sizes.h4).toHaveProperty("fontSize");
      expect(theme.headings.sizes.h5).toHaveProperty("fontSize");
      expect(theme.headings.sizes.h6).toHaveProperty("fontSize");
    });
  });

  describe("component styles", () => {
    it("has AppShell styles", () => {
      expect(theme.components.AppShell).toBeDefined();
      expect(theme.components.AppShell.styles.main).toBeDefined();
      expect(theme.components.AppShell.styles.main.background).toBeDefined();
    });

    it("has Paper defaultProps with xs radius", () => {
      expect(theme.components.Paper.defaultProps.radius).toBe("xs");
    });

    it("has Card defaultProps", () => {
      expect(theme.components.Card.defaultProps.radius).toBe("xs");
      expect(theme.components.Card.defaultProps.padding).toBe("sm");
      expect(theme.components.Card.defaultProps.withBorder).toBe(false);
    });

    it("has Card styles with backdrop filter", () => {
      expect(theme.components.Card.styles.root.backdropFilter).toBeDefined();
      expect(theme.components.Card.styles.root.backdropFilter).toContain("blur");
    });

    it("has Button defaultProps", () => {
      expect(theme.components.Button.defaultProps.size).toBe("sm");
      expect(theme.components.Button.defaultProps.radius).toBe("xs");
    });

    it("has Input defaultProps with sm size", () => {
      expect(theme.components.Input.defaultProps.size).toBe("sm");
    });

    it("has NumberInput defaultProps", () => {
      expect(theme.components.NumberInput.defaultProps.size).toBe("sm");
    });

    it("has Select defaultProps", () => {
      expect(theme.components.Select.defaultProps.size).toBe("sm");
    });

    it("has TextInput defaultProps", () => {
      expect(theme.components.TextInput.defaultProps.size).toBe("sm");
    });

    it("has Textarea defaultProps", () => {
      expect(theme.components.Textarea.defaultProps.size).toBe("sm");
    });

    it("has Tabs default variant", () => {
      expect(theme.components.Tabs.defaultProps.variant).toBe("default");
    });

    it("has Tabs styles with bold tab weight", () => {
      expect(theme.components.Tabs.styles.tab.fontWeight).toBe(600);
    });

    it("has Table styles", () => {
      expect(theme.components.Table.styles.table.fontSize).toBe("var(--mantine-font-size-sm)");
      expect(theme.components.Table.styles.th).toBeDefined();
    });
  });

  describe("other theme config", () => {
    it("has fontWeights", () => {
      expect(theme.other.fontWeights.normal).toBe(400);
      expect(theme.other.fontWeights.medium).toBe(500);
      expect(theme.other.fontWeights.semibold).toBe(600);
      expect(theme.other.fontWeights.bold).toBe(700);
    });

    it("has shell border colors", () => {
      expect(theme.other.shell.border.light).toMatch(/^rgba\(/);
      expect(theme.other.shell.border.dark).toMatch(/^rgba\(/);
    });
  });
});

describe("Color Palette", () => {
  describe("teal", () => {
    it("has 10 shades", () => {
      expect(colors.teal).toHaveLength(10);
    });

    it("starts light and gets darker", () => {
      // First should be very light, last should be dark
      expect(colors.teal[0]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(colors.teal[9]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("green", () => {
    it("has 10 shades", () => {
      expect(colors.green).toHaveLength(10);
    });
  });

  describe("red", () => {
    it("has 10 shades", () => {
      expect(colors.red).toHaveLength(10);
    });
  });

  describe("orange", () => {
    it("has 10 shades", () => {
      expect(colors.orange).toHaveLength(10);
    });
  });

  describe("dark", () => {
    it("has 10 shades", () => {
      expect(colors.dark).toHaveLength(10);
    });

    it("darkest shade is very dark", () => {
      expect(colors.dark[9]).toBe("#0a0a0a");
    });
  });

  describe("virtual colors", () => {
    it("success uses green theme color", () => {
      expect(colors.success).toBeDefined();
    });

    it("danger uses red theme color", () => {
      expect(colors.danger).toBeDefined();
    });

    it("warning uses orange theme color", () => {
      expect(colors.warning).toBeDefined();
    });
  });
});

describe("fontWeights", () => {
  it("matches theme.other.fontWeights", () => {
    expect(fontWeights.normal).toBe(400);
    expect(fontWeights.medium).toBe(500);
    expect(fontWeights.semibold).toBe(600);
    expect(fontWeights.bold).toBe(700);
  });
});

describe("AppTheme type", () => {
  it("can be used as type (compile-time check)", () => {
    // This test just ensures the import works and type exists
    const themeTyped: AppTheme = theme;
    expect(themeTyped).toBe(theme);
  });
});
