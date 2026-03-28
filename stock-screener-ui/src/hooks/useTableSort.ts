import { useState, useCallback } from "react";

interface UseTableSortOptions {
  initialColumn?: string;
  initialDirection?: "asc" | "desc";
  defaultDirection?: "asc" | "desc";
}

interface UseTableSortReturn<T> {
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  handleSort: (column: string) => void;
  getSortedData: (data: T[], getColumnValue: (item: T) => string | number) => T[];
}

export function useTableSort<T>(options?: UseTableSortOptions): UseTableSortReturn<T> {
  const { initialColumn, initialDirection = "desc", defaultDirection = "desc" } = options || {};

  const [sortState, setSortState] = useState<{
    column: string | null;
    direction: "asc" | "desc";
  }>({
    column: initialColumn ?? null,
    direction: initialDirection,
  });

  const sortColumn = sortState.column;
  const sortDirection = sortState.direction;

  const handleSort = useCallback(
    (column: string) => {
      setSortState((prev) => {
        if (prev.column === column) {
          return { ...prev, direction: prev.direction === "asc" ? "desc" : "asc" };
        }
        return { column, direction: defaultDirection };
      });
    },
    [defaultDirection],
  );

  const getSortedData = useCallback(
    (data: T[], getColumnValue: (item: T) => string | number): T[] => {
      if (!sortState.column) return data;
      return [...data].sort((a, b) => {
        const aVal = getColumnValue(a);
        const bVal = getColumnValue(b);
        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortDirection === "asc"
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      });
    },
    [sortState.column, sortState.direction],
  );

  return { sortColumn, sortDirection, handleSort, getSortedData };
}
