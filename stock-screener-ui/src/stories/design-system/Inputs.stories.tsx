import type { Meta, StoryObj } from "@storybook/html-vite";
import { createSignal } from "solid-js";
import { solidStory } from "@/stories/solidStory";
import {
  ActionIcon, Button, Checkbox, Chip, CopyButton, DatePicker, Group, MultiSelect,
  NumberInput, PasswordInput, RangeSlider, SegmentedControl, Select, Slider, Stack,
  Switch, Text, Textarea, TextInput, UnstyledButton,
} from "@/ui";

const meta: Meta = { title: "Design System/Inputs", tags: ["autodocs"] };
export default meta;
type Story = StoryObj;

export const Buttons: Story = {
  render: () =>
    solidStory(() => (
      <Stack gap="md">
        <Group gap="sm" align="center">
          <Button>Filled</Button>
          <Button variant="light">Light</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="transparent">Transparent</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
        </Group>
        <Group gap="sm" align="center">
          <Button size="xs">xs</Button>
          <Button size="sm">sm</Button>
          <Button size="md">md</Button>
          <Button size="lg">lg</Button>
          <Button color="success">Positive</Button>
          <Button color="error">Negative</Button>
          <Button color="warning">Warning</Button>
        </Group>
        <Group gap="sm" align="center">
          <ActionIcon aria-label="Refresh">↻</ActionIcon>
          <ActionIcon variant="outline" color="success" aria-label="Add">+</ActionIcon>
          <UnstyledButton style={{ color: "var(--color-fin-primary)", "font-size": "12px" }}>Unstyled action</UnstyledButton>
        </Group>
      </Stack>
    )),
};

export const TextFields: Story = {
  render: () =>
    solidStory(() => {
      const [expiry, setExpiry] = createSignal<Date | null>(new Date(2026, 10, 26));
      return (
        <div style={{ display: "grid", gap: "14px", "max-width": "420px" }}>
          <TextInput label="Symbol" placeholder="NIFTY" defaultValue="NIFTY" />
          <TextInput label="Search" placeholder="Search instruments" leftSection={<span>⌕</span>} />
          <TextInput label="Disabled" defaultValue="Locked" disabled />
          <NumberInput label="Quantity" defaultValue={75} min={1} max={5000} />
          <Textarea label="Notes" placeholder="Trade thesis…" minRows={3} />
          <PasswordInput label="Password" placeholder="••••••••" />
          <DatePicker id="expiry-date" placeholder="Expiry" value={expiry()} onChange={setExpiry} />
        </div>
      );
    }),
};

export const Selects: Story = {
  render: () =>
    solidStory(() => {
      const [view, setView] = createSignal("table");
      return (
        <div style={{ display: "grid", gap: "14px", "max-width": "420px" }}>
          <Select
            label="Universe"
            defaultValue="nifty500"
            data={[
              { value: "nifty50", label: "NIFTY 50" },
              { value: "nifty500", label: "NIFTY 500" },
              { value: "all", label: "All instruments" },
            ]}
          />
          <MultiSelect
            label="Sectors"
            defaultValue={["it", "banks"]}
            data={[
              { value: "it", label: "Information Technology" },
              { value: "banks", label: "Banks" },
              { value: "auto", label: "Automobile" },
              { value: "pharma", label: "Pharma" },
            ]}
          />
          <div role="group" aria-label="View" style={{ display: "grid", gap: "6px" }}>
            <Text size="xs" c="dimmed">View · {view()}</Text>
            <SegmentedControl
              value={view()}
              onChange={setView}
              data={[
                { value: "table", label: "TABLE" },
                { value: "grid", label: "GRID" },
                { value: "matrix", label: "MATRIX" },
              ]}
            />
          </div>
        </div>
      );
    }),
};

export const Toggles: Story = {
  render: () =>
    solidStory(() => {
      const [risk, setRisk] = createSignal(2);
      const [band, setBand] = createSignal<[number, number]>([20, 70]);
      return (
        <Stack gap="md">
          <Group gap="lg" align="center">
            <Switch label="Live quotes" defaultChecked />
            <Switch label="Reduced motion" />
            <Checkbox label="Show expired" defaultChecked />
            <Checkbox label="Include tests" />
          </Group>
          <Group gap="sm" align="center">
            <Chip label="Large cap" defaultChecked />
            <Chip label="Mid cap" />
            <Chip label="Small cap" color="warning" />
            <Chip label="Disabled" disabled />
          </Group>
          <div style={{ width: "320px" }}>
            <Slider label="Risk %" value={risk()} onChange={setRisk} min={0.1} max={10} step={0.1} />
          </div>
          <div style={{ width: "320px" }}>
            <RangeSlider label="Range" value={band()} onChange={setBand} min={0} max={100} step={1} />
          </div>
        </Stack>
      );
    }),
};

export const CopyAction: Story = {
  render: () =>
    solidStory(() => (
      <CopyButton value="NSE_EQ|INE002A01018">
        {({ copied, copy }) => (
          <Button variant={copied ? "light" : "outline"} color={copied ? "success" : "primary"} onClick={copy}>
            {copied ? "Copied" : "Copy instrument key"}
          </Button>
        )}
      </CopyButton>
    )),
};
