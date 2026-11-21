// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";
import { Tree } from "./Tree";
import type { UITreeNode } from "../types";

const data: UITreeNode[] = [
  { value: "root", label: "Root", children: [{ value: "child", label: "Child" }] },
];

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
