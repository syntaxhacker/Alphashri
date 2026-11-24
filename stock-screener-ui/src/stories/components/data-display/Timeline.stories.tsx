import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Badge, Group, Stack, Text, Timeline } from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Data display/Timeline",
  tags: ["autodocs"],
  component: Timeline as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Timeline is an ordered list of Timeline.Item nodes joined by a rail. `color` on the list sets a fallback tone and `color` on an item overrides it; `toneColor` maps success → positive, error/danger → negative, warning → warning, info → info, secondary → muted, anything else → primary. `bulletSize`, `lineWidth` and `align` control the rail, and each item takes `lineVariant` (solid / dashed / dotted) plus a custom `bullet`. `active` and `reverseActive` are accepted by the API but are not consumed by the current renderer, so the ActiveStep story composes emphasis explicitly instead of relying on them.",
      },
    },
  },
  argTypes: {
    active: { control: "number", description: "Accepted for API compatibility; the current renderer does not read it." },
    color: {
      control: "select",
      options: ["primary", "success", "error", "danger", "warning", "info", "secondary"],
      description: "Fallback bullet tone for items that do not set their own color.",
    },
    align: { control: "inline-radio", options: ["left", "right"], description: "Which side the rail sits on." },
    bulletSize: { control: "number", description: "Bullet diameter in px (default 20)." },
    lineWidth: { control: "number", description: "Connector width in px (default 2)." },
    reverseActive: { control: "boolean", description: "Accepted for API compatibility; currently a no-op." },
  },
  args: { active: 1, color: "primary", align: "left", bulletSize: 20, lineWidth: 2 },
};
export default meta;
type Story = StoryObj;

export const Playground: Story = {
  render: (args) =>
    solidStory(() => (
      <Page>
        <Specimen
          title="Playground"
          code={`color="${String(args.color)}" · bulletSize=${String(args.bulletSize)} · lineWidth=${String(args.lineWidth)}`}
        >
          <Stack gap="sm">
            <Readout>{`Step ${Number(args.active ?? 0) + 1} of 3 · rail on the ${String(args.align)}`}</Readout>
            <Timeline
              active={args.active}
              color={args.color}
              align={args.align}
              bulletSize={args.bulletSize}
              lineWidth={args.lineWidth}
              {...({ "aria-label": "Session steps" } as Record<string, unknown>)}
            >
              <Timeline.Item title="Scan">214 symbols had a valid frame.</Timeline.Item>
              <Timeline.Item title="Filter">18 actionable rows after the gates.</Timeline.Item>
              <Timeline.Item title="Commit">Structure staged for the paper book.</Timeline.Item>
            </Timeline>
          </Stack>
        </Specimen>
      </Page>
    )),
};

