import type { JSX } from "solid-js";

export type UITheme = typeof import("./sxTheme").sxTheme;

export interface UIBaseProps {
  children?: JSX.Element;
  className?: string;
  style?: JSX.CSSProperties;
  id?: string;
  "data-testid"?: string;
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
}

export type UISize = "xs" | "sm" | "md" | "lg" | "xl";
export type UIColor =
  | "primary"
  | "secondary"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "danger"
  | string;
export type UITone = UIColor;
export type UIFontWeight = "normal" | "medium" | "semibold" | "bold" | number;
export type UIAlign = "left" | "center" | "right";
export type UIFlexDirection = "row" | "column" | "row-reverse" | "column-reverse";
export type UIFlexWrap = "wrap" | "nowrap" | "wrap-reverse";
export type UIJustify = "flex-start" | "center" | "flex-end" | "space-between" | "space-around" | "space-evenly";
export type UIAlignItems = "flex-start" | "center" | "flex-end" | "stretch" | "baseline";
export type UIGap = UISize | number | string;
export type UIRadius = UISize | number | "xl";
export type UIVariant =
  | "filled"
  | "light"
  | "outline"
  | "subtle"
  | "default"
  | "transparent"
  | "white"
  /** Status pill: colour dot + label. */
  | "dot";

export interface UIBoxProps extends UIBaseProps {
  onClick?: (e: MouseEvent) => void;
  p?: UISize | number | string;
  px?: UISize | number | string;
  py?: UISize | number | string;
  pt?: UISize | number | string;
  pb?: UISize | number | string;
  pl?: UISize | number | string;
  pr?: UISize | number | string;
  m?: UISize | number | string;
  mx?: UISize | number | string;
  my?: UISize | number | string;
  mt?: UISize | number | string;
  mb?: UISize | number | string;
  ml?: UISize | number | string;
  mr?: UISize | number | string;
  bg?: UIColor;
  c?: UIColor;
  opacity?: number;
  visibleFrom?: UISize;
  hiddenFrom?: UISize;
  pos?: "relative" | "absolute" | "fixed" | "sticky";
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  w?: number | string;
  h?: number | string;
  miw?: number | string;
  maw?: number | string;
  mih?: number | string;
  mah?: number | string;
  flex?: number | string;
}

export interface UIFlexProps extends UIBoxProps {
  direction?: UIFlexDirection;
  wrap?: UIFlexWrap;
  justify?: UIJustify;
  align?: UIAlignItems;
  gap?: UIGap;
}

export interface UIStackProps extends UIFlexProps {}

export interface UIGroupProps extends UIFlexProps {
  preventGrowOverflow?: boolean;
  grow?: boolean;
}

export interface UICenterProps extends UIBaseProps {
  children?: JSX.Element;
  inline?: boolean;
}

export interface UIPaperProps extends UIBoxProps {
  shadow?: "xs" | "sm" | "md" | "lg" | "xl" | string;
  radius?: UIRadius;
  p?: UISize | number | string;
}

export interface UICardProps extends UIPaperProps {
  padding?: UISize | number | string;
}

export interface UIScrollAreaProps extends UIBaseProps {
  h?: number | string;
  w?: number | string;
  type?: "auto" | "always" | "scroll" | "hover" | "never";
  offsetScrollbars?: boolean;
  scrollbarSize?: number;
  scrollHideDelay?: number;
  onScroll?: (e: Event & { currentTarget: HTMLDivElement }) => void;
  onScrollPositionChange?: (pos: { x: number; y: number }) => void;
}

export interface UIDividerProps extends UIBaseProps {
  orientation?: "horizontal" | "vertical";
  color?: UIColor;
  size?: number | string;
  label?: JSX.Element;
  labelPosition?: "left" | "center" | "right";
}

export interface UICollapseProps extends UIBaseProps {
  in: boolean;
  transitionDuration?: number;
  transitionTimingFunction?: string;
  onTransitionEnd?: () => void;
}

export interface UISimpleGridProps extends UIBaseProps {
  cols?: number;
  spacing?: UIGap;
  verticalSpacing?: UIGap;
  type?: "container" | "media";
}

export interface UIGridProps extends UIBaseProps {
  gutter?: UIGap;
  grow?: boolean;
  columns?: number;
}

export interface UIGridColProps extends UIBaseProps {
  span?: number | "auto" | "content";
  order?: number;
  offset?: number;
}

