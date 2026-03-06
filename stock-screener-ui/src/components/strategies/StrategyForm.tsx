import {
  Modal,
  Stack,
  TextInput,
  NumberInput,
  Group,
  Title,
  Text,
  Select,
  Tabs,
  Alert,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormProps, StrategyFormData } from "./types";

const STRATEGY_TYPES = [
  { value: "52W_CHASER", label: "52W Chaser" },
  { value: "ORB_Bullish", label: "ORB Bullish" },
  { value: "ORB_Bearish", label: "ORB Bearish" },
  { value: "ORB_Neutral", label: "ORB Neutral" },
];

const DEFAULT_VALUES: StrategyFormData = {
  name: "",
  strategy_type: "ORB_Bullish",
  parent_id: null,
  description: "",
  or_minutes: 15,
  sl_pct: 0.5,
  tp_pct: 1.0,
  min_or_range_pct: 0.3,
  max_or_range_pct: 2.0,
  max_positions: 3,
  max_capital_per_trade_pct: 20,
  max_daily_loss_pct: 5,
  max_total_exposure_pct: 50,
  risk_per_trade_pct: 2,
  min_trade_value: 5000,
  max_trade_value: 100000,
  cooldown_minutes: 30,
  max_distance_from_or_pct: 1.5,
};

