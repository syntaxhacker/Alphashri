import { Show, createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UINavLinkProps } from "../types";

export function NavLink(props: UINavLinkProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "description",
    "icon",
    "leftSection",
    "rightSection",
    "href",
    "active",
    "disabled",
    "defaultOpened",
    "opened",
    "onClick",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  const resolvedLeftSection = known.leftSection ?? known.icon;
  const hasChildren = Boolean(known.children);
  const [internalOpen, setInternalOpen] = createSignal(Boolean(known.defaultOpened));
  const isControlled = known.opened !== undefined;
  const open = createMemo(() => (isControlled ? Boolean(known.opened) : internalOpen()));

  const handleClick = () => {
    if (hasChildren && !isControlled) setInternalOpen((v: boolean) => !v);
    known.onClick?.();
  };

  const isLink = Boolean(known.href);
  const activeState = Boolean(known.active);
  const disabledState = Boolean(known.disabled);

  const renderKids = () => (
    <>
      {resolvedLeftSection ? <span className="shrink-0">{resolvedLeftSection}</span> : null}
      {known.label ? (
        <>
          <span className="font-medium">{known.label}</span>
          {known.description ? <span className="text-xs text-fin-text-muted">{known.description}</span> : null}
        </>
      ) : null}
      {known.rightSection ?? null}
    </>
  );

  const baseClass = cn(
    "inline-flex items-center gap-2 rounded-sm cursor-pointer select-none text-fin-text",
    "px-3 py-2 text-sm",
    activeState ? "bg-fin-primary text-fin-bg hover:bg-fin-primary/90" : "hover:bg-fin-surface-alt",
    disabledState ? "opacity-50 pointer-events-none" : "",
    known.className,
  );

  return (
    <>
      <Show when={isLink}>
        <a
          role="link"
          aria-current={activeState ? "page" : undefined}
          aria-disabled={disabledState || undefined}
          onClick={handleClick}
          href={known.href}
          className={baseClass}
          style={known.style}
          id={known.id}
          data-testid={known["data-testid"]}
        >
          {renderKids()}
        </a>
      </Show>
      <Show when={!isLink}>
        <div
          role="link"
          aria-current={activeState ? "page" : undefined}
          aria-disabled={disabledState || undefined}
          onClick={handleClick}
          className={baseClass}
          style={known.style}
          id={known.id}
          data-testid={known["data-testid"]}
        >
          {renderKids()}
        </div>
      </Show>
      <Show when={hasChildren && open()}>
        <div className="mt-1" data-testid={known["data-testid"] ? `${known["data-testid"]}-collapse` : undefined}>
          {known.children}
        </div>
      </Show>
    </>
  );
}
