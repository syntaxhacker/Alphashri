import { createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";

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

  const flashCopied = () => {
    if (timer) clearTimeout(timer);
    setCopied(true);
    timer = setTimeout(() => setCopied(false), props.timeout ?? 1000);
  };

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
        const ok = (() => {
          try {
            return document.execCommand("copy");
          } finally {
            document.body.removeChild(ta);
          }
        })();
        if (!ok) return;
      }
      flashCopied();
    } catch {
      // An insecure context or a denied permission means nothing reached the
      // clipboard; the confirmation label is the only feedback the caller has,
      // so it must stay off.
      if (timer) clearTimeout(timer);
      setCopied(false);
    }
  };

  return <>{props.children({ copied: copied(), copy })}</>;
}
