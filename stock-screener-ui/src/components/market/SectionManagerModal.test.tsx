// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import type { SectionDefinition } from "@/state/sections/types";
import { SectionManagerModal, type SectionManagerModalProps } from "./SectionManagerModal";

const H = vi.hoisted(() => {
  const concepts = ["vwap_cross", "momentum_5m", "rvol_spike", "orb_proxy"] as const;
  const metrics = ["close", "VWAP", "change|5", "relative_volume_10d_calc"];
  const ops = ["gt", "gte", "lt", "lte", "crosses_above", "crosses_below", "eq"];
  const descriptors: Record<string, Record<string, unknown>> = {
    vwap_cross: {
      id: "vwap_cross",
      label: "VWAP cross",
      description: "Close crossing VWAP in either direction.",
      requires: "tv",
      fieldOptions: [
        { metric: "close", label: "Close", op: ["gt", "crosses_above"] },
        { metric: "VWAP", label: "VWAP", op: ["crosses_above", "crosses_below"] },
      ],
      defaultConditions: [{ metric: "close", op: "crosses_above", value: null }],
      defaultColumns: ["symbol", "change", "VWAP"],
    },
    momentum_5m: {
      id: "momentum_5m",
      label: "Momentum 5m",
      description: "Five minute momentum",
      requires: "tv",
      fieldOptions: [
        { metric: "change|5", label: "Change 5m", op: ["gt", "gte", "lt"] },
        { metric: "relative_volume_10d_calc", label: "RVOL", op: ["gt", "gte"] },
      ],
      defaultConditions: [{ metric: "change|5", op: "gt", value: 1 }],
      defaultColumns: ["symbol", "change|5", "relative_volume_10d_calc"],
    },
    rvol_spike: {
      id: "rvol_spike",
      label: "RVOL Spike",
      description: "Relative volume spike",
      requires: "tv",
      fieldOptions: [{ metric: "relative_volume_10d_calc", label: "RVOL", op: ["gt", "gte"] }],
      defaultConditions: [{ metric: "relative_volume_10d_calc", op: "gt", value: 2 }],
      defaultColumns: ["symbol", "relative_volume_10d_calc"],
    },
    orb_proxy: {
      id: "orb_proxy",
      label: "ORB Proxy",
      description: "Opening-range breakout proxy; needs bar history.",
      requires: "bars",
      fieldOptions: [{ metric: "close", label: "Close", op: ["gt", "crosses_above"] }],
      defaultConditions: [{ metric: "close", op: "crosses_above", value: null }],
      defaultColumns: ["symbol", "close"],
    },
  };
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  let counter = 0;

  const makeInitial = (): SectionDefinition[] => [
    {
      id: "vwap-reclaim",
      name: "VWAP reclaim",
      description: "Cross above VWAP",
      concept: "vwap_cross",
      side: "long",
      conditions: [{ metric: "close", op: "crosses_above", value: null }],
      render: { type: "table", columns: ["symbol", "change", "VWAP"] },
      refreshSec: 30,
      enabled: true,
      pinned: false,
    },
    {
      id: "momentum-5m",
      name: "Momentum 5m",
      description: "Five minute momentum",
      concept: "momentum_5m",
      side: "both",
      conditions: [{ metric: "change|5", op: "gt", value: 1 }],
      render: { type: "table", columns: ["symbol", "change|5"] },
      refreshSec: 60,
      enabled: true,
      pinned: false,
    },
  ];

  const newSection = vi.fn((concept: string) => {
    const d = descriptors[concept]!;
    counter += 1;
    return {
      id: `draft-${counter}`,
      name: d.label,
      description: d.description,
      concept,
      side: "both",
      conditions: clone(d.defaultConditions),
      render: { type: "table", columns: clone(d.defaultColumns) },
      refreshSec: 30,
      enabled: true,
      pinned: false,
    } as unknown as SectionDefinition;
  });

  const validateSection = vi.fn((d: SectionDefinition): string[] => {
    const out: string[] = [];
    if (!d || typeof d !== "object") return ["section is invalid"];
    if (!String(d.name ?? "").trim()) out.push("name is required");
    if (!Array.isArray(d.conditions) || d.conditions.length === 0) {
      out.push("at least one condition is required");
    }
    for (const c of d.conditions ?? []) {
      if (!metrics.includes(c.metric)) out.push(`unknown metric: ${c.metric}`);
      if (!ops.includes(c.op)) out.push(`unknown operator: ${c.op}`);
    }
    return out;
  });

  return {
    concepts,
    descriptors,
    newSection,
    validateSection,
    makeInitial,
    initial: makeInitial(),
    upsert: vi.fn(),
    remove: vi.fn(),
    setConfig: vi.fn(),
  };
});

