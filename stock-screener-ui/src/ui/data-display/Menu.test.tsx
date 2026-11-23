// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Menu } from "./Menu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Menu.Label / Menu.Divider", () => {
  test("label children follow a signal", () => {
    const [label, setLabel] = createSignal("Alpha");

    render(() => <Menu.Label data-testid="menu-label">{label()}</Menu.Label>);

    expect(screen.getByTestId("menu-label").textContent).toBe("Alpha");
    setLabel("Beta");
    expect(screen.getByTestId("menu-label").textContent).toBe("Beta");
  });

  test("divider className follows a signal", () => {
    const [extra, setExtra] = createSignal("first");

    render(() => <Menu.Divider className={extra()} />);

    const divider = screen.getByRole("separator");
    expect(divider.className).toContain("first");
    setExtra("second");
    expect(divider.className).toContain("second");
    expect(divider.className).not.toContain("first");
  });
});

function OpenableMenu(props: { closeOnClickOutside?: boolean; onPick?: () => void }) {
  const [opened, setOpened] = createSignal(false);
  return (
    <Menu opened={opened()} onChange={setOpened} closeOnClickOutside={props.closeOnClickOutside}>
      <Menu.Target>
        <button type="button" data-testid="menu-trigger">
          Open
        </button>
      </Menu.Target>
      <Menu.Dropdown data-testid="menu-dropdown">
        <Menu.Item data-testid="menu-item" onClick={props.onPick}>
          Action
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Dismiss was gated on `closeOnClickOutside` (no caller passes it) and the
 * dropdown registered itself into a discarded local setter, so an open menu
 * could only be closed by clicking its target again.
 */
describe("Menu — outside dismiss", () => {
  test("closes when the pointer goes down outside target and dropdown", () => {
    render(() => <OpenableMenu />);
    fireEvent.click(screen.getByTestId("menu-trigger"));
    expect(screen.getByTestId("menu-dropdown")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId("menu-dropdown")).toBeNull();
  });

  test("stays open for a mousedown inside the dropdown", () => {
    render(() => <OpenableMenu />);
    fireEvent.click(screen.getByTestId("menu-trigger"));
    const item = screen.getByTestId("menu-item");

    fireEvent.mouseDown(item);

    expect(screen.getByTestId("menu-dropdown")).toBeInTheDocument();
  });

  test("stays open for a mousedown on the target", () => {
    render(() => <OpenableMenu />);
    const trigger = screen.getByTestId("menu-trigger");
    fireEvent.click(trigger);

    fireEvent.mouseDown(trigger);

    expect(screen.getByTestId("menu-dropdown")).toBeInTheDocument();
  });

  test("an explicit closeOnClickOutside={false} opts out", () => {
    render(() => <OpenableMenu closeOnClickOutside={false} />);
    fireEvent.click(screen.getByTestId("menu-trigger"));

    fireEvent.mouseDown(document.body);

    expect(screen.getByTestId("menu-dropdown")).toBeInTheDocument();
  });

  test("Escape still closes", () => {
    render(() => <OpenableMenu />);
    fireEvent.click(screen.getByTestId("menu-trigger"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("menu-dropdown")).toBeNull();
  });
});

/**
 * `Menu`'s children expression used to read the `children` props getter twice
 * (`typeof children === "function" ? children(...) : children`). Each read
 * builds a fresh subtree, so two `MenuDropdown`s mounted per open; the one that
 * was never inserted registered itself into the dropdown ref last, and the
 * outside-click handler then saw `dropdown.contains(target) === false` for a
 * genuine click inside the live menu. `dispatchEvent` hides this — the menu is
 * already gone by the time a bare `click` fires — so the sequence below is the
 * only honest reproduction: mousedown, mouseup, then click.
 */
describe("Menu — the live dropdown is the registered dropdown", () => {
  const clickSequence = (el: HTMLElement) => {
    fireEvent.mouseDown(el);
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  };

  test("a real click sequence inside the dropdown selects the item", () => {
    const onPick = vi.fn();
    render(() => <OpenableMenu onPick={onPick} />);
    fireEvent.click(screen.getByTestId("menu-trigger"));

    clickSequence(screen.getByTestId("menu-item"));

    expect(onPick).toHaveBeenCalledTimes(1);
  });

  test("stays open across a close/reopen cycle, then selects", () => {
    const onPick = vi.fn();
    render(() => <OpenableMenu onPick={onPick} />);
    const trigger = screen.getByTestId("menu-trigger");

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("menu-dropdown")).toBeNull();

    fireEvent.click(trigger);
    const item = screen.getByTestId("menu-item");
    expect(screen.getByTestId("menu-dropdown")).toContainElement(item);

    clickSequence(item);

    // The item click closes by default, so both facts matter: it fired, and the
    // menu was still open when the click landed.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("menu-dropdown")).toBeNull();
  });

  test("only one dropdown subtree is built per open", () => {
    const built: HTMLElement[] = [];
    const [opened, setOpened] = createSignal(false);
    render(() => (
      <Menu opened={opened()} onChange={setOpened}>
        <Menu.Target>
          <button type="button" data-testid="menu-trigger">
            Open
          </button>
        </Menu.Target>
        <Menu.Dropdown data-testid="menu-dropdown">
          {/* `ref` fires on construction, so this counts every subtree built —
              including the detached duplicate the old double read created. */}
          <span ref={(el) => built.push(el)} data-testid="menu-item">
            Action
          </span>
        </Menu.Dropdown>
      </Menu>
    ));

    fireEvent.click(screen.getByTestId("menu-trigger"));
    expect(built).toHaveLength(1);

    // Reopening legitimately rebuilds the DOM (Show disposes it), but exactly
    // once — the duplicate subtree used to double every open.
    fireEvent.click(screen.getByTestId("menu-trigger"));
    fireEvent.click(screen.getByTestId("menu-trigger"));

    expect(built).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="menu-dropdown"]')).toHaveLength(1);
  });
});

/**
 * The old dropdown opened downward unconditionally and never clamped: in the
 * options dock a bottom-row trigger at 1280×720 put all 12 items below the
 * viewport. These assert the measurable outcome (top / left / max-height), not
 * that a helper was called.
 */
describe("Menu — viewport placement", () => {
  const VIEWPORT = { width: 1280, height: 720 };
  const rect = (top: number, left: number, width: number, height: number): DOMRect =>
    ({
      top,
      bottom: top + height,
      left,
      right: left + width,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  /** Opens the menu with `anchor` and a fixed natural menu size, then reads the placement. */
  const openAt = async (
    anchor: DOMRect,
    menu: { width: number; height: number },
    menuProps: { offset?: number; position?: "right-start" } = {},
  ) => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(VIEWPORT.width);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(VIEWPORT.height);

    function Controlled() {
      const [opened, setOpened] = createSignal(false);
      return (
        <Menu
          opened={opened()}
          onChange={setOpened}
          offset={menuProps.offset}
          // `right-start` is used by the rail's account menu but missing from
          // the shared prop union.
          position={menuProps.position as "right" | undefined}
        >
          <Menu.Target data-testid="menu-anchor">
            <button type="button" data-testid="menu-trigger">
              Open
            </button>
          </Menu.Target>
          <Menu.Dropdown data-testid="menu-dropdown">
            <Menu.Item data-testid="menu-item">Action</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      );
    }
    render(() => <Controlled />);

    // The target span is what `Menu.Target` records as the anchor.
    vi.spyOn(screen.getByTestId("menu-anchor"), "getBoundingClientRect").mockReturnValue(anchor);
    fireEvent.click(screen.getByTestId("menu-trigger"));

    const dropdown = screen.getByTestId("menu-dropdown");
    // happy-dom performs no layout, so the natural size is supplied here — the
    // same measurement a browser would report.
    vi.spyOn(dropdown, "getBoundingClientRect").mockReturnValue(rect(0, 0, menu.width, menu.height));
    // The resize handler re-measures with the mocked size, exactly as a browser
    // would after layout.
    fireEvent(window, new Event("resize"));
    await Promise.resolve();

    return dropdown;
  };

  test("flips above the target when there is no room below", async () => {
    // 30px trigger whose bottom sits 40px above the viewport floor.
    const dropdown = await openAt(rect(650, 40, 120, 30), { width: 220, height: 400 });

    const top = Number.parseFloat(dropdown.style.top);
    const maxHeight = Number.parseFloat(dropdown.style.maxHeight);

    expect(top).toBeLessThan(650);
    expect(maxHeight).toBe(400);
    // Whole box inside the viewport, above the trigger, never past the top edge.
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxHeight).toBeLessThanOrEqual(650);
  });

  test("shrinks max-height to the room above when the menu is taller than it", async () => {
    // 600px menu, 492px above and 182px below: it flips up and must be capped
    // at the 492px it can actually occupy, not left 600px tall and pushed off
    // the top edge.
    const dropdown = await openAt(rect(500, 40, 120, 30), { width: 220, height: 600 });

    const top = Number.parseFloat(dropdown.style.top);
    const maxHeight = Number.parseFloat(dropdown.style.maxHeight);

    expect(maxHeight).toBeLessThan(600);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxHeight).toBeLessThanOrEqual(500);
  });

  test("clamps to the right edge gutter", async () => {
    // Trigger flush against the right edge; a start-aligned 300px menu would
    // otherwise end at x=1272 and overflow by 292px.
    const dropdown = await openAt(rect(100, 1200, 60, 30), { width: 300, height: 200 });

    const left = Number.parseFloat(dropdown.style.left);
    const right = left + 300;

    expect(left).toBeGreaterThanOrEqual(8);
    expect(right).toBeLessThanOrEqual(VIEWPORT.width - 8);
  });

  test("opens below when there is room, with the configured offset", async () => {
    const dropdown = await openAt(rect(100, 400, 120, 30), { width: 220, height: 200 }, { offset: 8 });

    const top = Number.parseFloat(dropdown.style.top);

    expect(top).toBe(138);
    expect(Number.parseFloat(dropdown.style.maxHeight)).toBe(200);
    expect(dropdown.style.visibility).toBe("visible");
  });

  test("side-anchored menus stay on their side and inside the vertical gutter", async () => {
    // `position="right-start"` is the rail's account menu: it must not be
    // flipped horizontally over its trigger, and its bottom edge must stay in.
    const dropdown = await openAt(
      rect(700, 20, 120, 30),
      { width: 220, height: 200 },
      { position: "right-start", offset: 8 },
    );

    const top = Number.parseFloat(dropdown.style.top);
    const left = Number.parseFloat(dropdown.style.left);
    const maxHeight = Number.parseFloat(dropdown.style.maxHeight);

    expect(left).toBe(148);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + maxHeight).toBeLessThanOrEqual(VIEWPORT.height - 8);
  });

  test("repositions when the page scrolls under an open menu", async () => {
    const dropdown = await openAt(rect(100, 400, 120, 30), { width: 220, height: 200 });
    const before = Number.parseFloat(dropdown.style.top);

    vi.spyOn(screen.getByTestId("menu-anchor"), "getBoundingClientRect").mockReturnValue(rect(40, 400, 120, 30));
    fireEvent(window, new Event("scroll"));

    expect(Number.parseFloat(dropdown.style.top)).toBeLessThan(before);
  });
});