export interface UITextProps extends UIBaseProps {
  component?: keyof JSX.IntrinsicElements;
  p?: number | string;
  px?: number | string;
  py?: number | string;
  pt?: number | string;
  pb?: number | string;
  pl?: number | string;
  pr?: number | string;
  m?: number | string;
  mx?: number | string;
  my?: number | string;
  mt?: number | string;
  mb?: number | string;
  ml?: number | string;
  mr?: number | string;
  w?: number | string;
  maw?: number | string;
  opacity?: number;
  fs?: string;
  /** `text-transform` — `uppercase` for section labels, `capitalize` for headings. */
  tt?: "uppercase" | "lowercase" | "capitalize" | "none";
  /** Native tooltip — the full text when the visible label is truncated. */
  title?: string;
  size?: UISize;
  fw?: UIFontWeight;
  c?: UIColor;
  ta?: UIAlign;
  lh?: string | number;
  span?: boolean;
  truncate?: boolean | "end" | "start";
  lineClamp?: number;
  inherit?: boolean;
}

export interface UITitleProps extends UIBaseProps {
  order?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Native tooltip attribute — forwarded to the root element. */
  title?: string;
  component?: keyof JSX.IntrinsicElements;
  mt?: number | string;
  mb?: number | string;
  ml?: number | string;
  mr?: number | string;
  c?: UIColor;
  ta?: UIAlign;
  fw?: UIFontWeight;
  size?: UISize | string | number;
  lh?: string | number;
}

export interface UIAnchorProps extends UITextProps {
  href?: string;
  target?: string;
  underline?: "always" | "hover" | "never";
  onClick?: (e: MouseEvent) => void;
  component?: any;
}

export interface UICodeProps extends UIBaseProps {
  block?: boolean;
  color?: UIColor;
}

export interface UIListProps extends UIBaseProps {
  type?: "ordered" | "unordered";
  withPadding?: boolean;
  size?: UISize;
  spacing?: UIGap;
  listStyleType?: string;
  center?: boolean;
  icon?: JSX.Element;
}

export interface UIListItemProps extends UIBaseProps {}

export interface UIBadgeProps extends UIBaseProps {
  variant?: UIVariant;
  /** Native tooltip attribute — forwarded to the badge element. */
  title?: string;
  color?: UIColor;
  size?: UISize;
  radius?: UIRadius;
  fullWidth?: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
}

export interface UIAlertProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "default" | "transparent";
  color?: UIColor;
  radius?: UIRadius;
  icon?: JSX.Element;
  title?: JSX.Element;
  withCloseButton?: boolean;
  onClose?: () => void;
}

export interface UILoaderProps extends UIBaseProps {
  size?: UISize | number | string;
  color?: UIColor;
  type?: "oval" | "bars" | "dots" | string;
}

export interface UIProgressProps extends UIBaseProps {
  value: number;
  color?: UIColor;
  size?: UISize | number | string;
  radius?: UIRadius;
  striped?: boolean;
  animated?: boolean;
  label?: string;
  sections?: { value: number; color: UIColor; label?: string }[];
  transitionDuration?: number;
}

export interface UISkeletonProps extends UIBaseProps {
  h?: number | string;
  w?: number | string;
  circle?: boolean;
  radius?: UIRadius;
  animate?: boolean;
  visible?: boolean;
}

export interface UILoadingOverlayProps extends UIBaseProps {
  visible: boolean;
  loaderProps?: UILoaderProps;
  overlayProps?: UIOverlayProps;
  zIndex?: number | string;
}

export interface UIOverlayProps extends UIBaseProps {
  color?: UIColor;
  opacity?: number;
  blur?: number | string;
  zIndex?: number | string;
  fixed?: boolean;
  center?: boolean;
}

export interface UIButtonProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "subtle" | "default" | "transparent" | "white";
  /** Native tooltip attribute — forwarded to the <button>. */
  title?: string;
  color?: UIColor;
  size?: UISize;
  radius?: UIRadius;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  type?: "button" | "submit" | "reset";
  compact?: boolean;
  onClick?: (e: MouseEvent) => void;
}

export interface UIActionIconProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "subtle" | "default" | "transparent";
  /** Native tooltip attribute — forwarded to the <button>. */
  title?: string;
  color?: UIColor;
  size?: UISize | number | string;
  radius?: UIRadius;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: MouseEvent) => void;
}

export interface UIUnstyledButtonProps extends UIBaseProps {
  onClick?: (e: MouseEvent) => void;
}