vi.mock("@/state/sections/registry", () => ({
  SECTION_CONCEPTS: H.concepts,
  SECTION_REGISTRY: H.descriptors,
  newSection: H.newSection,
  validateSection: H.validateSection,
}));

vi.mock("@/state/sections/presets", () => ({
  newSection: H.newSection,
  DEFAULT_SECTIONS: H.initial,
}));

vi.mock("@/state/sections/config", () => ({
  useSectionsConfig: () => ({
    config: () => ({ sections: H.initial, version: 1 }),
    setConfig: H.setConfig,
    upsert: H.upsert,
    remove: H.remove,
    hydrated: () => true,
    status: () => "ready",
  }),
}));

function open(props: Partial<SectionManagerModalProps> = {}) {
  const onClose = vi.fn();
  const onPreview = vi.fn();
  const rendered = render(() => (
    <UIProvider>
      <SectionManagerModal opened onClose={onClose} onPreview={onPreview} {...props} />
    </UIProvider>
  ));
  return { ...rendered, onClose, onPreview };
}

function nameInput() {
  return screen.getByTestId("section-name") as HTMLInputElement;
}

function setValue(testId: string, value: string) {
  fireEvent.input(screen.getByTestId(testId), { target: { value } });
}

function selectByTestId(testId: string, value: string) {
  fireEvent.input(within(screen.getByTestId(testId)).getByRole("combobox"), { target: { value } });
}

function sourceValue(index: number): string {
  return (within(screen.getByTestId(`condition-value-source-${index}`)).getByRole("combobox") as HTMLSelectElement).value;
}

beforeEach(() => {
  H.initial = H.makeInitial();
  for (const fn of [H.upsert, H.remove, H.setConfig, H.newSection, H.validateSection]) {
    fn.mockClear();
  }
});

afterEach(() => cleanup());

describe("SectionManagerModal — CRUD", () => {
  test("create: New loads a registry draft and Save upserts it", () => {
    open();
    expect(nameInput().value).toBe("VWAP reclaim");

    fireEvent.click(screen.getByTestId("section-new"));
    expect(nameInput().value).toBe("VWAP cross");

    setValue("section-name", "My new section");
    fireEvent.click(screen.getByTestId("section-save"));

    expect(H.upsert).toHaveBeenCalledTimes(1);
    expect(H.upsert.mock.calls[0][0]).toMatchObject({ name: "My new section" });
  });

  test("edit: Save upserts the edited draft with the same id", () => {
    open();
    setValue("section-name", "Renamed reclaim");
    fireEvent.click(screen.getByTestId("section-save"));

    expect(H.upsert).toHaveBeenCalledTimes(1);
    expect(H.upsert.mock.calls[0][0]).toMatchObject({
      id: "vwap-reclaim",
      name: "Renamed reclaim",
    });
  });

  test("duplicate: creates a copy with a new id and selects it", () => {
    open();
    fireEvent.click(screen.getByTestId("section-duplicate"));

    expect(H.upsert).toHaveBeenCalledTimes(1);
    const copy = H.upsert.mock.calls[0][0] as SectionDefinition;
    expect(copy.id).not.toBe("vwap-reclaim");
    expect(copy.name).toContain("(copy)");
    expect(nameInput().value).toBe(copy.name);
  });

  test("delete: requires an explicit confirm before removing", () => {
    open();
    fireEvent.click(screen.getByTestId("section-delete"));
    expect(screen.getByTestId("section-delete-confirm")).toBeInTheDocument();
    expect(H.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("section-delete-confirm"));
    expect(H.remove).toHaveBeenCalledWith("vwap-reclaim");
    expect(screen.queryByTestId("section-delete-confirm")).not.toBeInTheDocument();
  });

  test("pin and reorder write the full config through setConfig", () => {
    open();
    fireEvent.click(screen.getByTestId("section-pin"));
    expect(H.setConfig.mock.calls[0][0].sections[0].pinned).toBe(true);

    H.setConfig.mockClear();
    fireEvent.click(screen.getByTestId("section-move-down"));
    expect(H.setConfig.mock.calls[0][0].sections.map((s: SectionDefinition) => s.id)).toEqual([
      "momentum-5m",
      "vwap-reclaim",
    ]);
  });

  test("condition rows add/remove from the registry and preview the draft", () => {
    const { onPreview } = open();
    const before = screen.queryAllByTestId(/^condition-row-/).length;
    fireEvent.click(screen.getByTestId("condition-add"));
    expect(screen.queryAllByTestId(/^condition-row-/).length).toBe(before + 1);

    fireEvent.click(screen.getByTestId("condition-remove-0"));
    expect(screen.queryAllByTestId(/^condition-row-/).length).toBe(before);

    fireEvent.click(screen.getByTestId("section-preview"));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0][0]).toMatchObject({ id: "vwap-reclaim" });
  });
});

