// @vitest-environment happy-dom
import { it, expect } from "vitest";

it("raw DOM create", () => {
  const t = Date.now();
  const div = document.createElement("div");
  for (let i = 0; i < 500; i++) {
    const el = document.createElement("div");
    el.className = "flex flex-col gap-1 min-w-0 items-center justify-between p-1 m-0 text-fin-text bg-fin-surface border border-fin-border rounded-fin cursor-pointer select-none hover:bg-fin-surface-alt focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fin-primary transition-colors duration-150 text-xs font-medium leading-[1.2] truncate";
    el.setAttribute("style", "display:flex;flex-direction:column;gap:4px;min-width:0;align-items:center;justify-content:space-between");
    el.innerHTML = `<span>cell ${i}</span>`;
    div.appendChild(el);
  }
  document.body.appendChild(div);
  console.log("raw 500 divs:", Date.now() - t, "ms");
  div.remove();
});

it("raw html parse", () => {
  const t = Date.now();
  const div = document.createElement("div");
  div.innerHTML = Array.from({ length: 500 }, (_, i) => `<div class="flex flex-col gap-1 min-w-0 items-center justify-between p-1 m-0 text-fin-text bg-fin-surface border border-fin-border rounded-fin" style="display:flex;flex-direction:column;gap:4px;min-width:0;align-items:center;justify-content:space-between"><span>cell ${i}</span></div>`).join("");
  document.body.appendChild(div);
  console.log("raw innerHTML 500:", Date.now() - t, "ms");
  div.remove();
});
