// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, test, vi } from "vitest";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  test("exposes tablist/tab/tabpanel roles and selects the default tab", () => {
    render(() => (
      <Tabs defaultValue="a" data-testid="tabs">
        <Tabs.List data-testid="list" aria-label="Sections">
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a" data-testid="panel-a">Panel A</Tabs.Panel>
        <Tabs.Panel value="b" data-testid="panel-b">Panel B</Tabs.Panel>
      </Tabs>
    ));

    const list = screen.getByTestId("list");
    expect(list).toHaveAttribute("role", "tablist");
    expect(list).toHaveAttribute("aria-label", "Sections");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Alpha", "Beta"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("panel-a")).toHaveAttribute("role", "tabpanel");
    expect(screen.getByTestId("panel-a")).not.toHaveProperty("hidden", true);
    expect(screen.queryByTestId("panel-b")).toBeNull();
  });

  test("clicking a tab selects it in the uncontrolled branch and reports its value", () => {
    const onChange = vi.fn();
    render(() => (
      <Tabs defaultValue="a" onChange={onChange}>
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    ));

    const beta = screen.getByRole("tab", { name: "Beta" });
    fireEvent.click(beta);

    expect(onChange).toHaveBeenCalledWith("b");
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
  });

  test("a controlled tab does not change selection until the value prop changes", () => {
    const [value, setValue] = createSignal<string | null>("a");
    const onChange = vi.fn();
    render(() => (
      <Tabs value={value()} onChange={onChange}>
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    ));

    const beta = screen.getByRole("tab", { name: "Beta" });
    fireEvent.click(beta);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(beta).toHaveAttribute("aria-selected", "false");

    setValue("b");
    expect(beta).toHaveAttribute("aria-selected", "true");
  });

  test("arrow, Home and End keys activate the newly focused enabled tab", () => {
    const onChange = vi.fn();
    render(() => (
      <Tabs defaultValue="a" onChange={onChange}>
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="locked" disabled>Locked</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a" data-testid="panel-a">Panel A</Tabs.Panel>
        <Tabs.Panel value="b" data-testid="panel-b">Panel B</Tabs.Panel>
      </Tabs>
    ));

    const [alpha, locked, beta] = screen.getAllByRole("tab");
    expect(locked).toBeDisabled();
    alpha.focus();

    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(document.activeElement).toBe(beta);
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("panel-a")).toBeNull();
    expect(screen.getByTestId("panel-b")).toBeInTheDocument();

    fireEvent.keyDown(beta, { key: "ArrowRight" });
    expect(document.activeElement).toBe(alpha);
    expect(alpha).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(alpha, { key: "End" });
    expect(document.activeElement).toBe(beta);
    expect(beta).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(beta, { key: "Home" });
    expect(document.activeElement).toBe(alpha);
    expect(alpha).toHaveAttribute("aria-selected", "true");

    expect(locked).toHaveAttribute("aria-selected", "false");
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["b", "a", "b", "a"]);
  });

  test("keyboard activation reports the value but keeps a controlled tab unchanged until value updates", () => {
    const [value, setValue] = createSignal<string | null>("a");
    const onChange = vi.fn();
    render(() => (
      <Tabs value={value()} onChange={onChange}>
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    ));

    const [alpha, beta] = screen.getAllByRole("tab");
    alpha.focus();

    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(document.activeElement).toBe(beta);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(alpha).toHaveAttribute("aria-selected", "true");
    expect(beta).toHaveAttribute("aria-selected", "false");

    setValue("b");
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(alpha).toHaveAttribute("aria-selected", "false");
  });

  test("vertical orientation keeps the same arrow activation behaviour", () => {
    const onChange = vi.fn();
    render(() => (
      <Tabs defaultValue="a" orientation="vertical" onChange={onChange}>
        <Tabs.List orientation="vertical" data-testid="list">
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    ));

    expect(screen.getByTestId("list")).toHaveAttribute("aria-orientation", "vertical");
    const [alpha, beta] = screen.getAllByRole("tab");
    alpha.focus();

    fireEvent.keyDown(alpha, { key: "ArrowRight" });
    expect(document.activeElement).toBe(beta);
    expect(beta).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("a disabled tab cannot be selected by click", () => {
    const onChange = vi.fn();
    render(() => (
      <Tabs defaultValue="a" onChange={onChange}>
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="locked" disabled>Locked</Tabs.Tab>
        </Tabs.List>
      </Tabs>
    ));

    fireEvent.click(screen.getByRole("tab", { name: "Locked" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
  });

  test("keepMounted panels stay in the DOM but are hidden when inactive", () => {
    render(() => (
      <Tabs defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">Alpha</Tabs.Tab>
          <Tabs.Tab value="b">Beta</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="b" keepMounted data-testid="panel-b">Panel B</Tabs.Panel>
      </Tabs>
    ));

    const panel = screen.getByTestId("panel-b");
    expect(panel).toHaveTextContent("Panel B");
    expect(panel).toHaveProperty("hidden", true);
  });
});
