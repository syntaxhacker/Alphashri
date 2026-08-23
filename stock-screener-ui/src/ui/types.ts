import type { ReactNode, CSSProperties, MouseEvent, KeyboardEvent } from "react";

export type { MantineTheme, MantineColor, MantineColorsTuple } from "@mantine/core";

export interface UIBaseProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  "data-testid"?: string;
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
}

export type UISize = "xs" | "sm" | "md" | "lg" | "xl";
export type UIColor =
  | "teal" | "green" | "red" | "orange" | "dark"
  | "blue" | "gray" | "yellow" | "violet" | "pink" | "cyan"
  | "success" | "danger" | "warning"
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
export type UIVariant = "filled" | "light" | "outline" | "subtle" | "default" | "transparent" | "white";

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
  children?: ReactNode;
  inline?: boolean;
}

export interface UIPaperProps extends UIBoxProps {
  shadow?: "xs" | "sm" | "md" | "lg" | "xl" | string;
  radius?: UIRadius;
  withBorder?: boolean;
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
  onScrollPositionChange?: (pos: { x: number; y: number }) => void;
}

export interface UIDividerProps extends UIBaseProps {
  orientation?: "horizontal" | "vertical";
  color?: UIColor;
  size?: number | string;
  label?: ReactNode;
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
  icon?: ReactNode;
}

export interface UIListItemProps extends UIBaseProps {}

export interface UIBadgeProps extends UIBaseProps {
  variant?: UIVariant;
  color?: UIColor;
  size?: UISize;
  radius?: UIRadius;
  fullWidth?: boolean;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
}

export interface UIAlertProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "default" | "transparent";
  color?: UIColor;
  radius?: UIRadius;
  icon?: ReactNode;
  title?: ReactNode;
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
  color?: UIColor;
  size?: UISize;
  radius?: UIRadius;
  fullWidth?: boolean;
  disabled?: boolean;
  loading?: boolean;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  type?: "button" | "submit" | "reset";
  compact?: boolean;
  onClick?: (e: MouseEvent) => void;
}

export interface UIActionIconProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "subtle" | "default" | "transparent";
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

export interface UIInputWrapperProps extends UIBaseProps {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  size?: UISize;
  placeholder?: string;
}

export interface UITextInputProps extends UIInputWrapperProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  type?: string;
}

export interface UINumberInputProps extends UIInputWrapperProps {
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
  leftSection?: ReactNode;
  rightSection?: ReactNode;
}

export interface UISelectProps extends UIInputWrapperProps {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (value: string | null) => void;
  data?: (string | { value: string; label: string; disabled?: boolean })[];
  searchable?: boolean;
  clearable?: boolean;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  nothingFoundMessage?: string;
  placeholder?: string;
}

export interface UIMultiSelectProps extends UIInputWrapperProps {
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  data?: (string | { value: string; label: string; disabled?: boolean })[];
  searchable?: boolean;
  clearable?: boolean;
  placeholder?: string;
  nothingFoundMessage?: string;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  maxValues?: number;
  hidePickedOptions?: boolean;
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
  label?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  size?: UISize;
  color?: UIColor;
  onLabel?: string;
  offLabel?: string;
  description?: ReactNode;
}

export interface UICheckboxProps extends UIBaseProps {
  label?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  size?: UISize;
  color?: UIColor;
  indeterminate?: boolean;
  description?: ReactNode;
}

export interface UIChipProps extends UIBaseProps {
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
  title?: ReactNode;
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
  label: ReactNode;
  withArrow?: boolean;
  position?: "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end";
  openDelay?: number;
  closeDelay?: number;
  disabled?: boolean;
  multiline?: boolean;
  color?: UIColor;
}

export interface UIPopoverProps extends UIBaseProps {
  opened?: boolean;
  onClose?: () => void;
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
  children?: ReactNode | ((payload: { ref: any; toggle: () => void; close: () => void; opened: boolean }) => ReactNode);
}

export interface UIPopoverTargetProps extends UIBaseProps {}
export interface UIPopoverDropdownProps extends UIBaseProps {}

export interface UINavLinkProps extends UIBaseProps {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  leftSection?: ReactNode;
  rightSection?: ReactNode;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  variant?: "light" | "filled" | "subtle";
  defaultOpened?: boolean;
  opened?: boolean;
  onClick?: () => void;
  children?: ReactNode;
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
  withBorder?: boolean;
  zIndex?: number | string;
  transitionDuration?: number;
  transitionTimingFunction?: string;
  disabled?: boolean;
  offsetScrollbars?: boolean;
}

export interface UIAppShellHeaderProps extends UIBaseProps {
  withBorder?: boolean;
  zIndex?: number | string;
}

export interface UIAppShellNavbarProps extends UIBaseProps {
  p?: UISize | number | string;
  withBorder?: boolean;
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
  icon?: ReactNode;
  rightSection?: ReactNode;
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
  title?: ReactNode;
  bullet?: ReactNode;
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
  renderNode?: (payload: { node: UITreeNode; expanded: boolean; hasChildren: boolean; level: number; elementProps?: any }) => ReactNode;
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
  children?: ReactNode;
  /** Render function for custom trigger */
  renderTarget?: (props: any) => ReactNode;
}

export interface UIMenuTargetProps extends UIBaseProps {}
export interface UIMenuDropdownProps extends UIBaseProps {}
export interface UIMenuItemProps extends UIBaseProps {
  leftSection?: ReactNode;
  rightSection?: ReactNode;
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
  children?: ReactNode;
}

export interface UIThemeIconProps extends UIBaseProps {
  variant?: "filled" | "light" | "outline" | "default" | "white";
  color?: UIColor;
  size?: UISize | number | string;
  radius?: UIRadius;
  children?: ReactNode;
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
  children?: ReactNode;
  required?: boolean;
  size?: UISize;
}

export interface UIThemeProviderProps {
  children: ReactNode;
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
  withBorder?: boolean;
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
  icon?: ReactNode;
  autoClose?: number | boolean;
  withCloseButton?: boolean;
}

export interface UIUseColorSchemeResult {
  isDark: boolean;
  colorScheme: "light" | "dark";
  toggleColorScheme: () => void;
  setColorScheme: (scheme: "light" | "dark") => void;
}
