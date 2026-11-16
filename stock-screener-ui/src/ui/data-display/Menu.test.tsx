// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { cleanup } from "@solidjs/testing-library";
import { Menu } from "./Menu";

afterEach(cleanup);

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

function OpenableMenu(props: { closeOnClickOutside?: boolean }) {
  const [opened, setOpened] = createSignal(false);
  return (
    <Menu opened={opened()} onChange={setOpened} closeOnClickOutside={props.closeOnClickOutside}>
      <Menu.Target>
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
