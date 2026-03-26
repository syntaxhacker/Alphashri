import { useState } from "react";
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
  Switch,
} from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import type { StrategyFormProps, StrategyFormData } from "./types";

const STRATEGY_TYPES = [
  { value: "ORB", label: "ORB" },
  { value: "SR_BREAKOUT", label: "S/R Breakout" },
  { value: "52W_CHASER", label: "52W Chaser" },
  { value: "52W_TARGET", label: "52W Target" },
  { value: "EMA_CROSS", label: "EMA Cross" },
];

const INTRADAY_TYPES = ["ORB", "SR_BREAKOUT", "EMA_CROSS"];
const SWING_TYPES = ["52W_CHASER", "52W_TARGET"];

const DEFAULT_VALUES: StrategyFormData = {
  name: "",
  strategy_type: "ORB",
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
  entry_threshold_pct: 3.0,
  enable_trailing_stop: false,
  trailing_stop_pct: 3.0,
  trailing_activation_pct: 2.0,
  max_holding_days: 30,
  cooldown_days: 30,
  enable_filters: false,
  ema_fast_period: 9,
  ema_slow_period: 21,
  pivot_type: "classic",
  breakout_buffer_pct: 0.1,
};

function getNumVal(formData: FormData, key: string, fallback: number): number {
  const v = formData.get(key);
  return v ? Number(v) : fallback;
}

