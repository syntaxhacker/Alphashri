#!/usr/bin/env python3
"""Assemble the options beginner course HTML from chapter fragments + GSAP layer."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "reports" / "course"
OUT = REPO / "reports" / "options_greeks_course.html"

CHAPTERS = [
    ("ch1", "1 · Foundations", "01-foundations.html"),
    ("ch2", "2 · The Greeks", "02-greeks.html"),
    ("ch3", "3 · Spot Is the Engine", "03-spot.html"),
    ("ch4", "4 · Timing & Survival", "04-timing.html"),
]

sections = []
for cid, title, fname in CHAPTERS:
    body = (SRC / fname).read_text()
    sections.append(f'<section id="{cid}" class="chap"><div class="chaphead">{title}</div>\n{body}\n</section>')

SHELL = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Options Buying Course — From Zero to First Paper Trade</title>
<style>
body{background:#0B1220;color:#E2E8F0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0}
#progress{position:fixed;top:0;left:0;height:3px;background:#38BDF8;width:0;z-index:50}
.hero{max-width:960px;margin:0 auto;padding:56px 24px 20px;text-align:center}
.hero h1{font-size:34px;margin:0 0 8px}.hero p{color:#94A3B8;font-size:15px}
nav.toc{position:sticky;top:0;z-index:40;background:rgba(11,18,32,.92);backdrop-filter:blur(6px);border-bottom:1px solid #1E3A5F}
nav.toc div{max-width:960px;margin:0 auto;padding:10px 24px;display:flex;gap:18px;flex-wrap:wrap}
nav.toc a{color:#94A3B8;text-decoration:none;font-size:13px;font-weight:600}
nav.toc a.on{color:#38BDF8}
.wrap{max-width:960px;margin:0 auto;padding:8px 24px 80px}
.chap{margin-top:26px}.chaphead{font-size:13px;font-weight:800;letter-spacing:1.5px;color:#38BDF8;text-transform:uppercase;margin-bottom:6px}
.reveal{will-change:transform,opacity}
.statrow{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin:18px 0}
.stat{background:#111C33;border:1px solid #1E3A5F;border-radius:10px;padding:12px 18px;text-align:center;min-width:140px}
.stat b{font-size:24px;display:block;font-variant-numeric:tabular-nums}
.stat span{font-size:12px;color:#94A3B8}
footer{color:#64748B;font-size:12px;text-align:center;padding:30px}
</style></head><body>
<div id="progress"></div>
<div class="hero">
<h1>Options Buying — From Zero to First Paper Trade</h1>
<p>A beginner course built on real Nifty expiry tape, not textbook theory.</p>
<div class="statrow">
<div class="stat"><b data-count="4">0</b><span>chapters</span></div>
<div class="stat"><b data-count="30">0</b><span>quiz questions</span></div>
<div class="stat"><b data-count="282" data-prefix="+" data-suffix="%">0</b><span>best本书 CE day (real)</span></div>
<div class="stat"><b data-count="75">0</b><span>Nifty lot size</span></div>
</div></div>
<nav class="toc"><div>
<a href="#ch1" data-spy="ch1">1 · Foundations</a>
<a href="#ch2" data-spy="ch2">2 · The Greeks</a>
<a href="#ch3" data-spy="ch3">3 · Spot Engine</a>
<a href="#ch4" data-spy="ch4">4 · Timing</a>
</div></nav>
<div class="wrap">
__SECTIONS__
<footer>Built from live Nifty sessions (Sep–Oct 2026) · paper trade only · not financial advice</footer>
</div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
<script>
(function(){
if(!window.gsap) return;
gsap.registerPlugin(ScrollTrigger);
gsap.utils.toArray(".reveal").forEach(function(el){
  gsap.from(el,{autoAlpha:0,y:28,duration:0.7,ease:"power2.out",
    scrollTrigger:{trigger:el,start:"top 88%"}});
});
document.querySelectorAll("[data-count]").forEach(function(el){
  var target=parseFloat(el.getAttribute("data-count"));
  var dec=(el.getAttribute("data-count").split(".")[1]||"").length;
  var pre=el.getAttribute("data-prefix")||"", suf=el.getAttribute("data-suffix")||"";
  var obj={v:0};
  ScrollTrigger.create({trigger:el,start:"top 92%",once:true,
    onEnter:function(){gsap.to(obj,{v:target,duration:1.4,ease:"power1.out",
      onUpdate:function(){el.textContent=pre+obj.v.toFixed(dec)+suf;}});}});
});
var bar=document.getElementById("progress");
ScrollTrigger.create({start:0,end:"max",onUpdate:function(s){bar.style.width=(s.progress*100)+"%";}});
var links=document.querySelectorAll("nav.toc a");
["ch1","ch2","ch3","ch4"].forEach(function(id){
  ScrollTrigger.create({trigger:"#"+id,start:"top 40%",end:"bottom 40%",
    onToggle:function(s){links.forEach(function(a){a.classList.toggle("on",s.isActive&&a.getAttribute("data-spy")===id);});}});
});
})();
</script></body></html>
"""

# fix accidental non-english token the writers may have introduced
html = SHELL.replace("__SECTIONS__", "\n".join(sections))
html = html.replace("best本书 CE day (real)", "best CE day (real)")
OUT.write_text(html)
print(f"wrote {OUT} ({len(html)//1024} KB)")
