import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from "solid-js";
import {
  Box,
  Button,
  Modal,
  Select,
  Text,
  TextInput,
  Textarea,
  ToolbarRow,
} from "@/ui";
import type {
  SectionConcept,
  SectionCondition,
  SectionDefinition,
  SectionOp,
} from "@/state/sections/types";
import {
  SECTION_CONCEPTS,
  SECTION_REGISTRY,
  validateSection,
} from "@/state/sections/registry";
import { newSection } from "@/state/sections/presets";
import { useSectionsConfig } from "@/state/sections/config";

export interface SectionManagerModalProps {
  opened: boolean;
  onClose(): void;
  onPreview?: (d: SectionDefinition) => void;
}

const OP_LABELS: Record<SectionOp, string> = {
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  crosses_above: "crosses above",
  crosses_below: "crosses below",
  eq: "=",
};

const SIDE_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "both", label: "Both" },
];

const ALL_OPS = Object.keys(OP_LABELS) as SectionOp[];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function SectionManagerModal(props: SectionManagerModalProps): JSX.Element {
  const store = useSectionsConfig();
  const [sections, setSections] = createSignal<SectionDefinition[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<SectionDefinition | null>(null);
  const [confirming, setConfirming] = createSignal(false);
  const [importError, setImportError] = createSignal<string[]>([]);
  const [json, setJson] = createSignal("");

  createEffect(
    on(
      () => props.opened && store.hydrated(),
      (active) => {
        if (!active) return;
        const list = clone(store.config().sections);
        setSections(list);
        const first = list[0] ?? null;
        setSelectedId(first?.id ?? null);
        setDraft(first ? clone(first) : newSection(SECTION_CONCEPTS[0]!));
        setConfirming(false);
        setImportError([]);
      },
    ),
  );

  const current = () => draft();
  const descriptor = createMemo(() => {
    const d = current();
    return SECTION_REGISTRY[d?.concept ?? SECTION_CONCEPTS[0]!];
  });

  const conceptOptions = () =>
    SECTION_CONCEPTS.map((id) => ({
      value: id,
      label: SECTION_REGISTRY[id]?.label ?? id,
    }));

  const metricOptions = createMemo(() =>
    descriptor().fieldOptions.map((option) => ({ value: option.metric, label: option.label })),
  );

  const opOptions = (metric: string) => {
    const found = descriptor().fieldOptions.find((option) => option.metric === metric);
    return (found?.op ?? ALL_OPS).map((op) => ({ value: op, label: OP_LABELS[op] }));
  };

  const errors = createMemo(() => {
    const d = current();
    return d ? [...importError(), ...validateSection(d)] : [...importError()];
  });

  function patchDraft(patch: Partial<SectionDefinition>) {
    const d = current();
    if (!d) return;
    setDraft({ ...d, ...patch });
  }

  function select(id: string) {
    const found = sections().find((section) => section.id === id);
    if (!found) return;
    setSelectedId(id);
    setDraft(clone(found));
    setConfirming(false);
    setImportError([]);
  }

  function createNew() {
    setDraft(newSection(SECTION_CONCEPTS[0]!));
    setSelectedId(null);
    setConfirming(false);
    setImportError([]);
  }

  function setConcept(concept: string) {
    const d = current();
    if (!d || !SECTION_CONCEPTS.includes(concept as SectionConcept)) return;
    const next = SECTION_REGISTRY[concept as SectionConcept];
    setDraft({
      ...d,
      concept: concept as SectionConcept,
      conditions: clone(next.defaultConditions),
      render: { type: "table", columns: clone(next.defaultColumns) },
    });
  }

  function updateCondition(index: number, patch: Partial<SectionCondition>) {
    const d = current();
    if (!d) return;
    setDraft({
      ...d,
      conditions: d.conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition,
      ),
    });
  }

  function addCondition() {
    const d = current();
    if (!d) return;
    const option = descriptor().fieldOptions[0];
    setDraft({
      ...d,
      conditions: [
        ...d.conditions,
        { metric: option?.metric ?? "close", op: option?.op[0] ?? "gt", value: 0 },
      ],
    });
  }

  function removeCondition(index: number) {
    const d = current();
    if (!d) return;
    setDraft({ ...d, conditions: d.conditions.filter((_, i) => i !== index) });
  }

  function save() {
    const d = current();
    if (!d) return;
    setImportError([]);
    if (validateSection(d).length > 0) return;
    store.upsert(clone(d));
    const exists = sections().some((section) => section.id === d.id);
    setSections(
      exists
        ? sections().map((section) => (section.id === d.id ? clone(d) : section))
        : [...sections(), clone(d)],
    );
    setSelectedId(d.id);
  }

  function duplicate() {
    const d = current();
    if (!d) return;
    const copy: SectionDefinition = {
      ...clone(d),
      id: `${d.id}-copy-${Date.now()}`,
      name: `${d.name} (copy)`,
      pinned: false,
    };
    store.upsert(copy);
    setSections([...sections(), clone(copy)]);
    setSelectedId(copy.id);
    setDraft(clone(copy));
    setConfirming(false);
  }

  function removeSelected() {
    const d = current();
    if (!d) return;
    store.remove(d.id);
    const next = sections().filter((section) => section.id !== d.id);
    setSections(next);
    store.setConfig({ version: 1, sections: next });
    setConfirming(false);
    const fallback = next[0] ?? null;
    setSelectedId(fallback?.id ?? null);
    setDraft(fallback ? clone(fallback) : newSection(SECTION_CONCEPTS[0]!));
  }

  function togglePin() {
    const d = current();
    if (!d) return;
    const next = sections().map((section) =>
      section.id === d.id ? { ...section, pinned: !section.pinned } : section,
    );
    setSections(next);
    setDraft(next.find((section) => section.id === d.id) ?? d);
    store.setConfig({ version: 1, sections: next });
  }

  function move(delta: -1 | 1) {
    const id = selectedId() ?? current()?.id;
    const list = sections();
    const from = list.findIndex((section) => section.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    const moved = next[from]!;
    next[from] = next[to]!;
    next[to] = moved;
    setSections(next);
    store.setConfig({ version: 1, sections: next });
  }

  function discard() {
    const found = sections().find((section) => section.id === selectedId());
    setDraft(found ? clone(found) : newSection(SECTION_CONCEPTS[0]!));
    setImportError([]);
    setConfirming(false);
  }

  function cancel() {
    discard();
    props.onClose();
  }

  function preview() {
    const d = current();
    if (!d) return;
    setImportError([]);
    props.onPreview?.(clone(d));
  }

  function exportJson() {
    setJson(JSON.stringify({ v: 1, sections: sections() }, null, 2));
  }

  function importJson() {
    let raw: unknown;
    try {
      raw = JSON.parse(json());
    } catch {
      setImportError(["JSON is not valid"]);
      return;
    }
    const candidate = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
        ? (raw as { sections?: unknown }).sections
        : null;
    if (!Array.isArray(candidate)) {
      setImportError(["JSON must contain a sections array"]);
      return;
    }
    const incoming = candidate as SectionDefinition[];
    const problems = incoming.flatMap((definition) => validateSection(definition));
    if (problems.length > 0) {
      setImportError(problems);
      return;
    }
    const next = incoming.map((definition) => clone(definition));
    store.setConfig({ version: 1, sections: next });
    setSections(next);
    setImportError([]);
    const first = next[0] ?? null;
    setSelectedId(first?.id ?? null);
    setDraft(first ? clone(first) : newSection(SECTION_CONCEPTS[0]!));
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Signal Sections"
      size={980}
      data-testid="section-manager-modal"
    >
      <div className="flex min-h-0 flex-col gap-3 p-3 text-ui-body text-fin-text">
        <ToolbarRow gap={8} data-testid="section-toolbar" className="border-b border-fin-border pb-2">
          <Button size="xs" data-testid="section-new" onClick={createNew}>
            New
          </Button>
          <Button size="xs" variant="subtle" data-testid="section-duplicate" onClick={duplicate}>
            Duplicate
          </Button>
          <Button size="xs" variant="subtle" data-testid="section-pin" onClick={togglePin}>
            {current()?.pinned ? "Unpin" : "Pin to Home"}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            title="Move up"
            data-testid="section-move-up"
            onClick={() => move(-1)}
          >
            ↑
          </Button>
          <Button
            size="xs"
            variant="subtle"
            title="Move down"
            data-testid="section-move-down"
            onClick={() => move(1)}
          >
            ↓
          </Button>
          <Button
            size="xs"
            variant="subtle"
            data-testid="section-delete"
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        </ToolbarRow>

        <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row">
          <Box className="hidden w-64 shrink-0 flex-col gap-1 border-r border-fin-border pr-3 sm:flex">
            <Text className="text-ui-micro text-fin-text-muted">Saved sections</Text>
            <div data-testid="section-list" className="flex flex-col gap-1">
              <For each={sections()}>
                {(section) => (
                  <button
                    type="button"
                    data-testid={`section-item-${section.id}`}
                    onClick={() => select(section.id)}
                    className={
                      section.id === selectedId()
                        ? "rounded-fin border border-fin-border bg-fin-surface-alt px-2 py-1 text-left text-ui-micro text-fin-text"
                        : "rounded-fin border border-transparent px-2 py-1 text-left text-ui-micro text-fin-text-muted hover:bg-fin-surface-alt"
                    }
                  >
                    {section.pinned ? "● " : "○ "}
                    {section.name}
                  </button>
                )}
              </For>
            </div>
          </Box>

          <div className="flex flex-col gap-2 sm:hidden">
            <Select
              label="Section"
              size="sm"
              data-testid="section-select-mobile"
              data={sections().map((section) => ({ value: section.id, label: section.name }))}
              value={selectedId() ?? ""}
              onChange={(value) => value && select(value)}
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <TextInput
              label="Name"
              size="sm"
              data-testid="section-name"
              value={current()?.name ?? ""}
              onChange={(value) => patchDraft({ name: value })}
            />
            <ToolbarRow gap={8}>
              <div className="min-w-0 flex-1">
                <Select
                  label="Concept"
                  size="sm"
                  data-testid="section-concept"
                  data={conceptOptions()}
                  value={current()?.concept ?? ""}
                  onChange={(value) => value && setConcept(value)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Select
                  label="Side"
                  size="sm"
                  data-testid="section-side"
                  data={SIDE_OPTIONS}
                  value={current()?.side ?? "both"}
                  onChange={(value) => patchDraft({ side: value as SectionDefinition["side"] })}
                />
              </div>
            </ToolbarRow>

            <div className="flex flex-col gap-2">
              <Text className="text-ui-label text-fin-text-muted">Conditions</Text>
              <For each={current()?.conditions ?? []}>
                {(condition, index) => (
                  <ToolbarRow
                    gap={8}
                    data-testid={`condition-row-${index()}`}
                    className="flex-col items-stretch sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <Select
                        size="xs"
                        aria-label="Metric"
                        data-testid={`condition-metric-${index()}`}
                        data={metricOptions()}
                        value={condition.metric}
                        onChange={(value) => value && updateCondition(index(), { metric: value })}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Select
                        size="xs"
                        aria-label="Operator"
                        data-testid={`condition-op-${index()}`}
                        data={opOptions(condition.metric)}
                        value={condition.op}
                        onChange={(value) => value && updateCondition(index(), { op: value as SectionOp })}
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      <TextInput
                        size="xs"
                        aria-label="Value"
                        data-testid={`condition-value-${index()}`}
                        value={condition.value === null ? "" : String(condition.value)}
                        onChange={(value) => {
                          const parsed = value.trim() === "" ? null : Number(value);
                          updateCondition(index(), {
                            value: parsed === null || Number.isNaN(parsed) ? null : parsed,
                          });
                        }}
                      />
                    </div>
                    <Button
                      size="xs"
                      variant="subtle"
                      title="Remove condition"
                      data-testid={`condition-remove-${index()}`}
                      onClick={() => removeCondition(index())}
                    >
                      ×
                    </Button>
                  </ToolbarRow>
                )}
              </For>
              <ToolbarRow gap={8}>
                <Button size="xs" variant="subtle" data-testid="condition-add" onClick={addCondition}>
                  + Condition
                </Button>
              </ToolbarRow>
            </div>

            <div className="flex flex-col gap-1">
              <TextInput
                label="Render columns (comma separated)"
                size="sm"
                data-testid="section-columns"
                value={(current()?.render.columns ?? []).join(", ")}
                onChange={(value) =>
                  patchDraft({
                    render: {
                      type: "table",
                      columns: value
                        .split(",")
                        .map((column) => column.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </div>

            <Show when={confirming()}>
              <div
                role="alert"
                data-testid="section-delete-confirm-panel"
                className="flex flex-col gap-2 rounded-fin border border-fin-border bg-fin-surface-alt p-2"
              >
                <Text className="text-ui-micro text-fin-text">
                  Delete this section? Pinned Home/Screener windows will show an empty state.
                </Text>
                <ToolbarRow gap={8}>
                  <Button size="xs" data-testid="section-delete-confirm" onClick={removeSelected}>
                    Confirm delete
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    data-testid="section-delete-cancel"
                    onClick={() => setConfirming(false)}
                  >
                    Keep
                  </Button>
                </ToolbarRow>
              </div>
            </Show>

            <Show when={errors().length > 0}>
              <div
                role="alert"
                data-testid="section-validation"
                className="flex flex-col gap-1 rounded-fin border border-fin-border bg-fin-surface-alt p-2 text-ui-micro text-fin-negative"
              >
                <For each={errors()}>{(message) => <span>{message}</span>}</For>
              </div>
            </Show>

            <div className="flex flex-col gap-2 border-t border-fin-border pt-3">
              <Text className="text-ui-label text-fin-text-muted">JSON export / import</Text>
              <Textarea
                data-testid="section-json"
                value={json()}
                onChange={setJson}
                resize="vertical"
                minRows={3}
              />
              <ToolbarRow gap={8}>
                <Button size="xs" variant="subtle" data-testid="section-export" onClick={exportJson}>
                  Export JSON
                </Button>
                <Button size="xs" variant="subtle" data-testid="section-import" onClick={importJson}>
                  Import JSON
                </Button>
              </ToolbarRow>
            </div>
          </div>
        </div>

        <ToolbarRow
          gap={8}
          justify="flex-end"
          data-testid="section-footer"
          className="sticky bottom-0 border-t border-fin-border bg-fin-surface pt-2"
        >
          <Button size="sm" variant="subtle" data-testid="section-preview" onClick={preview}>
            Preview
          </Button>
          <Button size="sm" variant="subtle" data-testid="section-discard" onClick={discard}>
            Discard
          </Button>
          <Button size="sm" variant="subtle" data-testid="section-cancel" onClick={cancel}>
            Cancel
          </Button>
          <Button size="sm" data-testid="section-save" onClick={save}>
            Save
          </Button>
        </ToolbarRow>
      </div>
    </Modal>
  );
}
