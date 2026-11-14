import { createSignal } from "solid-js";
import { For } from "solid-js";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  CopyButton,
  Divider,
  MultiSelect,
  NumberInput,
  Paper,
  PasswordInput,
  RangeSlider,
  SegmentedControl,
  Select,
  Switch,
  Text,
  Textarea,
  TextInput,
  ToolbarRow,
} from "@/ui";
import { IconSettings, IconX } from "@/components/common/Icons";

/**
 * Design-system audit surface. Every control in the kit, side by side, so a
 * reviewer can see whether the primitives are actually distinguishable from
 * each other. Route: /poc/kit
 */
export function KitPoc() {
  const [tab, setTab] = createSignal("one");
  const [seg, setSeg] = createSignal("a");
  const [checked, setChecked] = createSignal(true);
  const [switched, setSwitched] = createSignal(true);
  const [sel, setSel] = createSignal<string | null>("daily");
  const [multi, setMulti] = createSignal<string[]>(["NIFTY 50"]);
  const [num, setNum] = createSignal<number | string>(40);
  const [text, setText] = createSignal("");
  const [range, setRange] = createSignal<[number, number]>([20, 80]);

  const label = (t: string) => (
    <Text size="xs" c="dimmed" className="block mb-1 uppercase tracking-[0.06em]">
      {t}
    </Text>
  );

  return (
    <Box class="p-4 flex flex-col gap-6 overflow-auto h-full" data-testid="kit-poc">
      <Text fw={700} size="lg">
        UI kit — control audit
      </Text>

      {/* Buttons */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          Button — should read: primary / secondary / ghost / danger, 4 distinct weights
        </Text>
        <ToolbarRow gap={8}>
          <Button variant="filled">Filled</Button>
          <Button variant="light">Light</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="subtle">Subtle</Button>
          <Button variant="default">Default</Button>
          <Button color="error" variant="filled">Danger</Button>
          <Button disabled>Disabled</Button>
          <Button leftSection={<IconSettings size={14} />}>With icon</Button>
          <ActionIcon aria-label="settings"><IconSettings size={14} /></ActionIcon>
          <ActionIcon variant="outline" aria-label="close"><IconX size={14} /></ActionIcon>
        </ToolbarRow>
      </Paper>

      {/* Tabs + segmented + chips */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          Tabs vs SegmentedControl vs Chips — three "pick one" idioms, must not look identical
        </Text>
        <Box class="flex flex-col gap-3">
          <TabsRow tab={tab()} setTab={setTab} />
          <ToolbarRow gap={8}>
            <SegmentedControl
              value={seg()}
              onChange={setSeg}
              data={[
                { value: "a", label: "Matrix" },
                { value: "b", label: "List" },
                { value: "c", label: "Grid" },
              ]}
            />
            <Chip checked={checked()} onChange={() => setChecked((v) => !v)}>
              Filter chip
            </Chip>
            <Badge>badge</Badge>
            <Badge variant="light" color="success">success</Badge>
            <Badge variant="dot" color="info">dot</Badge>
          </ToolbarRow>
        </Box>
      </Paper>

      {/* Text inputs family */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          TextInput / NumberInput / Password / Textarea — same box, different jobs
        </Text>
        <Box class="grid grid-cols-4 gap-3 items-start">
          <Box>{label("Text")}<TextInput placeholder="Search symbol" value={text()} onChange={setText} /></Box>
          <Box>{label("Number")}<NumberInput placeholder="40" value={num()} onChange={setNum} min={0} max={100} /></Box>
          <Box>{label("Password")}<PasswordInput placeholder="secret" /></Box>
          <Box>{label("Textarea")}<Textarea placeholder="Notes" minRows={2} /></Box>
        </Box>
        <Box class="grid grid-cols-4 gap-3 mt-3 items-start">
          <Box>{label("Error")}<TextInput placeholder="invalid" error="Required" /></Box>
          <Box>{label("Disabled")}<TextInput placeholder="off" disabled /></Box>
          <Box>{label("With label")}<TextInput label="Inline label" placeholder="…" /></Box>
          <Box>{label("Small w")}<TextInput placeholder="w=120" w={120} /></Box>
        </Box>
      </Paper>

      {/* Selects */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          Select vs MultiSelect — a dropdown and a tag-picker must not look the same
        </Text>
        <ToolbarRow gap={12}>
          <Box w={200}>
            {label("Select")}
            <Select
              value={sel()}
              onChange={setSel}
              data={[
                { value: "daily", label: "Daily" },
                { value: "intraday", label: "Intraday" },
              ]}
              placeholder="Pick timeframe"
            />
          </Box>
          <Box w={280}>
            {label("MultiSelect")}
            <MultiSelect
              value={multi()}
              onChange={setMulti}
              data={[
                { value: "NIFTY 50", label: "NIFTY 50" },
                { value: "NIFTY 100", label: "NIFTY 100" },
                { value: "NSE F&O", label: "NSE F&O" },
              ]}
              placeholder="Universes"
            />
          </Box>
          <Box w={200}>
            {label("Select disabled")}
            <Select value={null} onChange={() => {}} data={[]} placeholder="none" disabled />
          </Box>
        </ToolbarRow>
      </Paper>

      {/* Toggles */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          Switch vs Checkbox — one flips a setting, one selects a row
        </Text>
        <ToolbarRow gap={16}>
          <Switch label="Switch on" checked={switched()} onChange={(e) => setSwitched((e.currentTarget as HTMLInputElement).checked)} />
          <Switch label="Switch off" checked={false} onChange={() => {}} />
          <Switch label="Disabled" checked disabled onChange={() => {}} />
          <Checkbox label="Checkbox" checked={checked()} onChange={() => setChecked((v) => !v)} />
          <Checkbox label="Indeterminate" indeterminate onChange={() => {}} />
          <Checkbox label="Disabled" disabled onChange={() => {}} />
        </ToolbarRow>
      </Paper>

      {/* Range */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">RangeSlider — drag both ends</Text>
        <Box w={360}>
          <RangeSlider value={range()} onChange={setRange} min={0} max={100} label="Score" testId="kit-range" />
        </Box>
      </Paper>

      {/* Surfaces */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">
          Surfaces — page / panel / raised must be 3 distinguishable greys
        </Text>
        <ToolbarRow gap={0}>
          <Box class="flex-1 h-16 flex items-center justify-center" bg="var(--color-fin-bg)">bg</Box>
          <Box class="flex-1 h-16 flex items-center justify-center" bg="var(--color-fin-surface)">surface</Box>
          <Box class="flex-1 h-16 flex items-center justify-center" bg="var(--color-fin-surface-alt)">surface-alt</Box>
          <Box class="flex-1 h-16 flex items-center justify-center border border-fin-border">border</Box>
        </ToolbarRow>
        <Divider class="my-3" />
        <Text size="xs" c="dimmed">Divider above</Text>
      </Paper>

      {/* Loading / empty */}
      <Paper class="p-4">
        <Text fw={600} className="block mb-3">States</Text>
        <ToolbarRow gap={12}>
          <Button loading>Loading</Button>
          <CopyButton value="copied text">{(p) => <Button variant="outline">{p.copied ? "Copied" : "Copy"}</Button>}</CopyButton>
        </ToolbarRow>
      </Paper>
    </Box>
  );
}

function TabsRow(props: { tab: string; setTab: (v: string) => void }) {
  return (
    <Box class="flex items-center gap-2 border-b border-fin-border" data-testid="kit-tabs">
      <For each={[{ v: "one", l: "Breakouts" }, { v: "two", l: "Movers" }, { v: "three", l: "Events" }]}>
        {(t) => (
          <button
            type="button"
            onClick={() => props.setTab(t.v)}
            classList={{
              "px-3 h-8 text-[13px] border-b-2 -mb-px transition-colors": true,
              "border-fin-primary font-semibold text-fin-text": props.tab === t.v,
              "border-transparent text-fin-text-muted hover:text-fin-text": props.tab !== t.v,
            }}
          >
            {t.l}
          </button>
        )}
      </For>
    </Box>
  );
}
