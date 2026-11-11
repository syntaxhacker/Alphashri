import { useState } from "react";
import { cn } from "../cn";
import type { UINavLinkProps } from "../types";

export function NavLink({
  label,
  description,
  icon,
  leftSection,
  rightSection,
  href,
  active,
  disabled,
  variant: _variant,
  defaultOpened,
  opened,
  onClick,
  children,
  autoContrast: _autoContrast,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UINavLinkProps) {
  const resolvedLeftSection = leftSection ?? icon;
  const hasChildren = Boolean(children);
  const [internalOpen, setInternalOpen] = useState(Boolean(defaultOpened));
  const isControlled = opened !== undefined;
  const open = isControlled ? Boolean(opened) : internalOpen;

  const handleClick = (_e: React.MouseEvent) => {
    if (hasChildren && !isControlled) setInternalOpen((v) => !v);
    onClick?.();
  };

  const isLink = Boolean(href);
  const activeState = Boolean(active);
  const disabledState = Boolean(disabled);

  const Component = isLink ? "a" : "div";

  return (
    <>
      <Component
        role="link"
        aria-current={activeState ? "page" : undefined}
        aria-disabled={disabledState || undefined}
        onClick={handleClick}
        href={isLink ? (href as string) : undefined}
        className={cn(
          "inline-flex items-center gap-2 rounded-sm cursor-pointer select-none text-fin-text",
          "px-3 py-2 text-sm",
          activeState ? "bg-fin-primary text-fin-bg hover:bg-fin-primary/90" : "hover:bg-fin-surface-alt",
          disabledState ? "opacity-50 pointer-events-none" : "",
          className,
        )}
        style={style}
        id={id}
        data-testid={testId}
        {...(rest as Record<string, unknown>)}
      >
        {resolvedLeftSection ? <span className="shrink-0">{resolvedLeftSection}</span> : null}
        {label ? (
          <>
            <span className="font-medium">{label}</span>
            {description ? <span className="text-xs text-fin-text-muted">{description}</span> : null}
          </>
        ) : null}
        {rightSection ?? null}
      </Component>
      {hasChildren ? (
        <div className={cn("mt-1", open ? "" : "hidden")} data-testid={testId ? `${testId}-collapse` : undefined}>
          {children}
        </div>
      ) : null}
    </>
  );
}
