/* Shared right-side documentation drawer for tabs.
 *
 * Panels declare docs on their existing object:
 *   UW.PANELS.<tab>.info = {
 *     title, tagline,
 *     sections: [ { h: "Heading", p: "<p>html…</p>" }, ... ]
 *   }
 * The ⓘ icon injected into each tab button calls UW.showInfo(<tab>).
 */
(function () {
  const U = (window.UW = window.UW || {});
  const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));

  let drawer = null;
  let backdrop = null;

  function ensure() {
    if (drawer) return;
    backdrop = document.createElement("div");
    backdrop.className = "info-backdrop";
    backdrop.addEventListener("click", U.hideInfo);
    drawer = document.createElement("aside");
    drawer.className = "info-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Tab documentation");
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") U.hideInfo();
    });
  }

  U.isInfoOpen = () => !!(drawer && drawer.classList.contains("open"));

  U.showInfo = function (tab) {
    ensure();
    const panel = (U.PANELS || {})[tab] || {};
    const doc = (U.TABINFO && U.TABINFO[tab]) || panel.info;
    const sections = doc && doc.sections ? doc.sections.filter((s) => !/endpoints?\s+used/i.test(s.h || "")) : [];
    const body =
      sections.length
        ? sections.map((s) => `<section><h4>${esc(s.h || "")}</h4>${s.p || ""}</section>`).join("")
        : '<section><p class="muted">No documentation yet for this tab.</p></section>';
    drawer.innerHTML =
      `<div class="info-head">
        <div>
          <h3>${esc((doc && doc.title) || panel.title || tab)}</h3>
          ${doc && doc.tagline ? `<div class="info-tag">${esc(doc.tagline)}</div>` : ""}
        </div>
        <button class="info-x" title="Close (Esc)">✕</button>
      </div>
      <div class="info-body">${body}</div>`;
    drawer.querySelector(".info-x").addEventListener("click", U.hideInfo);
    drawer.classList.add("open");
    backdrop.classList.add("open");
    const b = drawer.querySelector(".info-body");
    if (b) b.scrollTop = 0;
  };

  U.hideInfo = function () {
    if (drawer) drawer.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  };
})();
