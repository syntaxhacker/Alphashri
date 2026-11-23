import type { Meta, StoryObj } from "@storybook/html-vite";
import { solidStory } from "@/stories/solidStory";

const meta: Meta = {
  title: "Design System/Foundations",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Tokens and primitives used across the terminal. Values come from the running Tailwind/CSS-variable theme, not from a second hard-coded palette.",
      },
    },
  },
};
export default meta;

type Story = StoryObj;

const swatch = (name: string, token: string, ink = "var(--color-fin-bg)") => (
  <div style={{ "min-width": "132px" }}>
    <div
      style={{
        height: "44px",
        "border-radius": "6px",
        border: "1px solid var(--color-fin-border)",
        "background-color": token,
        color: ink,
        display: "flex",
        "align-items": "flex-end",
        padding: "6px",
        "font-size": "10px",
        "font-family": "ui-monospace, monospace",
      }}
    >
      {name}
    </div>
    <div style={{ "margin-top": "4px", "font-size": "10px", color: "var(--color-fin-text-muted)", "font-family": "ui-monospace, monospace" }}>
      {token}
    </div>
  </div>
);

export const ColorTokens: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "10px", "max-width": "980px" }}>
        {swatch("primary", "var(--color-fin-primary)")}
        {swatch("positive", "var(--color-fin-positive)")}
        {swatch("negative", "var(--color-fin-negative)")}
        {swatch("warning", "var(--color-fin-warning)")}
        {swatch("info", "var(--color-fin-info)")}
        {swatch("surface", "var(--color-fin-surface)", "var(--color-fin-text)")}
        {swatch("surface-alt", "var(--color-fin-surface-alt)", "var(--color-fin-text)")}
        {swatch("border", "var(--color-fin-border)", "var(--color-fin-text)")}
        {swatch("text", "var(--color-fin-text)")}
        {swatch("text-muted", "var(--color-fin-text-muted)")}
      </div>
    )),
};

export const TypographyScale: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "12px", "max-width": "760px" }}>
        {[
          ["Display / 28px", "28px", 700],
          ["Title / 20px", "20px", 700],
          ["Subtitle / 16px", "16px", 600],
          ["Body / 13px", "13px", 400],
          ["Caption / 11px", "11px", 500],
          ["Micro / 9px", "9px", 500],
        ].map(([label, size, weight]) => (
          <div style={{ display: "flex", "align-items": "baseline", gap: "16px", "border-bottom": "1px solid var(--color-fin-border)", "padding-bottom": "8px" }}>
            <span style={{ width: "150px", color: "var(--color-fin-text-muted)", "font-family": "ui-monospace, monospace", "font-size": "10px" }}>{label}</span>
            <span style={{ "font-size": String(size), "font-weight": Number(weight), "letter-spacing": Number(size) >= 20 ? "-0.02em" : "0" }}>
              Alphashri terminal 1,234.56
            </span>
          </div>
        ))}
      </div>
    )),
};

export const SpacingScale: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "8px", "max-width": "720px" }}>
        {[1, 2, 3, 4, 6, 8, 12, 16].map((step) => (
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ width: "48px", color: "var(--color-fin-text-muted)", "font-family": "ui-monospace, monospace", "font-size": "10px" }}>
              {step * 4}px
            </span>
            <div style={{ width: `${step * 4}px`, height: "12px", "border-radius": "2px", background: "var(--color-fin-primary)" }} />
            <span style={{ color: "var(--color-fin-text-muted)", "font-size": "10px" }}>space-{step}</span>
          </div>
        ))}
      </div>
    )),
};

export const RadiusAndMotion: Story = {
  render: () =>
    solidStory(() => (
      <div style={{ display: "grid", gap: "24px" }}>
        <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
          {[2, 4, 6, 8, 16].map((radius) => (
            <div
              style={{
                width: "72px",
                height: "48px",
                "border-radius": `${radius}px`,
                border: "1px solid var(--color-fin-border)",
                background: "var(--color-fin-surface-alt)",
                display: "grid",
                "place-items": "center",
                color: "var(--color-fin-text-muted)",
                "font-family": "ui-monospace, monospace",
                "font-size": "10px",
              }}
            >
              {radius}px
            </div>
          ))}
        </div>
        <div style={{ color: "var(--color-fin-text-muted)", "font-size": "11px" }}>
          Motion: 120ms linear for state flashes, 150–180ms ease for transforms, 0ms under <code>prefers-reduced-motion</code>.
        </div>
      </div>
    )),
};