describe("SectionManagerModal — JSON and validation", () => {
  test("import: parses a payload and selects the first imported section", () => {
    open();
    const payload = {
      v: 1,
      sections: [
        {
          ...H.initial[0],
          id: "imported-one",
          name: "Imported section",
          conditions: [{ metric: "VWAP", op: "gte", value: 100 }],
        },
      ],
    };
    setValue("section-json", JSON.stringify(payload));
    fireEvent.click(screen.getByTestId("section-import"));

    expect(H.setConfig).toHaveBeenCalledTimes(1);
    expect(H.setConfig.mock.calls[0][0].sections.map((s: SectionDefinition) => s.id)).toEqual([
      "imported-one",
    ]);
    expect(nameInput().value).toBe("Imported section");
  });

  test("export: writes the saved list as a versioned JSON payload", () => {
    open();
    fireEvent.click(screen.getByTestId("section-export"));
    const text = (screen.getByTestId("section-json") as HTMLTextAreaElement).value;
    const parsed = JSON.parse(text);
    expect(parsed.v).toBe(1);
    expect(parsed.sections).toEqual(H.initial);
  });

  test("validation: an empty name blocks Save and shows an inline error", () => {
    open();
    setValue("section-name", "");
    fireEvent.click(screen.getByTestId("section-save"));

    expect(H.upsert).not.toHaveBeenCalled();
    const alert = screen.getByTestId("section-validation");
    expect(alert).toHaveTextContent(/name is required/);
  });

  test("validation: an unknown metric is rejected on import", () => {
    open();
    const payload = {
      v: 1,
      sections: [
        { ...H.initial[0], id: "bad", conditions: [{ metric: "vwap", op: "gt", value: 0 }] },
      ],
    };
    setValue("section-json", JSON.stringify(payload));
    fireEvent.click(screen.getByTestId("section-import"));

    expect(H.setConfig).not.toHaveBeenCalled();
    expect(screen.getByTestId("section-validation")).toHaveTextContent(/vwap/);
  });

  test("validation: malformed JSON is rejected without writing", () => {
    open();
    setValue("section-json", "{not json");
    fireEvent.click(screen.getByTestId("section-import"));

    expect(H.setConfig).not.toHaveBeenCalled();
    expect(screen.getByTestId("section-validation")).toHaveTextContent(/JSON/i);
  });
});

