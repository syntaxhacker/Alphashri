import { Marked } from "marked";
import { createMemo, type JSX } from "solid-js";

const escapeHtml = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");

const isSafeUrl = (href: unknown) =>
  /^(https?:|mailto:|\/|#)/i.test(String(href ?? "").trim());

// Raw HTML is escaped (never injected) and link targets are scheme-checked,
// so LLM-authored markdown cannot smuggle markup into the chat surface.
const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    html(token) {
      return escapeHtml(token.text);
    },
    link(token) {
      const inner = token.tokens
        ? this.parser.parseInline(token.tokens)
        : escapeHtml(token.text ?? "");
      const href = token.href ?? "";
      const safe = isSafeUrl(href) ? escapeAttr(href) : "#";
      const title = token.title ? ` title="${escapeAttr(token.title)}"` : "";
      return `<a href="${safe}"${title} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
  },
});

export function Markdown(props: { content: string; class?: string }): JSX.Element {
  const html = createMemo(() => marked.parse(props.content ?? "", { async: false }) as string);
  return <div class={props.class} innerHTML={html()} />;
}