/**
 * Props carried over from the Mantine-era API. Accepted so old call sites keep
 * compiling, stripped before render — they can never affect the DOM.
 */
export interface UIInputCompatProps {
  errorProps?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  loading?: boolean;
  variant?: string;
}

export interface UIInputWrapperProps extends UIBaseProps {
  label?: JSX.Element;
  description?: JSX.Element;
  /** Message or flag; a string is shown as the helper text. */
  error?: boolean | string | JSX.Element;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  size?: UISize;
  placeholder?: string;
  /** Form field name — forwarded to the native input for FormData support. */
  name?: string;
  /** Accessible name for the control (multi-selects render a combobox, not a label). */
  "aria-label"?: string;
  /** Explicit control width (number → px). When set, fullWidth is disabled. */
  w?: number | string;
  /** Explicit control height (number → px). */
  h?: number | string;
}

export interface UITextInputProps extends UIInputWrapperProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  type?: string;
}

export interface UINumberInputProps extends UIInputWrapperProps, UIInputCompatProps {
  value?: number | string;
  defaultValue?: number | string;
  onChange?: (value: number | string) => void;
  min?: number;
  max?: number;
  step?: number;
  decimalScale?: number;
  clampBehavior?: "strict" | "blur" | "none";
  allowDecimal?: boolean;
  allowNegative?: boolean;
  hideControls?: boolean;
  suffix?: string;
  prefix?: string;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
}

export interface UISelectProps extends UIInputWrapperProps {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  data?: (string | { value: string; label: string; disabled?: boolean })[];
  searchable?: boolean;
  clearable?: boolean;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  nothingFoundMessage?: string;
  placeholder?: string;
  /**
   * Legacy Mantine-compat props. Accepted so existing call sites keep
   * typechecking, but intentionally swallowed — never forwarded to the DOM.
   * @see stripLegacyInputProps
   */
  allowDeselect?: boolean;
  maxDropdownHeight?: number | string;
  comboboxProps?: unknown;
  withinPortal?: boolean;
  InputProps?: unknown;
}

export interface UIMultiSelectProps extends UIInputWrapperProps {
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  data?: (string | { value: string; label: string; disabled?: boolean })[];
  searchable?: boolean;
  /**
   * Controlled search text. Provide this together with `onSearchChange` so the
   * typed query lives in the caller's state and is preserved across internal reset/blur events.
   */
  searchValue?: string;
  /**
   * Fired for genuine search changes only: `reason` is `"input"` (typing,
   * including backspace-to-empty) or `"clear"` (X button / Escape). Empties from internal reset/blur handling are not forwarded.
   */
  onSearchChange?: (value: string, reason?: string) => void;
  clearable?: boolean;
  placeholder?: string;
  nothingFoundMessage?: string;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  maxValues?: number;
  hidePickedOptions?: boolean;
  /** Hide the inline selected tags (the caller renders its own chip row). */
  hideTags?: boolean;
  /**
   * Legacy Mantine-compat props. Accepted so existing call sites keep
   * typechecking, but intentionally swallowed — never forwarded to the DOM.
   * @see stripLegacyInputProps
   */
  allowDeselect?: boolean;
  maxDropdownHeight?: number | string;
  comboboxProps?: unknown;
  withinPortal?: boolean;
  InputProps?: unknown;
}

export interface UITextareaProps extends UIInputWrapperProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  resize?: "none" | "both" | "horizontal" | "vertical";
}

export interface UIPasswordInputProps extends UITextInputProps {
  visibilityToggleButtonLabel?: string;
  visible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export interface UISwitchProps extends UIBaseProps {
  label?: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (e: Event & { currentTarget: HTMLInputElement | HTMLSelectElement; target: Element }) => void;
  disabled?: boolean;
  size?: UISize;
  color?: UIColor;
  onLabel?: string;
  offLabel?: string;
  description?: JSX.Element;
  /** Validation failure — renders the negative border like every text control. */
  error?: boolean | string;
}

export interface UICheckboxProps extends UIBaseProps {
  label?: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (e: Event & { currentTarget: HTMLInputElement | HTMLSelectElement; target: Element }) => void;
  disabled?: boolean;
  size?: UISize;
  color?: UIColor;
  indeterminate?: boolean;
  description?: JSX.Element;
  error?: boolean | string;
}

export interface UIChipProps extends UIBaseProps {
  label?: JSX.Element;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: UISize;
  color?: UIColor;
  variant?: "filled" | "light" | "outline";
  value?: string;
}

export interface UISegmentedControlProps extends UIBaseProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  data: (string | { value: string; label: string; disabled?: boolean })[];
  color?: UIColor;
  size?: UISize;
  fullWidth?: boolean;
  withItemsBorders?: boolean;
}

