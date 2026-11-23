import type { Meta, StoryObj } from "@storybook/html-vite";
import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { alpha, Box, Button, Group, Modal, Stack, Text } from "@/ui";
import * as palette from "@/ui/palette";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Overlay/Modal",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: Modal as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "Modal mounts a fixed, focusable dialog only while `opened` is true. With an `onClose` handler a titled dialog shows a × and closes on Escape or a backdrop click; `closeOnEscape={false}` / `closeOnClickOutside={false}` opt out for destructive flows. Focus moves to the dialog on open and returns to the previously active element on close. There is no focus trap, so Tab can leave the dialog. `centered` is accepted for Mantine compatibility but is forwarded to the root element — the panel is always centred by its flex container.",
      },
    },
  },
  argTypes: {
    opened: { control: "boolean", description: "Mount the dialog only while true (controlled)." },
    onClose: { action: "onClose", description: "Called by the × button, Escape and backdrop click." },
    title: { control: "text", description: "Title-bar text; also used as the dialog aria-label." },
    size: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Preset max-width. A number becomes px; any other string is used verbatim.",
    },
    fullScreen: { control: "boolean", description: "Stretch the panel to the whole viewport." },
    centered: {
      control: "boolean",
      description: "Legacy prop. The dialog is centred by flex regardless of its value.",
    },
    withCloseButton: { control: "boolean", description: "Force a × even without a title." },
    closeOnEscape: { control: "boolean", description: "Escape calls onClose (default true)." },
    closeOnClickOutside: { control: "boolean", description: "Backdrop click calls onClose (default true)." },
    padding: {
      control: "select",
      options: ["xs", "sm", "md", "lg", "xl"],
      description: "Body padding. Numbers are multiplied by 8px.",
    },
    overlayProps: {
      control: "object",
      description: "Backdrop color, opacity and blur (see the Overlay primitive).",
    },
  },
};
export default meta;
type Story = StoryObj;

function DialogContent() {
  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>BUY 1 lot NIFTY 23,500 CE</Text>
      <SampleRow label="Order type" value="market · paper" />
      <SampleRow label="Risk" value="1.0% of capital" tone="var(--color-fin-primary)" />
      <Text size="xs" c="dimmed">
        Try Escape, a backdrop click and the × button. Focus returns to the opener on close.
      </Text>
    </Stack>
  );
}

/** Static open-state specimen: the real dialog is fixed to the viewport. */
function DialogShell(props: { title: string; children: JSX.Element; footer?: JSX.Element }) {
  return (
    <Box
      style={{
        border: "1px solid var(--color-fin-border)",
        "border-radius": "6px",
        background: "var(--color-fin-surface)",
        width: "100%",
        "max-width": "440px",
        "box-sizing": "border-box",
        overflow: "hidden",
      }}
    >
      <Group
        gap="sm"
        align="center"
        justify="space-between"
        style={{ padding: "8px 12px", "border-bottom": "1px solid var(--color-fin-border)", background: "var(--color-fin-surface-alt)" }}
      >
        <Text size="sm" fw={600}>{props.title}</Text>
        <Text size="xs" c="dimmed" className="font-mono" aria-label="close">×</Text>
      </Group>
      <Stack gap="sm" style={{ padding: "12px" }}>{props.children}</Stack>
      {props.footer ? (
        <Group
          gap="sm"
          align="center"
          justify="flex-end"
          style={{ padding: "8px 12px", "border-top": "1px solid var(--color-fin-border)" }}
        >
          {props.footer}
        </Group>
      ) : null}
    </Box>
  );
}

export const OpenDialog: Story = {
  render: () =>
    solidStory(() => (
      <Modal
        opened
        onClose={() => undefined}
        title="Confirm paper order"
        size="sm"
        padding="md"
        overlayProps={{ color: alpha(palette.BG, 0.78) }}
      >
        <Stack gap="sm">
          <DialogContent />
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="outline">Cancel</Button>
            <Button size="xs">Confirm order</Button>
          </Group>
        </Stack>
      </Modal>
    )),
};

export const Sizes: Story = {
  render: () =>
    solidStory(() => {
      const sizes = ["xs", "sm", "md", "lg", "xl"] as const;
      const [active, setActive] = createSignal<(typeof sizes)[number] | null>(null);
      return (
        <Page>
          <Specimen title="Sizes" note="size maps to the panel max-width; the dialog itself is centred by flex.">
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                {sizes.map((s) => (
                  <Button size="xs" variant="outline" onClick={() => setActive(s)}>{s}</Button>
                ))}
              </Group>
              <Readout>opened size: {active() ?? "none"}</Readout>
              <DialogShell title={`Size · ${active() ?? "md"}`}>
                <DialogContent />
              </DialogShell>
            </Stack>
          </Specimen>
          <Modal
            opened={active() !== null}
            onClose={() => setActive(null)}
            title={`Size · ${active() ?? ""}`}
            size={active() ?? "md"}
            padding="md"
            overlayProps={{ color: alpha(palette.BG, 0.78) }}
          >
            <DialogContent />
          </Modal>
        </Page>
      );
    }),
};

