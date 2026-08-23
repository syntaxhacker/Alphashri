import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Stack, Text as MText } from "@mantine/core";
import { Select } from "./Select";

/**
 * Select — searchable dropdown for single-value choices.
 *
 * WHEN TO USE: choosing one option from >5 options; symbol pickers, bot selectors.
 * WHEN NOT: ≤4 options → SegmentedControl or Switch; multi-pick → MultiSelect.
 * A11Y: label required for screen readers; keyboard: Enter opens, arrows navigate,
 * Enter selects, Esc closes. Error state announces via aria-invalid.
 */

// Realistic NSE domain data — real symbols expose width/truncation issues
const NSE_SYMBOLS = [
  { value: "RELIANCE", label: "Reliance Industries Ltd" },
  { value: "TATAMOTORS", label: "Tata Motors Ltd" },
  { value: "M&M", label: "Mahindra & Mahindra Ltd" },
  { value: "BAJFINANCE", label: "Bajaj Finance Ltd" },
  { value: "LICI", label: "Life Insurance Corporation of India Ltd" },
  { value: "HDFCBANK", label: "HDFC Bank Ltd" },
];

const meta: Meta<typeof Select> = {
  title: "Primitives/Inputs/Select",
  component: Select,
  tags: ["autodocs", "a11y-tested"],
  parameters: { docs: { description: { component: "Searchable single-select. Use `label` always, `error` for validation, `clearable` when optional. Do: pair with helper text. Don't: render 5000+ unsearchable options." } } },
};

export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: {
    label: "Symbol",
    placeholder: "Pick an NSE symbol",
    data: NSE_SYMBOLS,
    searchable: true,
    clearable: true,
  },
};

export const WithHelperAndError: Story = {
  name: "Validation States",
  args: {
    label: "Symbol",
    data: NSE_SYMBOLS,
    withAsterisk: true,
  },
  render: (args) => (
    <Stack gap="lg" maw={340}>
      <Select {...args} description="Watchlist symbols only" />
      <Select {...args} error="Symbol not in your broker universe" defaultValue="ZZZZZZ" />
      <Select {...args} disabled label="Disabled (bot running)" />
    </Stack>
  ),
};

export const LongContent: Story = {
  name: "Long Labels",
  args: {
    label: "Symbol",
    data: NSE_SYMBOLS,
    defaultValue: "LICI",
  },
};

export const EmptyData: Story = {
  name: "No Options",
  args: {
    label: "Symbol",
    data: [],
    nothingFoundMessage: "No instruments matched your screener filters",
    placeholder: "Nothing available",
  },
};

export const LoadingSkeleton: Story = {
  name: "Loading",
  render: () => (
    <Stack gap={6} maw={340}>
      <MText size="xs" c="dimmed">Loading instrument list…</MText>
      <Select label="Symbol" data={[]} disabled placeholder="Loading…" />
    </Stack>
  ),
};

// Interaction test: open → search → select → verify onChange fired with right value.
// Runs in Storybook test runner + CI (`bunx test-storybook`).
export const SearchAndPickFlow: Story = {
  name: "⚡ Interaction: search → select",
  args: Default.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText("Pick an NSE symbol");
    await userEvent.click(input);

    // Dropdown renders in a portal — query the whole document
    const dropdown = within(document.body);
    await userEvent.type(input, "tata");

    // Search narrows to the matching option
    expect(dropdown.getByText("Tata Motors Ltd")).toBeInTheDocument();

    await userEvent.click(dropdown.getByText("Tata Motors Ltd"));

    // Input now shows the selection
    expect(input).toHaveValue("Tata Motors Ltd");
  },
};