export interface UIModalProps extends UIBaseProps {
  opened: boolean;
  onClose: () => void;
  title?: JSX.Element;
  size?: UISize | number | string;
  fullScreen?: boolean;
  centered?: boolean;
  withCloseButton?: boolean;
  closeOnClickOutside?: boolean;
  closeOnEscape?: boolean;
  overlayProps?: UIOverlayProps;
  padding?: UISize | number | string;
  transitionProps?: { duration?: number; timingFunction?: string };
}

export interface UITooltipProps extends UIBaseProps {
  label: JSX.Element;
  withArrow?: boolean;
  position?: "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end";
  openDelay?: number;
  closeDelay?: number;
  disabled?: boolean;
  multiline?: boolean;
  color?: UIColor;
  /**
   * Legacy Mantine-compat prop. Accepted so existing call sites keep
   * typechecking, but intentionally swallowed — the component handles portal rendering internally and must never receive this as a DOM attribute.
   */
  withinPortal?: boolean;
}

// Popover accepts a render-prop child, so it cannot inherit the plain
// `children` type from UIBaseProps.
export interface UIPopoverProps extends Omit<UIBaseProps, "children"> {
  opened?: boolean;
  onClose?: () => void;
  /** Mantine-style controlled callback: called with the next opened state. */
  onChange?: (opened: boolean) => void;
  position?: "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end";
  withArrow?: boolean;
  width?: number | string;
  shadow?: string;
  offset?: number;
  trapFocus?: boolean;
  closeOnClickOutside?: boolean;
  middlewares?: any;
  keepMounted?: boolean;
  /** Render function receiving { ref, toggle, close, open, opened } or direct children */
  children?: JSX.Element | ((payload: { ref: any; toggle: () => void; close: () => void; opened: boolean }) => JSX.Element);
}

export interface UIPopoverTargetProps extends UIBaseProps {}
export interface UIPopoverDropdownProps extends UIBaseProps {}

export interface UINavLinkProps extends UIBaseProps {
  label: JSX.Element;
  description?: JSX.Element;
  icon?: JSX.Element;
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  variant?: "light" | "filled" | "subtle";
  defaultOpened?: boolean;
  opened?: boolean;
  onClick?: () => void;
  children?: JSX.Element;
  autoContrast?: boolean;
}

export interface UIAppShellProps extends UIBaseProps {
  header?: { height: number | string; collapsed?: boolean; offset?: boolean };
  navbar?: {
    width: number | string | Record<string, number | string>;
    breakpoint?: UISize | number | string;
    collapsed?: boolean | { mobile?: boolean; desktop?: boolean };
  };
  aside?: { width: number | string; breakpoint?: UISize | number | string; collapsed?: boolean | { mobile?: boolean; desktop?: boolean } };
  footer?: { height: number | string; collapsed?: boolean };
  padding?: UISize | number | string;
  layout?: "default" | "alt";
  zIndex?: number | string;
  transitionDuration?: number;
  transitionTimingFunction?: string;
  disabled?: boolean;
  offsetScrollbars?: boolean;
}

export interface UIAppShellHeaderProps extends UIBaseProps {
  zIndex?: number | string;
}

export interface UIAppShellNavbarProps extends UIBaseProps {
  p?: UISize | number | string;
  zIndex?: number | string;
}

export interface UIAppShellMainProps extends UIBaseProps {}

export interface UIAppShellSectionProps extends UIBaseProps {
  grow?: boolean;
  component?: any;
}

export interface UITabsProps extends UIBaseProps {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  variant?: "default" | "outline" | "pills" | "underline";
  color?: UIColor;
  orientation?: "horizontal" | "vertical";
  activateOnFocus?: boolean;
  loop?: boolean;
}

export interface UITabProps extends UIBaseProps {
  value: string;
  icon?: JSX.Element;
  /** Leading slot, rendered before the icon — matches `UIButtonProps`. */
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  disabled?: boolean;
}

export interface UITabsPanelProps extends UIBaseProps {
  value: string;
  keepMounted?: boolean;
}

export interface UIAccordionProps extends UIBaseProps {
  multiple?: boolean;
  defaultValue?: string | string[];
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  variant?: "default" | "contained" | "filled" | "separated";
  chevronPosition?: "left" | "right";
  disableChevronRotation?: boolean;
}

