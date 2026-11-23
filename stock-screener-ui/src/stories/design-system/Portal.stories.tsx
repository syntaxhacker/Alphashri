import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, onMount, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Box, Button, Group, Portal, Stack, Text } from "@/ui";

const meta: Meta = { title: "Design System/Portal", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const DefaultTarget: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="sm">
        <Box p="sm" style={{ border: "1px solid var(--color-fin-border)", "background": "var(--color-fin-surface)" }}>
          <Text size="sm" fw={600}>Declared inside this box</Text>
          <Text size="xs" c="dimmed">
            With no <code>target</code>, Portal appends its children to <code>document.body</code>.
            The node below is not a descendant of this box — inspect the DOM to confirm.
          </Text>
        </Box>
        <Portal>
          <Box
            p="sm"
            style={{
              border: "1px solid var(--color-fin-primary)",
              background: "var(--color-fin-surface-alt)",
            }}
          >
            <Text size="sm" fw={600}>Teleported → document.body</Text>
            <Text size="xs" c="dimmed">Rendered at the end of the body, outside the Storybook story tree.</Text>
          </Box>
        </Portal>
      </Stack>
    )),
};

export const ExplicitTargets: Story = {
  render: () =>
    solidStory(() => {
      const [mounted, setMounted] = createSignal(false);
      // The selector target is resolved against the live document, so the portal
      // must be created only after Storybook has attached the story tree.
      onMount(() => requestAnimationFrame(() => setMounted(true)));
      let elementHost: HTMLDivElement | undefined;

      const landed = (text: string) => (
        <div style={{ padding: "8px", border: "1px solid var(--color-fin-primary)", background: "var(--color-fin-surface-alt)" }}>
          <Text size="xs">{text}</Text>
        </div>
      );

      return (
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Two hosts are shown below. The portals are declared in the source box on the left;
            their children land in the visible hosts on the right.
          </Text>
          <div style={{ display: "grid", "grid-template-columns": "1fr 1fr", gap: "16px" }}>
            <Box p="sm" style={{ border: "1px solid var(--color-fin-border)", background: "var(--color-fin-surface)" }}>
              <Text size="sm" fw={600}>Source tree</Text>
              <Text size="xs" c="dimmed">Portal components are declared here.</Text>
              <Show when={mounted()}>
                <Portal target="#story-portal-selector-host">{landed("Arrived via CSS selector target")}</Portal>
                <Portal target={elementHost}>{landed("Arrived via HTMLElement target")}</Portal>
              </Show>
            </Box>
            <Stack gap="sm">
              <div
                id="story-portal-selector-host"
                style={{ "min-height": "56px", padding: "8px", border: "1px dashed var(--color-fin-border)", background: "var(--color-fin-surface)" }}
              >
                <Text size="xs" c="dimmed" fw={600}>Host · target="#story-portal-selector-host"</Text>
              </div>
              <div
                ref={(el) => (elementHost = el)}
                style={{ "min-height": "56px", padding: "8px", border: "1px dashed var(--color-fin-border)", background: "var(--color-fin-surface)" }}
              >
                <Text size="xs" c="dimmed" fw={600}>Host · target=&#123;elementHost&#125;</Text>
              </div>
            </Stack>
          </div>
        </Stack>
      );
    }),
};

export const ToggleTarget: Story = {
  render: () =>
    solidStory(() => {
      const [mounted, setMounted] = createSignal(false);
      const [active, setActive] = createSignal(true);
      onMount(() => requestAnimationFrame(() => setMounted(true)));
      let host: HTMLDivElement | undefined;

      return (
        <Stack gap="sm">
          <Group gap="sm">
            <Button size="xs" onClick={() => setActive((v) => !v)}>
              {active() ? "Unmount portal content" : "Mount portal content"}
            </Button>
          </Group>
          <div
            ref={(el) => (host = el)}
            style={{ "min-height": "96px", padding: "12px", border: "1px dashed var(--color-fin-border)", background: "var(--color-fin-surface)" }}
          >
            <Text size="xs" c="dimmed" fw={600}>Visible host container</Text>
            <Show when={mounted() && active()}>
              <Portal target={host}>
                <div style={{ "margin-top": "8px", padding: "8px", border: "1px solid var(--color-fin-primary)", background: "var(--color-fin-surface-alt)" }}>
                  <Text size="sm">Mounted on demand · unmount removes only the teleported node.</Text>
                </div>
              </Portal>
            </Show>
          </div>
        </Stack>
      );
    }),
};