export const Tones: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen
            title="Item tones"
            note="Per-item color wins over the list color. error and danger both resolve to the negative token."
          >
            <Timeline color="primary" bulletSize={18} lineWidth={2} {...({ "aria-label": "Timeline tone examples" } as Record<string, unknown>)}>
              <Timeline.Item title="primary" color="primary">Scan started on the pinned frame.</Timeline.Item>
              <Timeline.Item title="success" color="success">Frame validated; no stale rows.</Timeline.Item>
              <Timeline.Item title="error" color="error">Margin check rejected the short leg.</Timeline.Item>
            </Timeline>
          </Specimen>
          <Specimen title="Item tones · continued" note="secondary resolves to muted; warning and info keep their semantic anchors.">
            <Timeline color="primary" bulletSize={18} lineWidth={2} {...({ "aria-label": "More timeline tones" } as Record<string, unknown>)}>
              <Timeline.Item title="danger" color="danger">danger maps to the negative token.</Timeline.Item>
              <Timeline.Item title="warning" color="warning">Exposure cap is close to its limit.</Timeline.Item>
              <Timeline.Item title="info" color="info">Feed reconnected after a brief gap.</Timeline.Item>
              <Timeline.Item title="secondary" color="secondary">Neutral marker for a note.</Timeline.Item>
            </Timeline>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const ActiveStep: Story = {
  render: () =>
    solidStory(() => {
      const [active, setActive] = createSignal(1);
      const steps = [
        { title: "Scan", detail: "214 symbols with a valid frame." },
        { title: "Filter", detail: "18 actionable rows after the gates." },
        { title: "Commit", detail: "Paper order staged for the next tick." },
      ];
      return (
        <Page>
          <Specimen
            title="Composed active step"
            note="`active` is not consumed by the renderer, so the marker, Badge and colour are composed from caller state."
          >
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                {steps.map((step, index) => (
                  <button
                    type="button"
                    aria-label={`Set active step to ${step.title}`}
                    aria-pressed={active() === index}
                    onClick={() => setActive(index)}
                    style={{
                      border: `1px solid ${active() === index ? "var(--color-fin-primary)" : "var(--color-fin-border)"}`,
                      background: "var(--color-fin-surface-alt)",
                      color: "var(--color-fin-text)",
                      padding: "4px 8px",
                      cursor: "pointer",
                    }}
                  >
                    {index + 1}. {step.title}
                  </button>
                ))}
              </Group>
              <Readout>{`${steps[active()].title} is the current step`}</Readout>
              <Timeline active={active()} bulletSize={22} lineWidth={2} {...({ "aria-label": "Composed active step" } as Record<string, unknown>)}>
                {steps.map((step, index) => (
                  <Timeline.Item
                    title={step.title}
                    color={index === active() ? "primary" : "secondary"}
                    bullet={String(index + 1)}
                  >
                    <Group gap="xs" wrap="wrap">
                      <Text size="xs" c="dimmed">{step.detail}</Text>
                      {index === active() ? <Badge size="xs" color="primary">current</Badge> : null}
                    </Group>
                  </Timeline.Item>
                ))}
              </Timeline>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const AlignmentAndLineVariants: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <SpecimenGrid>
          <Specimen title="Left align" code='align="left"' note="Rail on the left, labels left-aligned.">
            <Timeline align="left" bulletSize={20} lineWidth={2} {...({ "aria-label": "Left aligned timeline" } as Record<string, unknown>)}>
              <Timeline.Item title="Solid" color="success" lineVariant="solid">Default continuous connector.</Timeline.Item>
              <Timeline.Item title="Dashed" color="warning" lineVariant="dashed">Dashed connector below the bullet.</Timeline.Item>
              <Timeline.Item title="Dotted" color="info" lineVariant="dotted">Dotted connector below the bullet.</Timeline.Item>
            </Timeline>
          </Specimen>
          <Specimen title="Right align" code='align="right"' note="Rail on the right, labels right-aligned (flex-row-reverse).">
            <Timeline align="right" bulletSize={18} lineWidth={1} {...({ "aria-label": "Right aligned timeline" } as Record<string, unknown>)}>
              <Timeline.Item title="Queued" color="secondary">Waiting for the session open.</Timeline.Item>
              <Timeline.Item title="Live" color="success">Streaming paper prices.</Timeline.Item>
              <Timeline.Item title="Closed" color="error">Session ended.</Timeline.Item>
            </Timeline>
          </Specimen>
        </SpecimenGrid>
      </Page>
    )),
};

export const Composition: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Specimen title="Trade lifecycle" note="A paper trade read from signal to exit, with real status copy.">
          <Stack gap="sm">
            <Group gap="xs" justify="space-between">
              <Text size="sm" fw={600}>NIFTY 23,500 CE</Text>
              <Badge size="xs" color="success">paper</Badge>
            </Group>
            <Timeline color="primary" bulletSize={18} lineWidth={2} {...({ "aria-label": "Paper trade lifecycle" } as Record<string, unknown>)}>
              <Timeline.Item title="10:00 · Signal" color="info">SR breakout above the call wall.</Timeline.Item>
              <Timeline.Item title="10:01 · Fill" color="success">Filled at the signal bar close.</Timeline.Item>
              <Timeline.Item title="10:04 · Exit" color="warning">
                {"Stop loss hit; P&L logged to the paper book."}
              </Timeline.Item>
            </Timeline>
            <SampleRow label="Net" value="−0.40%" tone="var(--color-fin-negative)" />
          </Stack>
        </Specimen>
      </Page>
    )),
};