export interface UIAccordionItemProps extends UIBaseProps {
  value: string;
}

export interface UIAccordionControlProps extends UIBaseProps {}

export interface UIAccordionPanelProps extends UIBaseProps {}

export interface UITimelineProps extends UIBaseProps {
  active?: number;
  bulletSize?: number | string;
  color?: UIColor;
  align?: "left" | "right";
  lineWidth?: number;
  reverseActive?: boolean;
}

export interface UITimelineItemProps extends UIBaseProps {
  title?: JSX.Element;
  bullet?: JSX.Element;
  color?: UIColor;
  lineVariant?: "solid" | "dashed" | "dotted";
  active?: boolean;
}

export interface UITreeNode {
  value: string;
  label: string;
  children?: UITreeNode[];
  [key: string]: any;
}

export interface UITreeProps extends UIBaseProps {
  data: UITreeNode[];
  tree?: any;
  expanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  onNodeClick?: (node: UITreeNode) => void;
  levelOffset?: number;
  renderNode?: (payload: { node: UITreeNode; expanded: boolean; hasChildren: boolean; level: number; elementProps?: any }) => JSX.Element;
}

export interface UIMenuProps extends UIBaseProps {
  trigger?: "click" | "hover" | "click-hover";
  opened?: boolean;
  onChange?: (opened: boolean) => void;
  position?: "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end";
  offset?: number;
  withArrow?: boolean;
  shadow?: string;
  closeOnItemClick?: boolean;
  closeOnClickOutside?: boolean;
  loop?: boolean;
  children?: JSX.Element;
  /** Render function for custom trigger */
  renderTarget?: (props: any) => JSX.Element;
}

export interface UIMenuTargetProps extends UIBaseProps {}
export interface UIMenuDropdownProps extends UIBaseProps {}
export interface UIMenuItemProps extends UIBaseProps {
  leftSection?: JSX.Element;
  rightSection?: JSX.Element;
  color?: UIColor;
  disabled?: boolean;
  onClick?: () => void;
}

export interface UIAvatarProps extends UIBaseProps {
  src?: string | null;
  alt?: string;
  color?: UIColor;
  radius?: UIRadius;
  size?: UISize | number | string;
  children?: JSX.Element;
}

export interface UIThemeIconProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "default" | "white";
  color?: UIColor;
  size?: UISize | number | string;
  radius?: UIRadius;
  children?: JSX.Element;
}

export interface UICloseButtonProps extends UIBaseProps {
  size?: UISize | number | string;
  variant?: "filled" | "light" | "outline" | "subtle" | "transparent";
  disabled?: boolean;
  onClick?: () => void;
}

export interface UIDatePickerProps extends UIBaseProps {
  value?: Date | null;
  defaultValue?: Date | null;
  onChange?: (date: Date | null) => void;
  placeholder?: string;
  size?: UISize;
  clearable?: boolean;
  minDate?: Date;
  maxDate?: Date;
  excludeDate?: (date: Date) => boolean;
  weekendDays?: number[];
  valueFormat?: string;
  disabled?: boolean;
  getDayProps?: (date: Date) => Record<string, unknown>;
}

export interface UIInputLabelProps extends UIBaseProps {
  children?: JSX.Element;
  required?: boolean;
  size?: UISize;
}

export interface UIThemeProviderProps {
  children: JSX.Element;
  defaultColorScheme?: "light" | "dark";
  forceColorScheme?: "light" | "dark";
}

export interface UIIndicatorProps extends UIBaseProps {
  label?: string;
  color?: UIColor;
  size?: number;
  offset?: number;
  disabled?: boolean;
  processing?: boolean;
  position?: "top-start" | "top-end" | "bottom-start" | "bottom-end";
}

export type UIPortalTarget = HTMLElement | string;
export interface UIPortalProps extends UIBaseProps {
  target?: UIPortalTarget;
}

export interface UIThemeNotifyProps {
  title?: string;
  message: string;
  color?: UIColor;
  icon?: JSX.Element;
  autoClose?: number | boolean;
  withCloseButton?: boolean;
}

export interface UIUseColorSchemeResult {
  /** Accessors, not snapshots — read them in JSX/effects to stay reactive. */
  isDark: () => boolean;
  colorScheme: () => "light" | "dark";
  toggleColorScheme: () => void;
  setColorScheme: (scheme: "light" | "dark") => void;
}
