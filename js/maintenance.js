// Temporary notice while the new version is being prepared (26/11/2026). Remove when Jerold is back.
(() => {
  const KEY = "cdf-maint-20261126b";
  try { if (sessionStorage.getItem(KEY)) return; } catch {}
  let lang = "en";
  try { const s = localStorage.getItem("cdf-lang"); lang = s === "es" || s === "en" ? s : (navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en"; } catch {}
  const txt = lang === "es"
    ? { t: "Mantenimiento por mejoras", b: "Estamos preparando una versi?n nueva de la app. Puedes seguir trabajando con normalidad; si algo no carga, espera un momento y recarga.", c: "Entendido" }
    : { t: "Maintenance for improvements", b: "We are preparing a new version of the app. You can keep working as usual; if something does not load, wait a moment and reload.", c: "Got it" };
  const css = document.createElement("style");
  css.textContent = `
.maint{position:fixed;z-index:9999;left:50%;bottom:16px;transform:translate(-50%,12px);opacity:0;width:min(520px,calc(100vw - 24px));
display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--surface,#fff);color:var(--fg,#171717);
border:1px solid var(--line,#ddd);border-inline-start:4px solid var(--primary,#e7b10a);box-shadow:0 10px 30px rgba(0,0,0,.18);
transition:opacity .25s ease,transform .25s ease;font:inherit}
.maint.on{opacity:1;transform:translate(-50%,0)}
.maint b{display:block;margin-bottom:2px}
.maint p{margin:0;font-size:.92em;line-height:1.4}
.maint button{flex:none;align-self:center;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line,#ddd);background:transparent;color:inherit;font:inherit;cursor:pointer}
@media (max-width:560px){.maint{bottom:calc(72px + env(safe-area-inset-bottom))}}`;
  const box = document.createElement("div");
  box.className = "maint"; box.setAttribute("role", "status");
  const body = document.createElement("div");
  const title = document.createElement("b"); title.textContent = txt.t;
  const p = document.createElement("p"); p.textContent = txt.b;
  body.append(title, p);
  const btn = document.createElement("button"); btn.type = "button"; btn.textContent = txt.c;
  btn.onclick = () => { try { sessionStorage.setItem(KEY, "1"); } catch {} box.classList.remove("on"); setTimeout(() => box.remove(), 260); };
  box.append(body, btn);
  const show = () => { document.head.append(css); document.body.append(box); requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("on"))); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", show) : show();
})();