describe("SectionManagerModal — dismissal and responsive list", () => {
  test("Escape closes through the Modal contract", () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("an outside backdrop click closes through the Modal contract", () => {
    const { onClose } = open();
    fireEvent.click(screen.getByTestId("section-manager-modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Cancel discards and closes", () => {
    const { onClose } = open();
    setValue("section-name", "Do not keep");
    fireEvent.click(screen.getByTestId("section-cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(H.upsert).not.toHaveBeenCalled();
  });

  test("390px list is a labelled Select bound to the same sections", () => {
    open();
    const select = screen.getByLabelText("Section");
    expect(select).toBeInTheDocument();
    expect(within(select.closest("div")!.parentElement!).getByRole("combobox")).toHaveValue(
      "vwap-reclaim",
    );
  });
});

describe("SectionManagerModal — condition value sources", () => {
  test("the source follows the stored value type and Number parses finite values", () => {
    open();
    expect(sourceValue(0)).toBe("concept");

    selectByTestId("condition-value-source-0", "number");
    expect(sourceValue(0)).toBe("number");
    setValue("condition-value-0", "12.5");
    fireEvent.click(screen.getByTestId("section-save"));

    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBe(12.5);
  });

  test("blank and non-numeric Number values save null", () => {
    open();
    selectByTestId("condition-value-source-0", "number");
    setValue("condition-value-0", "not-a-number");
    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBeNull();

    setValue("condition-value-0", "");
    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[1][0].conditions[0].value).toBeNull();
  });

  test("Field offers only registry fields and persists the field-name string", () => {
    open();
    selectByTestId("condition-value-source-0", "field");

    expect(sourceValue(0)).toBe("field");
    expect(screen.queryByTestId("condition-value-0")).not.toBeInTheDocument();
    const options = Array.from(
      screen.getByTestId("condition-value-field-0").querySelectorAll("option"),
    ).map((option) => (option as HTMLOptionElement).value);
    expect(options).toEqual(["close", "VWAP"]);

    selectByTestId("condition-value-field-0", "VWAP");
    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBe("VWAP");
  });

  test("a field string survives later edits instead of being parsed to null", () => {
    const { onPreview } = open();
    selectByTestId("condition-value-source-0", "field");
    selectByTestId("condition-value-field-0", "VWAP");
    setValue("section-name", "Renamed reclaim");

    fireEvent.click(screen.getByTestId("section-preview"));
    expect(onPreview.mock.calls[0][0].conditions[0].value).toBe("VWAP");

    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBe("VWAP");
  });

  test("Concept default persists null and shows the resolved reference", () => {
    const { onPreview } = open();
    expect(screen.getByTestId("condition-concept-reference-0")).toHaveTextContent("VWAP");

    selectByTestId("condition-value-source-0", "number");
    selectByTestId("condition-value-source-0", "concept");
    expect(screen.getByTestId("condition-concept-reference-0")).toHaveTextContent("VWAP");

    fireEvent.click(screen.getByTestId("section-preview"));
    expect(onPreview.mock.calls[0][0].conditions[0].value).toBeNull();
    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBeNull();
  });

  test("Concept default is honest when the concept has no reference", () => {
    open();
    fireEvent.click(screen.getByTestId("section-item-momentum-5m"));
    selectByTestId("condition-value-source-0", "concept");

    expect(screen.getByTestId("condition-concept-reference-0")).toHaveTextContent(
      /no concept reference/i,
    );
    fireEvent.click(screen.getByTestId("section-save"));
    expect(H.upsert.mock.calls[0][0].conditions[0].value).toBeNull();
  });
});

describe("SectionManagerModal — Usage panel", () => {
  test("explains the concept, side, data source, fields, placement and rule", () => {
    open();
    const usage = screen.getByTestId("section-usage");

    expect(within(usage).getByTestId("section-usage-label")).toHaveTextContent("VWAP cross");
    expect(within(usage).getByTestId("section-usage-description")).toHaveTextContent(
      "Close crossing VWAP in either direction.",
    );
    expect(within(usage).getByTestId("section-usage-side")).toHaveTextContent("Long");
    expect(within(usage).getByTestId("section-usage-requires")).toHaveTextContent(/TV-only/);
    expect(within(usage).getByTestId("section-usage-fields")).toHaveTextContent(
      "close, symbol, change, VWAP",
    );
    expect(within(usage).getByTestId("section-usage-used-in")).toHaveTextContent(
      "Screener Sections",
    );
    expect(within(usage).getByTestId("section-usage-used-in")).not.toHaveTextContent(
      "Home window",
    );
    expect(within(usage).getByTestId("section-usage-rule")).toHaveTextContent(
      "close crosses above VWAP",
    );
  });

  test("pinning adds the Home window to the usage panel", () => {
    open();
    fireEvent.click(screen.getByTestId("section-pin"));

    expect(
      within(screen.getByTestId("section-usage")).getByTestId("section-usage-used-in"),
    ).toHaveTextContent(/Screener Sections.*Home window/);
  });

  test("bar-history concepts are labelled as bars", () => {
    open();
    fireEvent.click(screen.getByTestId("section-new"));
    selectByTestId("section-concept", "orb_proxy");

    expect(
      within(screen.getByTestId("section-usage")).getByTestId("section-usage-requires"),
    ).toHaveTextContent(/bars/i);
    expect(screen.getByTestId("condition-concept-reference-0")).toHaveTextContent("open");
  });

  test("the rule line reads numeric and field values without inventing numbers", () => {
    open();
    fireEvent.click(screen.getByTestId("section-item-momentum-5m"));
    const rule = () =>
      within(screen.getByTestId("section-usage")).getByTestId("section-usage-rule");

    expect(rule()).toHaveTextContent("change|5 > 1");

    selectByTestId("condition-value-source-0", "field");
    selectByTestId("condition-value-field-0", "relative_volume_10d_calc");
    expect(rule()).toHaveTextContent("change|5 > relative_volume_10d_calc");
  });

  test("a section with no conditions says so instead of inventing a rule", () => {
    open();
    fireEvent.click(screen.getByTestId("condition-remove-0"));

    expect(
      within(screen.getByTestId("section-usage")).getByTestId("section-usage-rule"),
    ).toHaveTextContent(/no conditions configured/i);
  });
});
