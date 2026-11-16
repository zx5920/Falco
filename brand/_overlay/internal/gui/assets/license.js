// Kestrel activation: seven days from the first run, then an offline code
// signed by the publisher and bound to this machine. This file draws the
// gate, the Settings › About row and the trial reminder, and talks to
// /api/license (see internal/gui/license_api.go). It is part of the brand
// layer, not upstream.
(() => {
  "use strict";

  const zh = (window.bootPrefs?.lang || document.documentElement.lang || navigator.language || "")
    .toLowerCase().startsWith("zh");

  const S = zh ? {
    license: "授权",
    trial: "试用中",
    trialDays: "剩余 {n} 天",
    trialEnded: "试用已结束",
    activated: "已激活",
    licensedTo: "授权给 {name}",
    expires: "{date} 到期",
    perpetual: "永久授权",
    activate: "激活",
    change: "更换",
    machine: "机器码",
    copy: "复制",
    copied: "已复制",
    gateTrialTitle: "试用已结束",
    gateLicenseTitle: "激活码已失效",
    gateTrialSub: "输入这台机器的激活码，即可继续使用 Kestrel。",
    gateLicenseSub: "当前激活码在这台机器上已失效，请输入新的激活码。",
    gateTrialFoot: "七天试用已用完 · 离线校验 · 与这台机器绑定",
    gateLicenseFoot: "离线校验 · 激活码与这台机器绑定",
    codeLabel: "激活码",
    codePlaceholder: "粘贴激活码（KESTREL1 开头）",
    activating: "正在激活…",
    needCode: "请输入激活码。",
    badCode: "这个激活码无效。",
    otherMachine: "这个激活码是给另一台机器签发的。",
    expiredCode: "这个激活码已经过期。",
    success: "激活成功",
    dialogTitle: "激活 Kestrel",
    dialogTrialSub: "试用剩余 {n} 天。现在激活，试用结束后无需中断。",
    dialogActiveSub: "这台机器已激活{name}。",
    close: "关闭",
    quit: "退出 Kestrel",
    banner: "试用剩余 {n} 天",
    bannerAct: "立即激活",
  } : {
    license: "License",
    trial: "Trial",
    trialDays: "{n} days left",
    trialEnded: "Trial ended",
    activated: "Activated",
    licensedTo: "Licensed to {name}",
    expires: "expires {date}",
    perpetual: "perpetual",
    activate: "Activate",
    change: "Change",
    machine: "Machine code",
    copy: "Copy",
    copied: "Copied",
    gateTrialTitle: "Your trial has ended",
    gateLicenseTitle: "Your activation has expired",
    gateTrialSub: "Enter the activation code for this machine to keep using Kestrel.",
    gateLicenseSub: "The code on this copy is no longer valid. Enter a new activation code to continue.",
    gateTrialFoot: "The seven-day trial is used up · offline check · bound to this machine",
    gateLicenseFoot: "Offline check · the code is bound to this machine",
    codeLabel: "Activation code",
    codePlaceholder: "Paste your activation code (starts with KESTREL1)",
    activating: "Activating…",
    needCode: "Enter an activation code.",
    badCode: "That activation code is not valid.",
    otherMachine: "That code was issued for a different machine.",
    expiredCode: "That activation code has expired.",
    success: "Activated",
    dialogTitle: "Activate Kestrel",
    dialogTrialSub: "{n} days of trial left. Activate now so nothing stops when they end.",
    dialogActiveSub: "This machine is activated{name}.",
    close: "Close",
    quit: "Quit Kestrel",
    banner: "{n} days of trial left",
    bannerAct: "Activate now",
  };

  let state = null;
  let gate = null;
  let dialog = null;
  let banner = null;
  let toastEl = null;
  let toastTimer = 0;
  let blockKeys = null;

  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---- the API ------------------------------------------------------------

  async function call(path, body) {
    const res = await fetch("/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    let data = {};
    try { data = await res.json(); } catch { /* an empty answer */ }
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  function failText(msg) {
    return {
      "enter an activation code": S.needCode,
      "invalid activation code": S.badCode,
      "this activation code was issued for a different machine": S.otherMachine,
      "this activation code has expired": S.expiredCode,
    }[msg] || msg || S.badCode;
  }

  // ---- styles -------------------------------------------------------------

  const CSS = `
.kl-gate, .kl-dialog { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; padding: 24px; }
.kl-gate { background: var(--bg); }
.kl-gate::before { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(54% 48% at 50% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 72%); }
.kl-dialog { background: rgba(12, 12, 16, .46); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.kl-card { position: relative; width: min(480px, 100%); max-height: calc(100vh - 48px); overflow: auto; box-sizing: border-box;
  padding: 30px 30px 24px; border-radius: 20px; background: var(--card); color: var(--fg);
  border: 1px solid var(--line); box-shadow: var(--shadow); animation: kl-in .26s cubic-bezier(.2,.8,.2,1); }
@keyframes kl-in { from { opacity: 0; transform: translateY(8px) scale(.985); } }
:root[data-motion="reduce"] .kl-card { animation: none; }
@media (prefers-reduced-motion: reduce) { .kl-card { animation: none; } }
.kl-top { display: flex; align-items: center; gap: 10px; }
.kl-mark { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; color: var(--accent);
  background: var(--accent-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent); }
.kl-brand { display: flex; flex-direction: column; line-height: 1.15; }
.kl-brand b { font-size: 15px; font-weight: 650; letter-spacing: .01em; }
.kl-brand span { font-size: 10.5px; font-weight: 600; letter-spacing: .14em; color: var(--muted); text-transform: uppercase; }
.kl-close { margin-left: auto; }
.kl-title { margin: 22px 0 0; font-size: 22px; line-height: 1.25; font-weight: 650; letter-spacing: -.012em; }
.kl-sub { margin: 8px 0 0; font-size: 13.5px; line-height: 1.55; color: var(--fg-2); }
.kl-label { display: block; margin: 22px 0 7px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; color: var(--muted); text-transform: uppercase; }
.kl-machine { display: flex; align-items: center; gap: 8px; box-sizing: border-box; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card-2); }
.kl-machine code { flex: 1; font-family: var(--code); font-size: 14.5px; letter-spacing: .08em; color: var(--fg); user-select: text; }
.kl-card textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 74px; padding: 11px 12px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--card-2); color: var(--fg);
  font-family: var(--code); font-size: 12.5px; line-height: 1.5; outline: none; }
.kl-card textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.kl-card textarea::placeholder { color: var(--faint); font-family: var(--font); font-size: 13px; }
.kl-err { margin: 10px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--red); }
.kl-primary { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin: 16px 0 0;
  padding: 11px 16px; border: 0; border-radius: 10px; background: var(--accent); color: var(--accent-fg);
  font-family: var(--font); font-size: 13.5px; font-weight: 650; cursor: pointer; }
.kl-primary:hover { filter: brightness(1.05); }
.kl-primary:disabled { opacity: .62; cursor: default; }
.kl-primary .kl-spin { width: 13px; height: 13px; border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 50%; animation: kl-spin .8s linear infinite; }
@keyframes kl-spin { to { transform: rotate(360deg); } }
.kl-foot { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 14px 0 0;
  font-size: 11.5px; line-height: 1.4; color: var(--muted); text-align: center; }
.kl-quit { margin-left: auto; font-size: 12px; }
.kl-banner { position: fixed; top: 60px; left: 50%; z-index: 2147482000; display: flex; align-items: center; gap: 10px;
  transform: translateX(-50%); box-sizing: border-box; max-width: calc(100vw - 32px); padding: 8px 10px 8px 14px;
  border: 1px solid var(--line); border-radius: 999px; background: var(--pop-bg); color: var(--fg-2);
  box-shadow: var(--shadow); font-size: 12.5px; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.kl-banner b { color: var(--fg); font-weight: 600; }
.kl-banner button { border: 0; border-radius: 999px; padding: 5px 11px; background: var(--accent); color: var(--accent-fg);
  font-family: var(--font); font-size: 12px; font-weight: 600; cursor: pointer; }
.kl-banner .kl-x { padding: 4px 7px; background: transparent; color: var(--muted); }
.kl-toast { position: fixed; left: 50%; bottom: 26px; z-index: 2147483001; transform: translateX(-50%);
  padding: 9px 16px; border-radius: 10px; background: var(--fg); color: var(--bg); font-size: 12.5px; font-weight: 550;
  box-shadow: var(--shadow); animation: kl-in .2s ease-out; }
body.kl-gated { overflow: hidden; }
`;

  function styles() {
    if (document.getElementById("license-style")) return;
    const s = h("style");
    s.id = "license-style";
    s.textContent = CSS;
    document.head.append(s);
  }

  // ---- shared pieces ------------------------------------------------------

  function mark() {
    const box = h("span", "kl-mark");
    box.innerHTML = '<svg viewBox="0 0 44 44" width="21" height="21" aria-hidden="true">' +
      '<path fill="currentColor" fill-rule="evenodd" d="M8 6L15.5 6L15.5 38L8 38ZM16.5 21L23.5 21L40 6L33 6ZM16.5 23L23.5 23L40 38L33 38Z"/></svg>';
    return box;
  }

  function top(withClose) {
    const t = h("div", "kl-top");
    const brand = h("div", "kl-brand");
    brand.append(h("b", "", "Kestrel"), h("span", "", "Activation"));
    t.append(mark(), brand);
    if (withClose) {
      const x = h("button", "icon kl-close", "×");
      x.type = "button";
      x.title = S.close;
      x.setAttribute("aria-label", S.close);
      x.onclick = closeDialog;
      t.append(x);
    } else {
      const quit = h("button", "text kl-quit", S.quit);
      quit.type = "button";
      quit.onclick = () => { fetch("/api/quit").catch(() => {}); };
      t.append(quit);
    }
    return t;
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
    const was = btn.textContent;
    btn.textContent = S.copied;
    setTimeout(() => { btn.textContent = was; }, 1200);
  }

  function machineBox() {
    const wrap = h("div");
    const label = h("div", "kl-label", S.machine);
    const box = h("div", "kl-machine");
    const code = h("code", "", state?.machine || "—");
    const copy = h("button", "text", S.copy);
    copy.type = "button";
    copy.onclick = () => copyText(code.textContent, copy);
    box.append(code, copy);
    wrap.append(label, box);
    return wrap;
  }

  function codeField() {
    const wrap = h("div");
    const label = h("label", "kl-label", S.codeLabel);
    const ta = h("textarea");
    ta.id = "kl-code";
    ta.rows = 3;
    ta.spellcheck = false;
    ta.autocomplete = "off";
    ta.placeholder = S.codePlaceholder;
    wrap.append(label, ta);
    return { wrap, ta };
  }

  function errorLine() {
    const e = h("div", "kl-err");
    e.setAttribute("role", "alert");
    e.hidden = true;
    return e;
  }

  function primary(text) {
    const b = h("button", "kl-primary");
    b.type = "button";
    b.textContent = text;
    return b;
  }

  async function submitCode(ta, err, btn) {
    const code = ta.value.trim();
    if (!code) {
      err.textContent = S.needCode;
      err.hidden = false;
      ta.focus();
      return;
    }
    const label = btn.textContent;
    btn.disabled = true;
    btn.replaceChildren(h("span", "kl-spin"), document.createTextNode(S.activating));
    err.hidden = true;
    try {
      state = await call("license/activate", { key: code });
      hideGate();
      closeDialog();
      hideBanner();
      renderAbout();
      toast(S.success);
    } catch (ex) {
      err.textContent = failText(ex.message);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = label;
      ta.focus();
    }
  }

  function toast(text) {
    toastEl?.remove();
    toastEl = h("div", "kl-toast", text);
    toastEl.setAttribute("role", "status");
    document.body.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl?.remove(); toastEl = null; }, 2400);
  }

  // ---- the blocking gate --------------------------------------------------

  function showGate() {
    if (gate) return;
    styles();
    gate = h("div", "kl-gate");
    gate.setAttribute("role", "dialog");
    gate.setAttribute("aria-modal", "true");
    gate.setAttribute("aria-labelledby", "kl-title");

    const card = h("div", "kl-card");
    card.append(top(false));
    const trial = state?.reason !== "license";
    const title = h("h2", "kl-title", trial ? S.gateTrialTitle : S.gateLicenseTitle);
    title.id = "kl-title";
    card.append(title, h("p", "kl-sub", trial ? S.gateTrialSub : S.gateLicenseSub));
    card.append(machineBox());

    const { wrap, ta } = codeField();
    card.append(wrap);
    const err = errorLine();
    const btn = primary(S.activate);
    btn.onclick = () => submitCode(ta, err, btn);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitCode(ta, err, btn); }
    });
    card.append(err, btn, h("div", "kl-foot", trial ? S.gateTrialFoot : S.gateLicenseFoot));

    gate.append(card);
    document.body.append(gate);
    document.body.classList.add("kl-gated");
    blockKeys = (e) => {
      if (!gate) return;
      if (gate.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener("keydown", blockKeys, true);
    setTimeout(() => ta.focus(), 30);
  }

  function hideGate() {
    if (!gate) return;
    document.removeEventListener("keydown", blockKeys, true);
    blockKeys = null;
    gate.remove();
    gate = null;
    document.body.classList.remove("kl-gated");
  }

  // ---- the activation dialog (a trial, or Change in About) ----------------

  function openDialog() {
    if (dialog || gate) return;
    styles();
    dialog = h("div", "kl-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "kl-dialog-title");

    const card = h("div", "kl-card");
    card.append(top(true));
    const title = h("h2", "kl-title", S.dialogTitle);
    title.id = "kl-dialog-title";
    card.append(title);
    const sub = state?.status === "trial"
      ? S.dialogTrialSub.replace("{n}", state.daysLeft)
      : state?.status === "active"
        ? S.dialogActiveSub.replace("{name}", state.licensedTo ? " · " + S.licensedTo.replace("{name}", state.licensedTo) : "")
        : S.gateLicenseSub;
    card.append(h("p", "kl-sub", sub));
    card.append(machineBox());

    const { wrap, ta } = codeField();
    card.append(wrap);
    const err = errorLine();
    const btn = primary(S.activate);
    btn.onclick = () => submitCode(ta, err, btn);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitCode(ta, err, btn); }
    });
    card.append(err, btn, h("div", "kl-foot", S.gateLicenseFoot));

    dialog.append(card);
    dialog.addEventListener("mousedown", (e) => { if (e.target === dialog) closeDialog(); });
    document.body.append(dialog);
    setTimeout(() => ta.focus(), 30);
  }

  function closeDialog() {
    dialog?.remove();
    dialog = null;
  }

  // ---- Settings › About ---------------------------------------------------

  function aboutRow() {
    const row = h("div", "row pref");
    row.id = "licenseRow";
    const who = h("div", "who");
    who.append(h("div", "name", S.license));
    const sub = h("div", "sub");
    who.append(sub);
    const val = h("div", "val");

    if (state?.status === "active") {
      let line = S.activated;
      if (state.licensedTo) line += " · " + S.licensedTo.replace("{name}", state.licensedTo);
      line += " · " + (state.expires ? S.expires.replace("{date}", state.expires) : S.perpetual);
      sub.textContent = line;
      const change = h("button", "text", S.change);
      change.type = "button";
      change.onclick = openDialog;
      val.append(change);
    } else if (state?.status === "trial") {
      sub.textContent = S.trial + " · " + S.trialDays.replace("{n}", state.daysLeft);
      const act = h("button", "text", S.activate);
      act.type = "button";
      act.onclick = openDialog;
      val.append(act);
    } else {
      sub.textContent = S.trialEnded;
      const act = h("button", "text", S.activate);
      act.type = "button";
      act.onclick = state ? showGate : openDialog;
      val.append(act);
    }

    const code = h("code", "", state?.machine || "—");
    const copy = h("button", "text", S.copy);
    copy.type = "button";
    copy.onclick = () => copyText(code.textContent, copy);
    val.prepend(code, copy);
    row.append(who, val);
    return row;
  }

  function renderAbout() {
    const about = document.getElementById("about");
    if (!about || !state) return;
    about.querySelector("#licenseRow")?.remove();
    about.append(aboutRow());
  }

  function watchAbout() {
    const about = document.getElementById("about");
    if (!about) return;
    new MutationObserver(() => {
      if (state && !about.querySelector("#licenseRow")) renderAbout();
    }).observe(about, { childList: true });
  }

  // ---- the trial reminder -------------------------------------------------

  const DISMISS = "kestrel.license.bannerOff";
  const today = () => new Date().toISOString().slice(0, 10);

  function showBanner() {
    if (banner) return;
    try { if (localStorage.getItem(DISMISS) === today()) return; } catch { /* none kept */ }
    styles();
    banner = h("div", "kl-banner");
    banner.setAttribute("role", "status");
    banner.append(h("b", "", "Kestrel"), document.createTextNode(S.banner.replace("{n}", state.daysLeft)));
    const act = h("button", "", S.bannerAct);
    act.type = "button";
    act.onclick = () => { hideBanner(); openDialog(); };
    const x = h("button", "kl-x", "×");
    x.type = "button";
    x.title = S.close;
    x.setAttribute("aria-label", S.close);
    x.onclick = () => {
      hideBanner();
      try { localStorage.setItem(DISMISS, today()); } catch { /* none kept */ }
    };
    banner.append(act, x);
    document.body.append(banner);
  }

  function hideBanner() {
    banner?.remove();
    banner = null;
  }

  // ---- start --------------------------------------------------------------

  function paint() {
    if (!state) return;
    if (state.status === "expired") {
      closeDialog();
      hideBanner();
      showGate();
    } else {
      hideGate();
      if (state.status === "trial" && state.daysLeft <= 2) showBanner();
      else hideBanner();
    }
    renderAbout();
  }

  async function refresh() {
    try {
      state = await call("license");
    } catch {
      return; // the API is unreachable: leave the page as it is
    }
    paint();
  }

  watchAbout();
  refresh();
  // a copy left open past the trial's end asks for a code without a restart
  setInterval(refresh, 15 * 60 * 1000);
})();
