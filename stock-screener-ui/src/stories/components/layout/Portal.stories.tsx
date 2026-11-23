import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, onMount, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Group, Portal, Stack, Text } from "@/ui";
import { asStoryComponent, C, Demo, MONO, Note, Page, Section } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Layout/Portal",
  tags: ["autodocs"],
  component: asStoryComponent(Portal),
  parameters: {
    docs: {
      description: {
        component:
          "Portal teleports its children out of the story DOM tree. With no target it mounts to document.body. target accepts an HTMLElement or a CSS selector string resolved against the document; when a selector matches nothing, the node falls back to document.body. The target is re-read when the caller changes it, so a ref-backed element is only valid after mount.",
      },
    },
  },
  argTypes: {
    target: { control: "text", description: "HTMLElement or CSS selector string; omitted → document.body" },
  },
};
export default meta;
type Story = StoryObj;

const landed = (text: string, tone: string) => (
  <Box p="sm" style={{ border: `1px solid ${tone}`, background: C.alt, "max-width": "420px" }}>
    <Text size="sm" fw={600} fs={MONO}>{text}</Text>
    <Text size="xs" c={C.muted} fs={MONO}>Rendered outside the declared tree.</Text>
  </Box>
);

export const Playground: Story = {
  args: {},
  render: () =>
    solidStory(() => (
      <Stack gap="sm">
        <Note>No target → portal appends to document.body. Inspect the DOM to confirm the node is not a descendant of this box.</Note>
        <Box p="sm" style={{ border: `1px dashed ${C.border}`, background: C.surface }}>
          <Text size="sm" fw={600}>Declared inside this box</Text>
          <Portal>{landed("Teleported → document.body", C.primary)}</Portal>
        </Box>
      </Stack>
    )),
};

export const SelectorAndElementTargets: Story = {
  render: () =>
    solidStory(() => {
      const [mounted, setMounted] = createSignal(false);
      let elementHost: HTMLDivElement | undefined;
      onMount(() => requestAnimationFrame(() => setMounted(true)));
      return (
        <Page>
          <Section title="Explicit targets" caption="Selector strings are resolved with document.querySelector; an HTMLElement ref is only available after mount, so the portals are created on the next frame.">
            <Stack gap="sm">
              <Note>Both portals are declared in the source panel; their children land in the two hosts on the right.</Note>
              <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "16px" }}>
                <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                  <Text size="sm" fw={600}>Source tree</Text>
                  <Show when={mounted()}>
                    <Portal target="#layout-portal-selector-host">{landed("Arrived via selector", C.primary)}</Portal>
                    <Portal target={elementHost}>{landed("Arrived via HTMLElement", C.info)}</Portal>
                  </Show>
                </Box>
                <Stack gap="sm">
                  <div id="layout-portal-selector-host" style={{ "min-height": "72px", padding: "8px", border: `1px dashed ${C.border}`, background: C.surface }}>
                    <Text size="xs" c={C.muted} fs={MONO}>Host · target="#layout-portal-selector-host"</Text>
                  </div>
                  <div ref={(el) => (elementHost = el)} style={{ "min-height": "72px", padding: "8px", border: `1px dashed ${C.border}`, background: C.surface }}>
                    <Text size="xs" c={C.muted} fs={MONO}>Host · target={'{elementHost}'}</Text>
                  </div>
                </Stack>
              </div>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const ToggleTarget: Story = {
  render: () =>
    solidStory(() => {
      const [mounted, setMounted] = createSignal(false);
      const [active, setActive] = createSignal(true);
      let host: HTMLDivElement | undefined;
      onMount(() => requestAnimationFrame(() => setMounted(true)));
      return (
        <Page>
          <Section title="Mount & unmount" caption="Removing a Portal removes only the teleported node; the visible host is untouched.">
            <Stack gap="sm">
              <Group gap="xs">
                <Button size="xs" variant="outline" onClick={() => setActive((v) => !v)}>
                  {active() ? "Unmount portal content" : "Mount portal content"}
                </Button>
              </Group>
              <div ref={(el) => (host = el)} style={{ "min-height": "96px", padding: "12px", border: `1px dashed ${C.border}`, background: C.surface }}>
                <Text size="xs" c={C.muted} fs={MONO}>Visible host container</Text>
                <Show when={mounted() && active()}>
                  <Portal target={host}>{landed("Mounted on demand", C.primary)}</Portal>
                </Show>
              </div>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const ResponsiveTarget: Story = {
  render: () =>
    solidStory(() => {
      const [wide, setWide] = createSignal(false);
      let left: HTMLDivElement | undefined;
      let right: HTMLDivElement | undefined;
      return (
        <Page>
          <Section title="Changing the target" caption="Portal re-reads its target on re-render, so switching the ref moves the child between hosts without recreating it.">
            <Stack gap="sm">
              <Group gap="xs">
                <Button size="xs" variant={wide() ? "filled" : "outline"} onClick={() => setWide(false)}>Target A</Button>
                <Button size="xs" variant={wide() ? "outline" : "filled"} onClick={() => setWide(true)}>Target B</Button>
              </Group>
              <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "12px" }}>
                <div ref={(el) => (left = el)} style={{ "min-height": "80px", padding: "8px", border: `1px dashed ${C.border}` }}>
                  <Text size="xs" fs={MONO}>Host A</Text>
                </div>
                <div ref={(el) => (right = el)} style={{ "min-height": "80px", padding: "8px", border: `1px dashed ${C.border}` }}>
                  <Text size="xs" fs={MONO}>Host B</Text>
                </div>
              </div>
              <Portal target={wide() ? right : left}>{landed(wide() ? "Now in host B" : "Now in host A", C.info)}</Portal>
            </Stack>
          </Section>
        </Page>
      );
    }),
};

export const EdgeStates: Story = {
  render: () =>
    solidStory(() => (
      <Page>
        <Section title="Edge states" caption="An unknown selector falls back to document.body; a nested Portal teleports again; empty children render nothing.">
          <Stack gap="sm">
            <Demo label="target='#does-not-exist' → falls back to document.body.">
              <Box p="sm" style={{ border: `1px solid ${C.border}`, background: C.surface }}>
                <Text size="sm" fs={MONO}>Source box</Text>
                <Portal target="#layout-portal-missing">{landed("Fallback → document.body", C.warning)}</Portal>
              </Box>
            </Demo>
            <Demo label="Nested portal: inner child still lands in document.body, not in the outer host.">
              <div id="layout-portal-nested-host" style={{ "min-height": "72px", padding: "8px", border: `1px dashed ${C.border}` }}>
                <Text size="xs" fs={MONO}>Outer host</Text>
                <Portal target="#layout-portal-nested-host">
                  <Box p="xs" style={{ border: `1px solid ${C.info}`, background: C.surface }}>
                    <Text size="xs" fs={MONO}>Outer content in host</Text>
                    <Portal>{landed("Inner content in body", C.primary)}</Portal>
                  </Box>
                </Portal>
              </div>
            </Demo>
            <Demo label="No children: the portal mounts an empty node and nothing is visible.">
              <Portal />
              <Note>No teleported content — the source tree is unaffected.</Note>
            </Demo>
          </Stack>
        </Section>
      </Page>
    )),
};