export function StrategyForm({
  mode,
  strategy,
  template,
  opened,
  onClose,
  onSubmit,
}: StrategyFormProps) {
  // Determine initial values
  const getInitialValues = (): StrategyFormData => {
    if (mode === "edit" && strategy) {
      return {
        name: strategy.name,
        strategy_type: strategy.strategy_type,
        parent_id: strategy.parent_id || undefined,
        description: strategy.description || "",
        or_minutes: strategy.or_minutes,
        sl_pct: strategy.sl_pct,
        tp_pct: strategy.tp_pct,
        min_or_range_pct: strategy.min_or_range_pct,
        max_or_range_pct: strategy.max_or_range_pct,
        max_positions: strategy.max_positions,
        max_capital_per_trade_pct: strategy.max_capital_per_trade_pct,
        max_daily_loss_pct: strategy.max_daily_loss_pct,
        max_total_exposure_pct: strategy.max_total_exposure_pct,
        risk_per_trade_pct: strategy.risk_per_trade_pct,
        min_trade_value: strategy.min_trade_value,
        max_trade_value: strategy.max_trade_value,
        cooldown_minutes: strategy.cooldown_minutes,
        max_distance_from_or_pct: strategy.max_distance_from_or_pct,
      };
    }

    if (template) {
      return {
        ...DEFAULT_VALUES,
        strategy_type: template.strategy_type,
        parent_id: template.id,
        or_minutes: template.or_minutes,
        sl_pct: template.sl_pct,
        tp_pct: template.tp_pct,
        min_or_range_pct: template.min_or_range_pct,
        max_or_range_pct: template.max_or_range_pct,
        max_positions: template.max_positions,
        max_capital_per_trade_pct: template.max_capital_per_trade_pct,
        max_daily_loss_pct: template.max_daily_loss_pct,
        max_total_exposure_pct: template.max_total_exposure_pct,
        risk_per_trade_pct: template.risk_per_trade_pct,
        min_trade_value: template.min_trade_value,
        max_trade_value: template.max_trade_value,
        cooldown_minutes: template.cooldown_minutes,
        max_distance_from_or_pct: template.max_distance_from_or_pct,
        name: `${template.name} - Custom`,
      };
    }

    return DEFAULT_VALUES;
  };

  // For simplicity, we'll use window functions to handle form submission
  // The actual form state is managed by the parent through the modal approach
  const handleSubmit = () => {
    // Get form values from DOM
    const form = document.querySelector("[data-strategy-form]") as HTMLFormElement;
    if (!form) return;

    const formData = new FormData(form);
    const data: StrategyFormData = {
      name: formData.get("name") as string,
      strategy_type: formData.get("strategy_type") as string,
      parent_id:
        template?.id || (formData.get("parent_id") ? Number(formData.get("parent_id")) : undefined),
      description: (formData.get("description") as string) || undefined,
      or_minutes: Number(formData.get("or_minutes")) || DEFAULT_VALUES.or_minutes,
      sl_pct: Number(formData.get("sl_pct")) || DEFAULT_VALUES.sl_pct,
      tp_pct: Number(formData.get("tp_pct")) || DEFAULT_VALUES.tp_pct,
      min_or_range_pct: Number(formData.get("min_or_range_pct")) || DEFAULT_VALUES.min_or_range_pct,
      max_or_range_pct: Number(formData.get("max_or_range_pct")) || DEFAULT_VALUES.max_or_range_pct,
      max_positions: Number(formData.get("max_positions")) || DEFAULT_VALUES.max_positions,
      max_capital_per_trade_pct:
        Number(formData.get("max_capital_per_trade_pct")) ||
        DEFAULT_VALUES.max_capital_per_trade_pct,
      max_daily_loss_pct:
        Number(formData.get("max_daily_loss_pct")) || DEFAULT_VALUES.max_daily_loss_pct,
      max_total_exposure_pct:
        Number(formData.get("max_total_exposure_pct")) || DEFAULT_VALUES.max_total_exposure_pct,
      risk_per_trade_pct:
        Number(formData.get("risk_per_trade_pct")) || DEFAULT_VALUES.risk_per_trade_pct,
      min_trade_value: Number(formData.get("min_trade_value")) || DEFAULT_VALUES.min_trade_value,
      max_trade_value: Number(formData.get("max_trade_value")) || DEFAULT_VALUES.max_trade_value,
      cooldown_minutes: Number(formData.get("cooldown_minutes")) || DEFAULT_VALUES.cooldown_minutes,
      max_distance_from_or_pct:
        Number(formData.get("max_distance_from_or_pct")) || DEFAULT_VALUES.max_distance_from_or_pct,
    };

    onSubmit(data);
  };

  const initialValues = getInitialValues();

  return (
    <Modal
      className="strategy-form-modal"
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>{mode === "create" ? "Create Strategy" : "Edit Strategy"}</Title>}
      size="lg"
      data-testid="strategy-form-modal"
    >
      <form
        data-strategy-form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Stack gap="md">
          {template && (
            <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
              <Text size="sm">
                Creating strategy from template{" "}
                <Text fw={500} span>
                  {template.name}
                </Text>
              </Text>
            </Alert>
          )}

          <TextInput
            label="Strategy Name"
            name="name"
            placeholder="My Custom Strategy"
            defaultValue={initialValues.name}
            required
            data-testid="strategy-name-input"
          />

          <Select
            label="Strategy Type"
            name="strategy_type"
            data={STRATEGY_TYPES}
            defaultValue={initialValues.strategy_type}
            disabled={mode === "edit"}
            required
          />

          <TextInput
            label="Description"
            name="description"
            placeholder="Optional description"
            defaultValue={initialValues.description}
          />

          <Tabs defaultValue="orb">
            <Tabs.List>
              <Tabs.Tab value="orb">ORB Params</Tabs.Tab>
              <Tabs.Tab value="risk">Risk Mgmt</Tabs.Tab>
              <Tabs.Tab value="runner">Runner</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="orb">
              <Stack gap="sm" mt="sm">
                <Group grow>
                  <NumberInput
                    label="OR Minutes"
                    name="or_minutes"
                    defaultValue={initialValues.or_minutes}
                    min={1}
                    max={60}
                    suffix=" min"
                    required
                  />
                  <NumberInput
                    label="Stop Loss %"
                    name="sl_pct"
                    defaultValue={initialValues.sl_pct}
                    min={0.1}
                    max={10}
                    step={0.1}
                    suffix="%"
                    required
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Take Profit %"
                    name="tp_pct"
                    defaultValue={initialValues.tp_pct}
                    min={0.1}
                    max={10}
                    step={0.1}
                    suffix="%"
                    required
                  />
                  <NumberInput
                    label="Min OR Range %"
                    name="min_or_range_pct"
                    defaultValue={initialValues.min_or_range_pct}
                    min={0.1}
                    max={5}
                    step={0.1}
                    suffix="%"
                  />
                </Group>
                <NumberInput
                  label="Max OR Range %"
                  name="max_or_range_pct"
                  defaultValue={initialValues.max_or_range_pct}
                  min={0.1}
                  max={10}
                  step={0.1}
                  suffix="%"
                />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="risk">
              <Stack gap="sm" mt="sm">
                <Group grow>
                  <NumberInput
                    label="Max Positions"
                    name="max_positions"
                    defaultValue={initialValues.max_positions}
                    min={1}
                    max={20}
                    required
                  />
                  <NumberInput
                    label="Capital Per Trade %"
                    name="max_capital_per_trade_pct"
                    defaultValue={initialValues.max_capital_per_trade_pct}
                    min={1}
                    max={100}
                    suffix="%"
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Max Daily Loss %"
                    name="max_daily_loss_pct"
                    defaultValue={initialValues.max_daily_loss_pct}
                    min={1}
                    max={50}
                    suffix="%"
                  />
                  <NumberInput
                    label="Max Total Exposure %"
                    name="max_total_exposure_pct"
                    defaultValue={initialValues.max_total_exposure_pct}
                    min={1}
                    max={100}
                    suffix="%"
                  />
                </Group>
                <Group grow>
                  <NumberInput
                    label="Risk Per Trade %"
                    name="risk_per_trade_pct"
                    defaultValue={initialValues.risk_per_trade_pct}
                    min={0.1}
                    max={10}
                    step={0.1}
                    suffix="%"
                  />
                  <NumberInput
                    label="Cooldown Minutes"
                    name="cooldown_minutes"
                    defaultValue={initialValues.cooldown_minutes}
                    min={1}
                    max={240}
                    suffix=" min"
                  />
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="runner">
              <Stack gap="sm" mt="sm">
                <Group grow>
                  <NumberInput
                    label="Min Trade Value"
                    name="min_trade_value"
                    defaultValue={initialValues.min_trade_value}
                    min={1000}
                    max={100000}
                    step={1000}
                    prefix="₹"
                  />
                  <NumberInput
                    label="Max Trade Value"
                    name="max_trade_value"
                    defaultValue={initialValues.max_trade_value}
                    min={5000}
                    max={500000}
                    step={5000}
                    prefix="₹"
                  />
                </Group>
                <NumberInput
                  label="Max Distance from OR %"
                  name="max_distance_from_or_pct"
                  defaultValue={initialValues.max_distance_from_or_pct}
                  min={0.1}
                  max={10}
                  step={0.1}
                  suffix="%"
                />
              </Stack>
            </Tabs.Panel>
          </Tabs>

          <Group justify="flex-end" mt="md">
            <Group gap="xs">
              <button
                type="button"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-light"
                onClick={onClose}
              >
                <span className="mantine-Button-inner">
                  <span className="mantine-Button-label">Cancel</span>
                </span>
              </button>
              <button
                type="submit"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-filled"
                data-testid="submit-strategy-btn"
              >
                <span className="mantine-Button-inner">
                  <span className="mantine-Button-label">
                    {mode === "create" ? "Create" : "Save"}
                  </span>
                </span>
              </button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
