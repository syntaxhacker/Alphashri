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
  const makeStub = (Tag: "div" | "section" | "article") =>
    (props: any) => {
      if (Tag === "section") {
        return (
          <section
            id={props.id}
            class={props.className}
            style={props.style}
            data-testid={props["data-testid"]}
            onClick={props.onClick}
          >
            {props.children}
          </section>
        );
      }
      if (Tag === "article") {
        return (
          <article
            id={props.id}
            class={props.className}
            style={props.style}
            data-testid={props["data-testid"]}
            onClick={props.onClick}
          >
            {props.children}
          </article>
        );
      }
      return (
        <div
          id={props.id}
          class={props.className}
          style={props.style}
          data-testid={props["data-testid"]}
          onClick={props.onClick}
        >
          {props.children}
        </div>
      );
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
