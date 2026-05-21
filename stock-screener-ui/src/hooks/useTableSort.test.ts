// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableSort } from "./useTableSort";

interface TestItem {
  name: string;
  value: number;
}

describe("useTableSort", () => {
  test("default state: sortColumn is null, sortDirection is desc", () => {
    const { result } = renderHook(() => useTableSort());
    expect(result.current.sortColumn).toBeNull();
    expect(result.current.sortDirection).toBe("desc");
  });

  test("handleSort sets sortColumn to given column with default direction", () => {
    const { result } = renderHook(() => useTableSort());
    act(() => {
      result.current.handleSort("name");
    });
    expect(result.current.sortColumn).toBe("name");
    expect(result.current.sortDirection).toBe("desc");
  });

  test("clicking same column toggles direction: desc -> asc -> desc", () => {
    const { result } = renderHook(() => useTableSort());
    act(() => {
      result.current.handleSort("name");
    });
    expect(result.current.sortDirection).toBe("desc");

    act(() => {
      result.current.handleSort("name");
    });
    expect(result.current.sortDirection).toBe("asc");

    act(() => {
      result.current.handleSort("name");
    });
    expect(result.current.sortDirection).toBe("desc");
  });

  test("clicking different column sets new column with default direction", () => {
    const { result } = renderHook(() => useTableSort());
    act(() => {
      result.current.handleSort("name");
    });
    expect(result.current.sortColumn).toBe("name");
    expect(result.current.sortDirection).toBe("desc");

    act(() => {
      result.current.handleSort("value");
    });
    expect(result.current.sortColumn).toBe("value");
    expect(result.current.sortDirection).toBe("desc");
  });

  test("getSortedData sorts strings alphabetically ascending", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({ initialColumn: "name", initialDirection: "asc" }),
    );
    const data: TestItem[] = [
      { name: "Charlie", value: 3 },
      { name: "Alice", value: 1 },
      { name: "Bob", value: 2 },
    ];
    const sorted = result.current.getSortedData(data, (item) => item.name);
    expect(sorted.map((i) => i.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  test("getSortedData sorts strings alphabetically descending", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({ initialColumn: "name", initialDirection: "desc" }),
    );
    const data: TestItem[] = [
      { name: "Alice", value: 1 },
      { name: "Charlie", value: 3 },
      { name: "Bob", value: 2 },
    ];
    const sorted = result.current.getSortedData(data, (item) => item.name);
    expect(sorted.map((i) => i.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  test("getSortedData sorts numbers numerically ascending", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({ initialColumn: "value", initialDirection: "asc" }),
    );
    const data: TestItem[] = [
      { name: "a", value: 30 },
      { name: "b", value: 10 },
      { name: "c", value: 20 },
    ];
    const sorted = result.current.getSortedData(data, (item) => item.value);
    expect(sorted.map((i) => i.value)).toEqual([10, 20, 30]);
  });

  test("getSortedData sorts numbers numerically descending", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({ initialColumn: "value", initialDirection: "desc" }),
    );
    const data: TestItem[] = [
      { name: "a", value: 10 },
      { name: "b", value: 30 },
      { name: "c", value: 20 },
    ];
    const sorted = result.current.getSortedData(data, (item) => item.value);
    expect(sorted.map((i) => i.value)).toEqual([30, 20, 10]);
  });

  test("getSortedData returns original order when sortColumn is null", () => {
    const { result } = renderHook(() => useTableSort<TestItem>());
    const data: TestItem[] = [
      { name: "Charlie", value: 3 },
      { name: "Alice", value: 1 },
      { name: "Bob", value: 2 },
    ];
    const sorted = result.current.getSortedData(data, (item) => item.name);
    expect(sorted).toEqual(data);
  });

  test("getSortedData does not mutate original array", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({ initialColumn: "value", initialDirection: "asc" }),
    );
    const data: TestItem[] = [
      { name: "a", value: 30 },
      { name: "b", value: 10 },
      { name: "c", value: 20 },
    ];
    const originalOrder = [...data];
    result.current.getSortedData(data, (item) => item.value);
    expect(data).toEqual(originalOrder);
  });

  test("initialColumn and initialDirection options work", () => {
    const { result } = renderHook(() =>
      useTableSort({ initialColumn: "price", initialDirection: "asc" }),
    );
    expect(result.current.sortColumn).toBe("price");
    expect(result.current.sortDirection).toBe("asc");
  });

  test("defaultDirection option differs from initialDirection", () => {
    const { result } = renderHook(() =>
      useTableSort<TestItem>({
        initialColumn: "name",
        initialDirection: "asc",
        defaultDirection: "desc",
      }),
    );
    expect(result.current.sortDirection).toBe("asc");

    act(() => {
      result.current.handleSort("value");
    });
    expect(result.current.sortColumn).toBe("value");
    expect(result.current.sortDirection).toBe("desc");
  });
});
