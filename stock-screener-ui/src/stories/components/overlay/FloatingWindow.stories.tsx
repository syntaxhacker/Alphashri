import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal, For, Show } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import { Button, FloatingWindow, Group, Stack, Text } from "@/ui";
import type { FloatingWindowGeometry } from "@/ui";
import { Page, Readout, SampleRow, Specimen, SpecimenGrid, Stage } from "./fixtures";

const meta: Meta = {
  title: "Design System/Components/Overlay/FloatingWindow",
  tags: ["autodocs"],
  // html-vite types `component` as a render function over a flat Args bag;
  // Solid components require concrete props, so the real component is cast here.
  component: FloatingWindow as unknown as Meta["component"],
  parameters: {
    docs: {
      description: {
        component:
          "FloatingWindow is a draggable, resizable panel positioned inside a relative container from a `geometry` signal `{ x, y, width, height }`. Drag the title bar to move it, drag any of the eight edges/corners to resize (clamped by `minWidth` / `minHeight`), and `onGeometryChange` reports the committed geometry after each gesture. Double-clicking the title bar or pressing the minimize control calls `onMinimize`; `minimized` hides the window. `onFocus` fires on pointer down. All manipulation is pointer-based — there is no keyboard move/resize in this primitive.",
      },
    },
  },
  argTypes: {
    title: { control: "text", description: "Title-bar text and the dialog aria-label." },
    geometry: { control: "object", description: "Controlled { x, y, width, height } in px." },
    "z-index": { control: { type: "number", step: 1 }, description: "Stacking order within the container." },
    minimized: { control: "boolean", description: "Hide the window while keeping its geometry." },
    minWidth: { control: { type: "number", min: 120, step: 10 }, description: "Resize clamp, default 260." },
    minHeight: { control: { type: "number", min: 80, step: 10 }, description: "Resize clamp, default 140." },
    onGeometryChange: { action: "onGeometryChange", description: "Fires with the final geometry after a drag/resize." },
    onFocus: { action: "onFocus", description: "Fires on pointer down on the window." },
    onMinimize: { action: "onMinimize", description: "Fires on the minimize control or title-bar double-click." },
    onClose: { action: "onClose", description: "Fires on the × control." },
  },
};
export default meta;
type Story = StoryObj;

function WindowBody(props: { title: string; caption: string }) {
  return (
    <Stack gap="xs" p="sm">
      <Text size="sm" fw={600}>{props.title}</Text>
      <Text size="xs" c="dimmed">{props.caption}</Text>
      <SampleRow label="Underlying" value="NIFTY" />
      <SampleRow label="Legs" value="2 · debit spread" />
    </Stack>
  );
}

export const GeometryAndResize: Story = {
  render: () =>
    solidStory(() => {
      const [geometry, setGeometry] = createSignal<FloatingWindowGeometry>({ x: 12, y: 12, width: 320, height: 188 });
      const g = () => geometry();
      return (
        <Page>
          <Specimen
            title="Geometry and resize"
            note="Drag the title bar to move; drag any edge or corner to resize. The readout updates from onGeometryChange."
          >
            <Stack gap="sm">
              <Group gap="sm" align="center" wrap="wrap">
                <Readout>x {g().x} · y {g().y} · {g().width}×{g().height}</Readout>
                <Button size="xs" variant="outline" onClick={() => setGeometry({ x: 12, y: 12, width: 320, height: 188 })}>
                  Reset geometry
                </Button>
              </Group>
              <Stage height={216}>
                <FloatingWindow
                  title="OPTIONS REPLAY"
                  geometry={geometry()}
                  z-index={3}
                  minWidth={220}
                  minHeight={120}
                  onGeometryChange={setGeometry}
                  testid="story-fw-geometry"
                >
                  <WindowBody title="Replay path · NIFTY" caption="Every resize handle is live." />
                </FloatingWindow>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const Collapse: Story = {
  render: () =>
    solidStory(() => {
      const [minimized, setMinimized] = createSignal(false);
      const [visible, setVisible] = createSignal(true);
      return (
        <Page>
          <Specimen
            title="Collapse and close"
            note="The minimize control and a title-bar double-click both call onMinimize. Minimizing hides the window but keeps its geometry."
          >
            <Stack gap="sm">
              <Group gap="xs" wrap="wrap">
                <Button size="xs" variant="outline" disabled={!visible()} onClick={() => setMinimized((v) => !v)}>
                  {minimized() ? "Restore" : "Minimize"}
                </Button>
                <Button size="xs" variant="outline" onClick={() => setVisible((v) => !v)}>
                  {visible() ? "Close" : "Reopen"}
                </Button>
                <Readout>minimized: {String(minimized())} · mounted: {String(visible())}</Readout>
              </Group>
              <Stage height={216}>
                <Show when={visible()}>
                  <FloatingWindow
                    title="COLLAPSIBLE PANEL"
                    geometry={{ x: 12, y: 12, width: 300, height: 176 }}
                    z-index={2}
                    minimized={minimized()}
                    onMinimize={() => setMinimized((v) => !v)}
                    onClose={() => setVisible(false)}
                    testid="story-fw-collapse"
                  >
                    <WindowBody title="Session notes" caption="Double-click the title bar to collapse." />
                  </FloatingWindow>
                </Show>
              </Stage>
            </Stack>
          </Specimen>
        </Page>
      );
    }),
};

export const LayeringAndFocus: Story = {
  render: () =>
    solidStory(() => {
      const [focused, setFocused] = createSignal("none");
      const windows = [
        { id: "front", title: "FRONT · z 5", z: 5, geometry: { x: 12, y: 12, width: 280, height: 164 } },
        { id: "back", title: "BACK · z 2", z: 2, geometry: { x: 76, y: 56, width: 280, height: 164 } },
      ];
      return (
        <Page>
          <SpecimenGrid>
            <Specimen title="Layering" note="Pointer down on either window calls onFocus; the higher z-index wins the stack.">
              <Stack gap="sm">
                <Readout>last focused: {focused()}</Readout>
                <Stage height={232}>
                  <For each={windows}>
                    {(w) => (
                      <FloatingWindow
                        title={w.title}
                        geometry={w.geometry}
                        z-index={w.z}
                        minWidth={220}
                        minHeight={120}
                        onFocus={() => setFocused(w.id)}
                        testid={`story-fw-${w.id}`}
                      >
                        <Stack gap="xs" p="sm">
                          <Text size="sm" fw={600}>{w.title}</Text>
                          <SampleRow label="State" value="paper" />
                        </Stack>
                      </FloatingWindow>
                    )}
                  </For>
                </Stage>
              </Stack>
            </Specimen>
            <Specimen title="Focus readout" note="Both windows expose the same body primitives; only z-index and geometry differ.">
              <Stack gap="xs">
                {windows.map((w) => (
                  <SampleRow label={w.title} value={`z ${w.z}`} tone={focused() === w.id ? "var(--color-fin-primary)" : undefined} />
                ))}
              </Stack>
            </Specimen>
          </SpecimenGrid>
        </Page>
      );
    }),
};