function KeyMenu(props: { loop?: boolean; onPick?: (label: string) => void }) {
  return (
    <Menu loop={props.loop}>
      <Menu.Target>
        <button type="button" data-testid="trigger">
          Open
        </button>
      </Menu.Target>
      <Menu.Dropdown data-testid="dropdown">
        <Menu.Item data-testid="item-one" onClick={() => props.onPick?.("one")}>
          One
        </Menu.Item>
        <Menu.Item data-testid="item-two" disabled>
          Two
        </Menu.Item>
        <Menu.Item data-testid="item-three" onClick={() => props.onPick?.("three")}>
          Three
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

const openKeyMenu = (props: { loop?: boolean; onPick?: (label: string) => void } = {}) => {
  render(() => <KeyMenu loop={props.loop} onPick={props.onPick} />);
  fireEvent.click(screen.getByTestId("trigger"));
  return screen.getAllByRole("menuitem");
};

describe("Menu — keyboard navigation", () => {
  test("opens with a single tab stop on the first enabled item", () => {
    const items = openKeyMenu();

    expect(screen.getByRole("menu")).toBe(screen.getByTestId("dropdown"));
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);
    expect(items[0]).toHaveAttribute("tabindex", "0");
    expect(items[2]).toHaveAttribute("tabindex", "-1");
  });

  test("ArrowDown skips disabled items; ArrowUp wraps by default", () => {
    const items = openKeyMenu();

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(items[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
  });

  test("loop={false} clamps at both ends", () => {
    const items = openKeyMenu({ loop: false });

    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[0]);

    items[2].focus();
    fireEvent.keyDown(items[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]);
  });

  test("Home and End jump to the first and last enabled items", () => {
    const items = openKeyMenu();

    fireEvent.keyDown(items[0], { key: "End" });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(items[2], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  test("Enter and Space each activate once and dismiss the menu", () => {
    const onPick = vi.fn();
    const items = openKeyMenu({ onPick });

    fireEvent.keyDown(items[0], { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("one");
    expect(screen.queryByTestId("dropdown")).toBeNull();

    fireEvent.click(screen.getByTestId("trigger"));
    const reopened = screen.getAllByRole("menuitem");
    fireEvent.keyDown(reopened[0], { key: " " });
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith("one");
    expect(screen.queryByTestId("dropdown")).toBeNull();
  });

  test("hover opening and Escape dismissal still work", () => {
    render(() => (
      <Menu trigger="click-hover">
        <Menu.Target data-testid="hover-target">
          <button type="button">Hover</button>
        </Menu.Target>
        <Menu.Dropdown data-testid="hover-dropdown">
          <Menu.Item>Only</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    ));

    fireEvent.mouseEnter(screen.getByTestId("hover-target"));
    expect(screen.getByTestId("hover-dropdown")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("hover-dropdown")).toBeNull();
  });
});
