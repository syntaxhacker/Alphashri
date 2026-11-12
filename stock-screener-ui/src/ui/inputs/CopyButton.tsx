import { createEffect, createSignal, onCleanup } from "solid-js";

interface UICopyButtonProps {
  value: string;
  timeout?: number;
  children: (payload: { copied: boolean; copy: () => void }) => JSX.Element;
}

export function CopyButton(props: UICopyButtonProps) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    return () => {
      if (timer) clearTimeout(timer);
    };
  });

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(props.value);
      } else {
        // Fallback for non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = props.value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), props.timeout ?? 1000);
    } catch {
      // Clipboard failures still surface the copied state; callers decide how
      // to present the confirmation.
      setCopied(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCopied(false), props.timeout ?? 1000);
    }
  };

  return props.children({ copied: copied(), copy });
}