export const CenteredAndFullScreen: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [fullScreen, setFullScreen] = createSignal(false);
      return (
        <Page>
          <Specimen
            title="Centred / fullscreen"
            code="centered · fullScreen={false}"
            note="centered is passed through, but this primitive centres every dialog with flex. fullScreen pins the panel to the viewport edges."
          >
            <Stack gap="sm">
              <Group gap="sm" wrap="wrap">
                <Button size="xs" onClick={() => setOpened(true)}>Open dialog</Button>
                <Button size="xs" variant="outline" onClick={() => setFullScreen((v) => !v)}>
                  fullScreen: {String(fullScreen())}
                </Button>
              </Group>
              <DialogShell title="Centred / fullscreen">
                <DialogContent />
                <Text size="xs" c="dimmed">resolved fullScreen: {String(fullScreen())}</Text>
              </DialogShell>
            </Stack>
          </Specimen>
          <Modal
            opened={opened()}
            onClose={() => setOpened(false)}
            title="Fullscreen dialog"
            fullScreen={fullScreen()}
            padding="md"
            overlayProps={{ color: alpha(palette.BG, 0.78) }}
          >
            <DialogContent />
          </Modal>
        </Page>
      );
    }),
};

export const CloseBehavior: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [guarded, setGuarded] = createSignal(false);
      return (
        <Page>
          <Specimen
            title="Dismissal defaults"
            note="A guard disables Escape and backdrop dismissal; only × or an explicit button closes the dialog."
          >
            <Stack gap="sm">
              <Group gap="sm" wrap="wrap">
                <Button size="xs" onClick={() => setOpened(true)}>Open dialog</Button>
                <Button size="xs" variant="outline" onClick={() => setGuarded((v) => !v)}>
                  Discard guard: {guarded() ? "on" : "off"}
                </Button>
              </Group>
              <DialogShell title={guarded() ? "Discard changes?" : "Dismissal defaults"}>
                <Text size="sm">
                  {guarded()
                    ? "Escape and backdrop are disabled for this irreversible action."
                    : "Escape and a backdrop click both call onClose."}
                </Text>
              </DialogShell>
            </Stack>
          </Specimen>
          <Modal
            opened={opened()}
            onClose={() => setOpened(false)}
            title={guarded() ? "Discard changes?" : "Dismissal defaults"}
            closeOnEscape={!guarded()}
            closeOnClickOutside={!guarded()}
            padding="md"
            overlayProps={{ color: alpha(palette.BG, 0.78) }}
          >
            <Stack gap="sm">
              <Text size="sm">
                {guarded()
                  ? "Escape and backdrop are disabled for this irreversible action."
                  : "Escape and a backdrop click both call onClose."}
              </Text>
              <Button size="xs" onClick={() => setOpened(false)}>Close via button</Button>
            </Stack>
          </Modal>
        </Page>
      );
    }),
};

export const EscapeOwnedByPopup: Story = {
  render: () =>
    solidStory(() => {
      const [opened, setOpened] = createSignal(false);
      const [popupOpen, setPopupOpen] = createSignal(true);
      return (
        <Page>
          <SpecimenGrid>
            <Specimen
              title="Open combobox in a dialog"
              note="The dialog ignores Escape while a combobox with aria-expanded=true is present: the popup owns the key first."
            >
              <Stack gap="sm">
                <Button size="xs" onClick={() => setOpened(true)}>Open dialog with a nested popup</Button>
                <DialogShell title="Nested popup">
                  <Text size="sm">combobox: {popupOpen() ? "expanded" : "collapsed"}</Text>
                  <Text size="xs" c="dimmed">Escape is captured before the dialog sees it while the popup is expanded.</Text>
                </DialogShell>
              </Stack>
            </Specimen>
            <Specimen title="Popup target" note="Toggle the fake combobox inside the open dialog.">
              <Box
                role="combobox"
                aria-label="Fake combobox"
                aria-expanded={popupOpen()}
                style={{ border: "1px solid var(--color-fin-border)", padding: "6px 8px", background: "var(--color-fin-surface-alt)" }}
              >
                <Text size="sm">Nested popup target · {popupOpen() ? "expanded" : "collapsed"}</Text>
              </Box>
            </Specimen>
          </SpecimenGrid>
          <Modal
            opened={opened()}
            onClose={() => setOpened(false)}
            title="Nested popup"
            padding="md"
            overlayProps={{ color: alpha(palette.BG, 0.78) }}
          >
            <Stack gap="sm">
              <Button size="xs" variant="outline" onClick={() => setPopupOpen((v) => !v)}>
                combobox: {popupOpen() ? "expanded" : "collapsed"}
              </Button>
              <Box
                role="combobox"
                aria-label="Fake combobox"
                aria-expanded={popupOpen()}
                style={{ border: "1px solid var(--color-fin-border)", padding: "6px 8px", background: "var(--color-fin-surface-alt)" }}
              >
                Nested popup target
              </Box>
              <Text size="xs" c="dimmed">Collapse the combobox, then press Escape to close the dialog.</Text>
            </Stack>
          </Modal>
        </Page>
      );
    }),
};