export function StrategyForm({
  mode,
  strategy,
  template,
  opened,
  onClose,
  onSubmit,
}: StrategyFormProps) {
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
        entry_threshold_pct: strategy.entry_threshold_pct,
        enable_trailing_stop: strategy.enable_trailing_stop,
        trailing_stop_pct: strategy.trailing_stop_pct,
        trailing_activation_pct: strategy.trailing_activation_pct,
        max_holding_days: strategy.max_holding_days,
        cooldown_days: strategy.cooldown_days,
        enable_filters: strategy.enable_filters,
        ema_fast_period: strategy.ema_fast_period,
        ema_slow_period: strategy.ema_slow_period,
        pivot_type: strategy.pivot_type,
        breakout_buffer_pct: strategy.breakout_buffer_pct,
      };
    }

    if (template) {
      return {
        ...DEFAULT_VALUES,
        strategy_type: template.strategy_type,
        parent_id: template.id,
        name: `${template.name} - Custom`,
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
        entry_threshold_pct: template.entry_threshold_pct,
        enable_trailing_stop: template.enable_trailing_stop,
        trailing_stop_pct: template.trailing_stop_pct,
        trailing_activation_pct: template.trailing_activation_pct,
        max_holding_days: template.max_holding_days,
        cooldown_days: template.cooldown_days,
        enable_filters: template.enable_filters,
        ema_fast_period: template.ema_fast_period,
        ema_slow_period: template.ema_slow_period,
        pivot_type: template.pivot_type,
        breakout_buffer_pct: template.breakout_buffer_pct,
      };
    }

    return DEFAULT_VALUES;
  };

  const handleSubmit = () => {
    const form = document.querySelector("[data-strategy-form]") as HTMLFormElement;
    if (!form) return;

    const formData = new FormData(form);
    const data: StrategyFormData = {
      name: formData.get("name") as string,
      strategy_type: formData.get("strategy_type") as string,
      parent_id:
        template?.id || (formData.get("parent_id") ? Number(formData.get("parent_id")) : undefined),
      description: (formData.get("description") as string) || undefined,
      or_minutes: getNumVal(formData, "or_minutes", DEFAULT_VALUES.or_minutes),
      sl_pct: getNumVal(formData, "sl_pct", DEFAULT_VALUES.sl_pct),
      tp_pct: getNumVal(formData, "tp_pct", DEFAULT_VALUES.tp_pct),
      min_or_range_pct: getNumVal(formData, "min_or_range_pct", DEFAULT_VALUES.min_or_range_pct),
      max_or_range_pct: getNumVal(formData, "max_or_range_pct", DEFAULT_VALUES.max_or_range_pct),
      max_positions: getNumVal(formData, "max_positions", DEFAULT_VALUES.max_positions),
      max_capital_per_trade_pct: getNumVal(
        formData,
        "max_capital_per_trade_pct",
        DEFAULT_VALUES.max_capital_per_trade_pct,
      ),
      max_daily_loss_pct: getNumVal(
        formData,
        "max_daily_loss_pct",
        DEFAULT_VALUES.max_daily_loss_pct,
      ),
      max_total_exposure_pct: getNumVal(
        formData,
        "max_total_exposure_pct",
        DEFAULT_VALUES.max_total_exposure_pct,
      ),
      risk_per_trade_pct: getNumVal(
        formData,
        "risk_per_trade_pct",
        DEFAULT_VALUES.risk_per_trade_pct,
      ),
      min_trade_value: getNumVal(formData, "min_trade_value", DEFAULT_VALUES.min_trade_value),
      max_trade_value: getNumVal(formData, "max_trade_value", DEFAULT_VALUES.max_trade_value),
      cooldown_minutes: getNumVal(formData, "cooldown_minutes", DEFAULT_VALUES.cooldown_minutes),
      max_distance_from_or_pct: getNumVal(
        formData,
        "max_distance_from_or_pct",
        DEFAULT_VALUES.max_distance_from_or_pct,
      ),
      entry_threshold_pct: getNumVal(
        formData,
        "entry_threshold_pct",
        DEFAULT_VALUES.entry_threshold_pct,
      ),
      trailing_stop_pct: getNumVal(formData, "trailing_stop_pct", DEFAULT_VALUES.trailing_stop_pct),
      trailing_activation_pct: getNumVal(
        formData,
        "trailing_activation_pct",
        DEFAULT_VALUES.trailing_activation_pct,
      ),
      max_holding_days: getNumVal(formData, "max_holding_days", DEFAULT_VALUES.max_holding_days),
      cooldown_days: getNumVal(formData, "cooldown_days", DEFAULT_VALUES.cooldown_days),
      ema_fast_period: getNumVal(formData, "ema_fast_period", DEFAULT_VALUES.ema_fast_period),
      ema_slow_period: getNumVal(formData, "ema_slow_period", DEFAULT_VALUES.ema_slow_period),
      breakout_buffer_pct: getNumVal(
        formData,
        "breakout_buffer_pct",
        DEFAULT_VALUES.breakout_buffer_pct,
      ),
      pivot_type: (formData.get("pivot_type") as string) || DEFAULT_VALUES.pivot_type,
    };

    const enableTrailingEl = form.querySelector(
      "[name='enable_trailing_stop']",
    ) as HTMLInputElement;
    data.enable_trailing_stop = enableTrailingEl ? enableTrailingEl.checked : false;

    const enableFiltersEl = form.querySelector("[name='enable_filters']") as HTMLInputElement;
    data.enable_filters = enableFiltersEl ? enableFiltersEl.checked : false;

    if (data.strategy_type === "EMA_CROSS" && data.ema_fast_period >= data.ema_slow_period) {
      window.alert("Fast EMA period must be less than Slow EMA period");
      return;
    }

    onSubmit(data);
  };

  const initialValues = getInitialValues();
  const [currentStrategyType, setCurrentStrategyType] = useState(initialValues.strategy_type);
  const isIntraday = INTRADAY_TYPES.includes(currentStrategyType);
  const isSwing = SWING_TYPES.includes(currentStrategyType);
  const isOrb = currentStrategyType === "ORB";
  const isSrBreakout = currentStrategyType === "SR_BREAKOUT";
  const isEmaCross = currentStrategyType === "EMA_CROSS";
  const is52wChaser = currentStrategyType === "52W_CHASER";
  const is52wTarget = currentStrategyType === "52W_TARGET";

  const defaultTab = isOrb ? "orb" : isSrBreakout ? "sr" : isEmaCross ? "ema" : "52w";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const SlTpRow = () => (
    <Group grow>
      <NumberInput
        label="Stop Loss %"
        name="sl_pct"
        defaultValue={initialValues.sl_pct}
        min={0.1}
        max={isSwing ? 30 : 10}
        step={0.1}
        suffix="%"
        required
        data-testid="strategy-sl-pct-input"
      />
      <NumberInput
        label="Take Profit %"
        name="tp_pct"
        defaultValue={initialValues.tp_pct}
        min={0.1}
        max={isSwing ? 20 : 10}
        step={isSwing ? 0.5 : 0.1}
        suffix="%"
        required={!isSwing}
        data-testid="strategy-tp-pct-input"
      />
    </Group>
  );

  return (
    <Modal
      className="strategy-form-modal"
      id="strategy-form-modal"
      opened={opened}
      onClose={onClose}
      title={<Title order={4}>{mode === "create" ? "Create Strategy" : "Edit Strategy"}</Title>}
      size="lg"
      data-testid="strategy-form-modal"
    >
      <form
        data-strategy-form
        className="strategy-form"
        id="strategy-form"
        data-testid="strategy-form"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Stack gap="sm" className="strategy-form-content">
          {template && (
            <Alert
              icon={<IconInfoCircle size={16} />}
              color="blue"
              variant="light"
              className="strategy-form-template-info"
              data-testid="strategy-form-template-info"
            >
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
            onChange={(val) => {
              if (val) {
                setCurrentStrategyType(val);
                setActiveTab(val === "ORB" ? "orb" : val === "SR_BREAKOUT" ? "sr" : val === "EMA_CROSS" ? "ema" : "52w");
              }
            }}
            required
            data-testid="strategy-type-input"
          />

          <TextInput
            label="Description"
            name="description"
            placeholder="Optional description"
            defaultValue={initialValues.description}
            data-testid="strategy-description-input"
          />

          <Tabs
            value={activeTab}
            onChange={setActiveTab}
            className="strategy-form-tabs"
            data-testid="strategy-form-tabs"
          >
            <Tabs.List className="strategy-form-tabs-list" data-testid="strategy-form-tabs-list">
              {isOrb && (
                <Tabs.Tab value="orb" data-testid="strategy-tab-orb">
                  ORB Params
                </Tabs.Tab>
              )}
              {isSrBreakout && (
                <Tabs.Tab value="sr" data-testid="strategy-tab-sr">
                  S/R Breakout
                </Tabs.Tab>
              )}
              {isEmaCross && (
                <Tabs.Tab value="ema" data-testid="strategy-tab-ema">
                  EMA Params
                </Tabs.Tab>
              )}
              {isSwing && (
                <Tabs.Tab value="52w" data-testid="strategy-tab-52w">
                  52W Params
                </Tabs.Tab>
              )}
              <Tabs.Tab value="risk" data-testid="strategy-tab-risk">
                Risk Mgmt
              </Tabs.Tab>
              <Tabs.Tab value="runner" data-testid="strategy-tab-runner">
                Runner
              </Tabs.Tab>
            </Tabs.List>

            {isOrb && (
              <Tabs.Panel
                value="orb"
                className="strategy-form-tab-panel"
                data-testid="strategy-panel-orb"
              >
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
                      data-testid="strategy-or-minutes-input"
                    />
                    <NumberInput
                      label="Min OR Range %"
                      name="min_or_range_pct"
                      defaultValue={initialValues.min_or_range_pct}
                      min={0.1}
                      max={5}
                      step={0.1}
                      suffix="%"
                      data-testid="strategy-min-or-range-input"
                    />
                  </Group>
                  <SlTpRow />
                  <NumberInput
                    label="Max OR Range %"
                    name="max_or_range_pct"
                    defaultValue={initialValues.max_or_range_pct}
                    min={0.1}
                    max={10}
                    step={0.1}
                    suffix="%"
                    data-testid="strategy-max-or-range-input"
                  />
                </Stack>
              </Tabs.Panel>
            )}

            {isSrBreakout && (
              <Tabs.Panel
                value="sr"
                className="strategy-form-tab-panel"
                data-testid="strategy-panel-sr"
              >
                <Stack gap="sm" mt="sm">
                  <SlTpRow />
                  <Select
                    label="Pivot Type"
                    name="pivot_type"
                    data={[
                      { value: "classic", label: "Classic" },
                      { value: "fibonacci", label: "Fibonacci" },
                      { value: "camarilla", label: "Camarilla" },
                    ]}
                    defaultValue={initialValues.pivot_type}
                    required
                    data-testid="strategy-pivot-type-input"
                  />
                  <NumberInput
                    label="Breakout Buffer %"
                    name="breakout_buffer_pct"
                    defaultValue={initialValues.breakout_buffer_pct}
                    min={0}
                    max={1}
                    step={0.05}
                    suffix="%"
                    data-testid="strategy-breakout-buffer-input"
                  />
                </Stack>
              </Tabs.Panel>
            )}

            {isEmaCross && (
              <Tabs.Panel
                value="ema"
                className="strategy-form-tab-panel"
                data-testid="strategy-panel-ema"
              >
                <Stack gap="sm" mt="sm">
                  <Group grow>
                    <NumberInput
                      label="Fast EMA Period"
                      name="ema_fast_period"
                      defaultValue={initialValues.ema_fast_period}
                      min={3}
                      max={50}
                      required
                      data-testid="strategy-ema-fast-period-input"
                    />
                    <NumberInput
                      label="Slow EMA Period"
                      name="ema_slow_period"
                      defaultValue={initialValues.ema_slow_period}
                      min={10}
                      max={200}
                      required
                      data-testid="strategy-ema-slow-period-input"
                    />
                  </Group>
                  <SlTpRow />
                </Stack>
              </Tabs.Panel>
            )}

            {isSwing && (
              <Tabs.Panel
                value="52w"
                className="strategy-form-tab-panel"
                data-testid="strategy-panel-52w"
              >
                <Stack gap="sm" mt="sm">
                  <Group grow>
                    <NumberInput
                      label="Entry Threshold %"
                      name="entry_threshold_pct"
                      defaultValue={initialValues.entry_threshold_pct}
                      min={0.5}
                      max={10}
                      step={0.5}
                      suffix="%"
                      required
                      data-testid="strategy-entry-threshold-input"
                    />
                  </Group>
                  <SlTpRow />
                  <Group grow>
                    <NumberInput
                      label="Trailing Stop %"
                      name="trailing_stop_pct"
                      defaultValue={initialValues.trailing_stop_pct}
                      min={0.1}
                      max={10}
                      step={0.1}
                      suffix="%"
                      data-testid="strategy-trailing-stop-input"
                    />
                  </Group>
                  <Group grow>
                    <NumberInput
                      label="Max Holding Days"
                      name="max_holding_days"
                      defaultValue={initialValues.max_holding_days}
                      min={1}
                      max={90}
                      suffix=" days"
                      data-testid="strategy-max-holding-input"
                    />
                    <NumberInput
                      label="Cooldown Days"
                      name="cooldown_days"
                      defaultValue={initialValues.cooldown_days}
                      min={1}
                      max={90}
                      suffix=" days"
                      data-testid="strategy-cooldown-days-input"
                    />
                  </Group>
                  {is52wChaser && (
                    <>
                      <Group grow>
                        <Switch
                          label="Enable Trailing Stop"
                          name="enable_trailing_stop"
                          defaultChecked={initialValues.enable_trailing_stop}
                          data-testid="strategy-enable-trailing-input"
                        />
                        <Switch
                          label="Enable Filters (ADX/RSI/Volume/MA)"
                          name="enable_filters"
                          defaultChecked={initialValues.enable_filters}
                          data-testid="strategy-enable-filters-input"
                        />
                      </Group>
                      <NumberInput
                        label="Trailing Activation %"
                        name="trailing_activation_pct"
                        defaultValue={initialValues.trailing_activation_pct}
                        min={0.1}
                        max={10}
                        step={0.1}
                        suffix="%"
                        data-testid="strategy-trailing-activation-input"
                      />
                    </>
                  )}
                </Stack>
              </Tabs.Panel>
            )}

            <Tabs.Panel
              value="risk"
              className="strategy-form-tab-panel"
              data-testid="strategy-panel-risk"
            >
              <Stack gap="sm" mt="sm">
                <Group grow>
                  <NumberInput
                    label="Max Positions"
                    name="max_positions"
                    defaultValue={initialValues.max_positions}
                    min={1}
                    max={20}
                    required
                    data-testid="strategy-max-positions-input"
                  />
                  <NumberInput
                    label="Capital Per Trade %"
                    name="max_capital_per_trade_pct"
                    defaultValue={initialValues.max_capital_per_trade_pct}
                    min={1}
                    max={100}
                    suffix="%"
                    data-testid="strategy-capital-per-trade-input"
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
                    data-testid="strategy-max-daily-loss-input"
                  />
                  <NumberInput
                    label="Max Total Exposure %"
                    name="max_total_exposure_pct"
                    defaultValue={initialValues.max_total_exposure_pct}
                    min={1}
                    max={100}
                    suffix="%"
                    data-testid="strategy-max-exposure-input"
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
                    data-testid="strategy-risk-per-trade-input"
                  />
                  {isIntraday ? (
                    <NumberInput
                      label="Cooldown Minutes"
                      name="cooldown_minutes"
                      defaultValue={initialValues.cooldown_minutes}
                      min={1}
                      max={240}
                      suffix=" min"
                      data-testid="strategy-cooldown-input"
                    />
                  ) : (
                    <NumberInput
                      label="Cooldown Days"
                      name="cooldown_days"
                      defaultValue={initialValues.cooldown_days}
                      min={1}
                      max={90}
                      suffix=" days"
                      data-testid="strategy-cooldown-input"
                    />
                  )}
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel
              value="runner"
              className="strategy-form-tab-panel"
              data-testid="strategy-panel-runner"
            >
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
                    data-testid="strategy-min-trade-value-input"
                  />
                  <NumberInput
                    label="Max Trade Value"
                    name="max_trade_value"
                    defaultValue={initialValues.max_trade_value}
                    min={5000}
                    max={500000}
                    step={5000}
                    prefix="₹"
                    data-testid="strategy-max-trade-value-input"
                  />
                </Group>
                {isOrb && (
                  <NumberInput
                    label="Max Distance from OR %"
                    name="max_distance_from_or_pct"
                    defaultValue={initialValues.max_distance_from_or_pct}
                    min={0.1}
                    max={10}
                    step={0.1}
                    suffix="%"
                    data-testid="strategy-max-distance-input"
                  />
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>

          <Group
            justify="flex-end"
            mt="md"
            className="strategy-form-actions"
            data-testid="strategy-form-actions"
          >
            <Group gap="xs">
              <button
                type="button"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-light strategy-form-cancel-btn"
                onClick={onClose}
                data-testid="strategy-cancel-btn"
              >
                <span className="mantine-Button-inner">
                  <span className="mantine-Button-label">Cancel</span>
                </span>
              </button>
              <button
                type="submit"
                className="mantine-UnstyledButton-root mantine-Button-root mantine-Button--variant-filled strategy-form-submit-btn"
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
