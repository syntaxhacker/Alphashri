// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { PatternTags, fullDate, hasTag, rowTags, shortIstDate } from "./rowBadges";


describe("rowTags / hasTag", () => {
  afterEach(() => cleanup());

  test("rowTags returns the tags array when present", () => {
    expect(rowTags({ tags: ["F&O", "ETF"] })).toEqual(["F&O", "ETF"]);
  });

  test("rowTags tolerates missing, null and malformed tags", () => {
    expect(rowTags({})).toEqual([]);
    expect(rowTags(null)).toEqual([]);
    expect(rowTags(undefined)).toEqual([]);
    expect(rowTags({ tags: null })).toEqual([]);
    expect(rowTags({ tags: "F&O" })).toEqual([]);
    expect(rowTags({ tags: 42 })).toEqual([]);
  });

  test("rowTags drops non-string entries", () => {
    expect(rowTags({ tags: ["F&O", 7, null, "ETF", undefined] })).toEqual(["F&O", "ETF"]);
  });

  test("hasTag reports membership and never throws", () => {
    const row = { tags: ["F&O"] };
    expect(hasTag(row, "F&O")).toBe(true);
    expect(hasTag(row, "ETF")).toBe(false);
    expect(hasTag({}, "F&O")).toBe(false);
    expect(hasTag(null, "F&O")).toBe(false);
    expect(hasTag({ tags: ["ETF"] }, "F&O")).toBe(false);
  });
});

describe("shortIstDate", () => {
  test("formats date-only ISO strings as `D Mon`", () => {
    expect(shortIstDate("2026-11-05")).toBe("5 Nov");
    expect(shortIstDate("2026-01-01")).toBe("1 Jan");
    expect(shortIstDate("2026-12-31")).toBe("31 Dec");
  });

  test("returns null for missing or unparseable input", () => {
    expect(shortIstDate(null)).toBeNull();
    expect(shortIstDate(undefined)).toBeNull();
    expect(shortIstDate("")).toBeNull();
    expect(shortIstDate("not-a-date")).toBeNull();
    expect(shortIstDate("2026-11-05T10:30:00+05:30")).toBeNull();
    expect(shortIstDate("2026-13-05")).toBeNull();
    expect(shortIstDate("2026-00-05")).toBeNull();
    expect(shortIstDate("2026-11-00")).toBeNull();
    expect(shortIstDate("2026-11-32")).toBeNull();
  });
});

describe("fullDate", () => {
  test("formats a date-only ISO string for tooltips", () => {
    expect(fullDate("2026-11-05")).toBe("05 Nov 2026");
  });

  test("returns null for missing input and passes unparseable input through", () => {
    expect(fullDate(null)).toBeNull();
    expect(fullDate(undefined)).toBeNull();
    expect(fullDate("not-a-date")).toBe("not-a-date");
  });
});

describe("PatternTags", () => {
  afterEach(() => cleanup());

  test("renders the F&O badge only when tagged F&O", () => {
    render(() => <PatternTags tags={["F&O"]} symbol="RELIANCE" testIdPrefix="watch" compact />);
    expect(screen.getByTestId("watch-tag-fno-RELIANCE")).toHaveTextContent("F&O");
    expect(screen.queryByTestId("watch-tag-etf-RELIANCE")).not.toBeInTheDocument();
  });

  test("renders the ETF badge only when tagged ETF", () => {
    render(() => <PatternTags tags={["ETF"]} symbol="NIFTYBEES" testIdPrefix="watch" compact />);
    expect(screen.getByTestId("watch-tag-etf-NIFTYBEES")).toHaveTextContent("ETF");
    expect(screen.queryByTestId("watch-tag-fno-NIFTYBEES")).not.toBeInTheDocument();
  });

  test("renders both badges when tagged F&O and ETF", () => {
    render(() => <PatternTags tags={["F&O", "ETF"]} symbol="BOTH" testIdPrefix="watch" compact />);
    expect(screen.getByTestId("watch-tag-fno-BOTH")).toHaveTextContent("F&O");
    expect(screen.getByTestId("watch-tag-etf-BOTH")).toHaveTextContent("ETF");
  });

  test("renders nothing when tagged neither or tags are missing", () => {
    const { container } = render(() => <PatternTags tags={["OTHER"]} symbol="PLAIN" testIdPrefix="watch" compact />);
    expect(screen.queryByTestId("watch-tag-fno-PLAIN")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watch-tag-etf-PLAIN")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    render(() => <PatternTags tags={null} symbol="MISSING" testIdPrefix="watch" compact />);
    expect(screen.queryByTestId("watch-tag-fno-MISSING")).not.toBeInTheDocument();
    expect(screen.queryByTestId("watch-tag-etf-MISSING")).not.toBeInTheDocument();
  });

  test("honours the testid prefix (patterns-list namespace)", () => {
    render(() => <PatternTags tags={["F&O"]} symbol="IRCON" testIdPrefix="patterns-list" compact />);
    expect(screen.getByTestId("patterns-list-tag-fno-IRCON")).toHaveTextContent("F&O");
    expect(screen.queryByTestId("watch-tag-fno-IRCON")).not.toBeInTheDocument();
  });

  test("showEtf={false} suppresses the ETF badge while keeping F&O", () => {
    render(() =>       <PatternTags
        tags={["F&O", "ETF"]}
        symbol="AAA"
        testIdPrefix="patterns-list"
        showEtf={false}
        compact
      />);
    expect(screen.getByTestId("patterns-list-tag-fno-AAA")).toHaveTextContent("F&O");
    expect(screen.queryByTestId("patterns-list-tag-etf-AAA")).not.toBeInTheDocument();
  });

  test("updates when the tags prop changes", () => {
    const [tags, setTags] = createSignal<string[] | null>(null);
    render(() => <PatternTags tags={tags()} symbol="LIVE" testIdPrefix="watch" compact />);
    expect(screen.queryByTestId("watch-tag-fno-LIVE")).not.toBeInTheDocument();

    setTags(["F&O"]);
    expect(screen.getByTestId("watch-tag-fno-LIVE")).toHaveTextContent("F&O");

    setTags(["ETF"]);
    expect(screen.queryByTestId("watch-tag-fno-LIVE")).not.toBeInTheDocument();
    expect(screen.getByTestId("watch-tag-etf-LIVE")).toHaveTextContent("ETF");
  });
});
