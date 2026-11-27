// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { Flex } from "./Flex";

describe("Flex", () => {
  test("lays children out in a row with flexbox and honours alignment and gap", () => {
    render(() => (
      <Flex
        data-testid="flex"
        direction="column"
        align="center"
        justify="space-between"
        wrap="wrap"
        gap="md"
      >
        <span data-testid="first">one</span>
        <span data-testid="second">two</span>
      </Flex>
    ));

    const flex = screen.getByTestId("flex");
    expect(flex).toHaveStyle("display: flex");
    expect(flex.style.flexDirection).toBe("column");
    expect(flex.style.alignItems).toBe("center");
    expect(flex.style.justifyContent).toBe("space-between");
    expect(flex.style.flexWrap).toBe("wrap");
    expect(flex.style.gap).toBe("16px");
    expect(flex).toContainElement(screen.getByTestId("first"));
    expect(flex).toContainElement(screen.getByTestId("second"));
  });

  test("explicit CSS aliases take precedence over the short aliases", () => {
    render(() => (
      <Flex
        data-testid="flex"
        direction="column"
        flexDirection="row"
        justify="center"
        justifyContent="flex-end"
        align="stretch"
        alignItems="baseline"
        spacing={4}
        gap="xs"
      />
    ));

    const flex = screen.getByTestId("flex");
    expect(flex.style.flexDirection).toBe("row");
    expect(flex.style.justifyContent).toBe("flex-end");
    expect(flex.style.alignItems).toBe("baseline");
    expect(flex.style.gap).toBe("4px");
  });

  test("spacing without gap is an 8pt step and padding props still apply", () => {
    render(() => <Flex data-testid="flex" spacing={2} px="sm" py={6} />);

    const flex = screen.getByTestId("flex");
    expect(flex.style.gap).toBe("16px");
    expect(flex.style.paddingLeft).toBe("8px");
    expect(flex.style.paddingRight).toBe("8px");
    expect(flex.style.paddingTop).toBe("6px");
    expect(flex.style.paddingBottom).toBe("6px");
  });

  test("component selects a semantic element and forwards identity, style and events", () => {
    const onMouseEnter = vi.fn();
    render(() => (
      <Flex
        component="ul"
        data-testid="list"
        className="my-flex"
        style={{ "background-color": "red" }}
        role="list"
        onMouseEnter={onMouseEnter}
      >
        <li>item</li>
      </Flex>
    ));

    const list = screen.getByTestId("list");
    expect(list.tagName).toBe("UL");
    expect(list).toHaveClass("my-flex");
    expect(list).toHaveStyle("background-color: red");
    expect(list).toHaveAttribute("role", "list");
    expect(list.querySelector("li")).toHaveTextContent("item");
    fireEvent.mouseEnter(list);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });
});
