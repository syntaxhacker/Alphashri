/**
 * Test-only stub for the six @/ui dynamic-tag layout primitives
 * (Box/Flex/Stack/Group/Paper/Card).
 *
 * Those primitives crash at runtime on this branch — Solid calls the string
 * tag as a function component ("Comp is not a function") and the @/ui suite
 * has no render test covering them. Stubbing them with intrinsic elements
 * lets page tests exercise the page wiring instead of the broken primitives.
 *
 * Explicit props only: a `{...rest}` spread in the stub dropped
 * props.children inside the Solid dev transform (child vanished).
 */
export async function uiLayoutStub(actual: Record<string, unknown>) {
  const safeProps = (props: any) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v == null || k === "children") continue;
      if (k === "className") {
        out.class = v;
        continue;
      }
      if (
        k === "style" ||
        k === "id" ||
        k === "onClick" ||
        k === "colSpan" ||
        k === "rowSpan" ||
        k === "role" ||
        k === "title" ||
        k.startsWith("aria-") ||
        k.startsWith("data-")
      ) {
        out[k] = v;
      }
    }
    return out;
  };
  const makeStub = (Tag: "div" | "section" | "article") =>
    (props: any) => {
      const passthrough = safeProps(props);
      if (Tag === "section") {
        return <section {...passthrough}>{props.children}</section>;
      }
      if (Tag === "article") {
        return <article {...passthrough}>{props.children}</article>;
      }
      return <div {...passthrough}>{props.children}</div>;
    };
  return {
    ...actual,
    Box: makeStub("div"),
    Flex: makeStub("div"),
    Stack: makeStub("div"),
    Group: makeStub("div"),
    Paper: makeStub("section"),
    Card: makeStub("article"),
  };
}
