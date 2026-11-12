// @vitest-environment happy-dom
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import {
  Text, Button, Badge, Select, ActionIcon, Tooltip, Loader, NumberInput, Chip,
  ScrollArea, Checkbox, Alert, SegmentedControl, ToolbarRow, TextInput, Tabs,
  MultiSelect, Divider, Center, Textarea, Switch, Progress, Modal, LoadingOverlay,
  Anchor, Title, SimpleGrid, Popover, PopoverTarget, PopoverDropdown, Menu, DatePicker, Collapse,
} from "@/ui";
import { createSignal } from "solid-js";

afterEach(() => cleanup());

const cases: [string, () => any][] = [
  ["Text", () => <Text>x</Text>],
  ["Button", () => <Button>x</Button>],
  ["Badge", () => <Badge>x</Badge>],
  ["Select", () => <Select value="a" data={[{ value: "a", label: "a" }]} onChange={() => {}} />],
  ["ActionIcon", () => <ActionIcon aria-label="a">x</ActionIcon>],
  ["Tooltip", () => <Tooltip label="t"><span>x</span></Tooltip>],
  ["Loader", () => <Loader />],
  ["NumberInput", () => <NumberInput value={1} onChange={() => {}} />],
  ["Chip", () => <Chip>x</Chip>],
  ["ScrollArea", () => <ScrollArea>x</ScrollArea>],
  ["Checkbox", () => <Checkbox label="x" />],
  ["Alert", () => <Alert title="t">x</Alert>],
  ["SegmentedControl", () => <SegmentedControl data={[{ label: "a", value: "a" }]} value="a" onChange={() => {}} />],
  ["ToolbarRow", () => <ToolbarRow>x</ToolbarRow>],
  ["TextInput", () => <TextInput value="" onChange={() => {}} />],
  ["Tabs", () => <Tabs value="a"><Tabs.List><Tabs.Tab value="a">t</Tabs.Tab></Tabs.List></Tabs>],
  ["MultiSelect", () => <MultiSelect value={[]} data={[{ value: "a", label: "a" }]} onChange={() => {}} />],
  ["Divider", () => <Divider />],
  ["Center", () => <Center>x</Center>],
  ["Textarea", () => <Textarea value="" onChange={() => {}} />],
  ["Switch", () => <Switch checked={false} onChange={() => {}} label="x" />],
  ["Progress", () => <Progress value={10} />],
  ["Modal", () => <Modal title="t" opened={true} onClose={() => {}}>x</Modal>],
  ["LoadingOverlay", () => <LoadingOverlay visible />],
  ["Anchor", () => <Anchor href="#">x</Anchor>],
  ["Title", () => <Title order={3}>x</Title>],
  ["SimpleGrid", () => <SimpleGrid cols={2}>x</SimpleGrid>],
  ["Popover", () => <Popover><PopoverTarget><span>x</span></PopoverTarget><PopoverDropdown>y</PopoverDropdown></Popover>],
  ["Menu", () => <Menu><Menu.Target><span>x</span></Menu.Target><Menu.Dropdown>y</Menu.Dropdown></Menu>],
  ["DatePicker", () => <DatePicker value={null} onChange={() => {}} />],
  ["Collapse", () => <Collapse in={true}>x</Collapse>],
];

for (const [name, renderFn] of cases) {
  test(`mounts ${name}`, () => {
    render(() => renderFn());
  });
}
