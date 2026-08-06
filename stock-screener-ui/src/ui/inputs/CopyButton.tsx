import { CopyButton as MantineCopyButton } from "@mantine/core";

interface UICopyButtonProps {
  value: string;
  timeout?: number;
  children: (payload: { copied: boolean; copy: () => void }) => React.ReactNode;
}

export function CopyButton({ value, timeout, children }: UICopyButtonProps) {
  return <MantineCopyButton value={value} timeout={timeout}>{children}</MantineCopyButton>;
}
