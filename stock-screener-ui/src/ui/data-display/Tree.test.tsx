// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Tree } from "./Tree";
import type { UITreeNode } from "../types";

const data: UITreeNode[] = [
  { value: "root", label: "Root", children: [{ value: "child", label: "Child" }] },
];

const nested: UITreeNode[] = [
  {
    value: "a",
    label: "Alpha",
    children: [
      { value: "a1", label: "Alpha One" },
      { value: "a2", label: "Alpha Two", children: [{ value: "a21", label: "Alpha Two Deep" }] },
    ],
  },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

const item = (label: string) => screen.getByText(label).closest('[role="treeitem"]') as HTMLElement;

describe("Tree", () => {
  test("a changed renderNode prop is picked up by already-mounted nodes", () => {
    const renderA = (p: { node: UITreeNode }) => <span>A:{p.node.label}</span>;
    const renderB = (p: { node: UITreeNode }) => <span>B:{p.node.label}</span>;
    const [custom, setCustom] = createSignal(renderA);

    render(() => <Tree data={data} expanded={["root"]} renderNode={custom()} />);

    expect(screen.getByText("A:Root")).toBeInTheDocument();
    expect(screen.getByText("A:Child")).toBeInTheDocument();

    setCustom(() => renderB);

    expect(screen.getByText("B:Root")).toBeInTheDocument();
    expect(screen.queryByText("A:Root")).not.toBeInTheDocument();
  });

  test("expanding a node reveals its children", () => {
    render(() => <Tree data={data} />);

    expect(screen.queryByText("Child")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Root"));
    expect(screen.getByText("Child")).toBeInTheDocument();
  });
});

describe("Tree — roles and ARIA state", () => {
  test("renders a tree of treeitems with groups, levels and expansion state", () => {
    render(() => <Tree data={nested} expanded={["a"]} />);

    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getAllByRole("group")).toHaveLength(1);
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    expect(item("Alpha")).toHaveAttribute("aria-level", "1");
    expect(item("Alpha One")).toHaveAttribute("aria-level", "2");
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "true");
    expect(item("Alpha Two")).toHaveAttribute("aria-expanded", "false");
    expect(item("Alpha One")).not.toHaveAttribute("aria-expanded");
    expect(item("Beta")).not.toHaveAttribute("aria-expanded");
  });

  test("selection is exposed on the activated treeitem only", () => {
    render(() => <Tree data={nested} expanded={["a"]} />);

    expect(item("Alpha")).toHaveAttribute("aria-selected", "false");
    fireEvent.click(item("Alpha One"));
    expect(item("Alpha One")).toHaveAttribute("aria-selected", "true");
    expect(item("Alpha")).toHaveAttribute("aria-selected", "false");
    expect(item("Gamma")).toHaveAttribute("aria-selected", "false");
  });

  test("the chevron is decorative, never a hidden focus stop", () => {
    render(() => <Tree data={nested} />);

    expect(item("Alpha").querySelector("button")).toBeNull();
    expect(item("Alpha").querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  test("a click on a descendant does not toggle an ancestor", () => {
    render(() => <Tree data={nested} expanded={["a"]} />);

    fireEvent.click(item("Alpha One"));

    expect(item("Alpha")).toHaveAttribute("aria-expanded", "true");
  });

  test("controlled expansion is not mutated by interaction", () => {
    const onExpandedChange = vi.fn();
    render(() => <Tree data={nested} expanded={[]} onExpandedChange={onExpandedChange} />);

    fireEvent.click(item("Alpha"));

    expect(onExpandedChange).toHaveBeenCalledWith(["a"]);
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Tree — roving tabindex and keyboard navigation", () => {
  const flat: UITreeNode[] = [
    { value: "x", label: "X" },
    { value: "y", label: "Y" },
    { value: "z", label: "Z" },
  ];

  test("only the focused treeitem is in the tab order", () => {
    render(() => <Tree data={flat} />);
    const [first, second, third] = screen.getAllByRole("treeitem");

    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    expect(third).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(first, { key: "ArrowDown" });

    expect(document.activeElement).toBe(second);
    expect(first).toHaveAttribute("tabindex", "-1");
    expect(second).toHaveAttribute("tabindex", "0");
  });

  test("ArrowDown/ArrowUp clamp at the ends of the visible list", () => {
    render(() => <Tree data={flat} />);
    const [first, , last] = screen.getAllByRole("treeitem");

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(document.activeElement).toBe(last);
  });

  test("Home and End jump to the first and last visible treeitem", () => {
    render(() => <Tree data={nested} expanded={["a"]} />);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "End" });
    expect(document.activeElement).toBe(item("Gamma"));

    fireEvent.keyDown(item("Gamma"), { key: "Home" });
    expect(document.activeElement).toBe(item("Alpha"));
  });

  test("ArrowRight expands then enters a branch; ArrowLeft exits then collapses", () => {
    render(() => <Tree data={nested} />);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Alpha One"));

    fireEvent.keyDown(item("Alpha One"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Alpha"));

    fireEvent.keyDown(item("Alpha"), { key: "ArrowLeft" });
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "false");
  });

  test("Enter and Space activate the focused treeitem", () => {
    const onNodeClick = vi.fn();
    render(() => <Tree data={nested} onNodeClick={onNodeClick} />);

    item("Alpha").focus();
    fireEvent.keyDown(item("Alpha"), { key: "Enter" });
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "true");
    expect(item("Alpha")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(item("Alpha"), { key: " " });
    expect(onNodeClick).toHaveBeenCalledTimes(2);
    expect(item("Alpha")).toHaveAttribute("aria-expanded", "false");
  });
});
