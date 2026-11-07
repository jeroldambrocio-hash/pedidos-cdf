// Team chat: a conversation inside each order (seen by whoever can see that order) and a #equipo channel.
// Tables: cdf_messages (order_id null = #equipo) and cdf_message_reads (how far each person has read each thread).
// If those tables don't exist yet, everything here stays hidden and the rest of the app works as before.
const TEAM = "team";
const CH = { on: false, msgs: [], reads: new Map(), open: null, views: new Set(), channel: null, info: new Map() };
const threadOf = (m) => m.order_id || TEAM;
const msgOrder = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
const manilaDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const clock = (ts) => new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const person = (email) => S.members.find((m) => m.email === email) || { email, name: email?.split("@")[0] || "?" };

async function loadChat() {
  const [m, r] = await Promise.all([
    sb.from("cdf_messages").select("*").order("created_at").limit(2000),
    sb.from("cdf_message_reads").select("*").eq("member_email", S.me.email),
  ]);
  CH.on = !m.error && !r.error;
  $("tabChat").hidden = !CH.on;
  if (!CH.on) return;
  CH.msgs = (m.data || []).sort(msgOrder);
  CH.reads = new Map((r.data || []).map((x) => [x.thread, x.last_read_at]));
  // Florists and drivers cannot read the team table; the directory gives them names and photos for the chat
  if (!isStaff()) { const { data } = await sb.rpc("cdf_team_directory"); if (Array.isArray(data)) S.members = data; }
  chatSubscribe();
  paintChatCounts();
  render(); // the order cards were drawn before the chat loaded: now with their 💬 chips
}
function chatSubscribe() {
  if (CH.channel) sb.removeChannel(CH.channel);
  CH.channel = sb.channel("cdf-chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "cdf_messages" }, (p) => addMessage(p.new, true)).subscribe();
}
function stopChat() {
  if (CH.channel) sb.removeChannel(CH.channel);
  Object.assign(CH, { on: false, msgs: [], reads: new Map(), open: null, channel: null, info: new Map() });
  CH.views.clear();
  $("tabChat").hidden = true;
}

const unreadIn = (thread) => {
  const read = CH.reads.get(thread) || "";
  return CH.msgs.filter((m) => threadOf(m) === thread && m.author_email !== S.me?.email && m.created_at > read).length;
};
const totalUnread = () => [...new Set(CH.msgs.map(threadOf))].reduce((n, th) => n + unreadIn(th), 0);
function markRead(thread) {
  if (!CH.on || !unreadIn(thread)) return;
  const now = new Date().toISOString();
  CH.reads.set(thread, now);
  sb.from("cdf_message_reads").upsert({ member_email: S.me.email, thread, last_read_at: now }, { onConflict: "member_email,thread" }).then(() => {});
  paintChatCounts();
}

// A message from realtime or from our own send; the same one twice is ignored.
function addMessage(m, live) {
  if (!CH.on || !m?.id || CH.msgs.some((x) => x.id === m.id)) return;
  CH.msgs.push(m); CH.msgs.sort(msgOrder);
  const th = threadOf(m), seen = [...CH.views].some((v) => v.thread === th && v.node.isConnected) && document.visibilityState === "visible";
  refreshViews(th);
  if (seen) markRead(th);
  else if (live && m.author_email !== S.me.email && mentionsMe(m.body)) {
    toast(t("chatMentioned", { name: person(m.author_email).name, where: threadTitle(th) }), { type: "info", ms: 9000, action: t("chatSee"), onAction: () => openThread(th) });
  }
  paintChatCounts();
}
async function sendMessage(thread, body) {
  const { data, error } = await sb.from("cdf_messages").insert({ order_id: thread === TEAM ? null : thread, author_email: S.me.email, body }).select().single();
  if (error || !data) throw new Error(t("chatFail"));
  addMessage(data, false);
  CH.reads.set(thread, data.created_at);
  sb.from("cdf_message_reads").upsert({ member_email: S.me.email, thread, last_read_at: data.created_at }, { onConflict: "member_email,thread" }).then(() => {});
  paintChatCounts();
}

// ---------- mentions ----------
const handleOf = (m) => (m.name || "").trim().split(/\s+/)[0];
const mentionsMe = (body) => { const h = handleOf(S.me || {}).toLowerCase(); return !!h && new RegExp("(^|\\s)@" + h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(body || ""); };
// #0126 in a message is a link to that order. Known orders open at once; others are looked up by number
// (the order's own security decides whether you may open it).
const orderByNum = (num) => S.orders.find((o) => o.num === num) || [...CH.info.values()].find((o) => o.num === num) || null;
async function openOrderNum(num) {
  let o = orderByNum(num);
  if (!o) { const { data } = await sb.from("cdf_orders").select("*").eq("num", num).maybeSingle(); o = data; }
  if (o) openOrder(o); else toast(t("chatNoOrder", { num }), { type: "error" });
}
// The text as DOM nodes (never HTML): @Name of a team member is highlighted (yours a bit more), #number links to the order.
function messageText(body) {
  const out = [], re = /@([\p{L}\d._-]+)|#(\d{3,6})\b/gu, me = handleOf(S.me || {}).toLowerCase();
  let last = 0, m;
  while ((m = re.exec(body))) {
    let node = null;
    if (m[1]) {
      const who = S.members.find((p) => handleOf(p).toLowerCase() === m[1].toLowerCase() || (p.username || "") === m[1].toLowerCase());
      if (who) node = el("span", { class: "mention" + (m[1].toLowerCase() === me ? " me" : "") }, "@" + handleOf(who));
    } else {
      const num = m[2], o = orderByNum(num);
      node = el("button", { type: "button", class: "order-ref", title: o ? (o.customer_name || t("noName")) + " · " + shortDate(o.date) : t("chatOpenOrder"), onclick: () => openOrderNum(num) }, icon("orders"), "#" + num);
    }
    if (!node) continue;
    out.push(body.slice(last, m.index), node);
    last = m.index + m[0].length;
  }
  out.push(body.slice(last));
  return out.filter((x) => x !== "");
}

// ---------- a thread: the messages and the box to write ----------
function threadView(thread, { autofocus = false } = {}) {
  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": t("chatTitle") });
  const input = el("textarea", { class: "chat-input", rows: 1, placeholder: t("chatPh"), "aria-label": t("chatPh") });
  const send = el("button", { class: "btn primary icon chat-send", type: "button", "aria-label": t("chatSend"), title: t("chatSend"), disabled: true }, icon("arrow"));
  const pop = el("div", { class: "mention-pop", role: "listbox", hidden: true });
  const err = el("div", { class: "err", role: "alert" });
  const node = el("div", { class: "chat", "data-thread": thread }, log, el("div", { class: "chat-compose" }, pop, input, send), err);
  const view = { thread, node, refresh: null };
  let shown = 0, picks = [], pickAt = 0;

  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; send.disabled = !input.value.trim(); };
  function paint(animate) {
    const msgs = CH.msgs.filter((m) => threadOf(m) === thread);
    if (!msgs.length) { log.replaceChildren(el("p", { class: "chat-empty" }, icon("message"), t("chatEmpty"))); shown = 0; return; }
    if (!animate || shown === 0 || msgs.length < shown) { log.replaceChildren(); shown = 0; }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    for (let i = shown; i < msgs.length; i++) {
      const m = msgs[i], prev = msgs[i - 1], day = manilaDay(m.created_at);
      if (!prev || manilaDay(prev.created_at) !== day) log.append(el("div", { class: "chat-day" }, el("span", {}, day === S.today ? t("today") : day === addDays(S.today, -1) ? t("chatYesterday") : shortDate(day))));
      const joined = prev && prev.author_email === m.author_email && manilaDay(prev.created_at) === day && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000;
      const p = person(m.author_email), mine = m.author_email === S.me.email;
      const row = el("div", { class: "cmsg" + (joined ? " joined" : "") + (mine ? " mine" : "") + (!mine && mentionsMe(m.body) ? " for-me" : "") },
        joined ? el("span", { class: "msg-gap" }, el("time", { datetime: m.created_at }, clock(m.created_at))) : avatarNode(p, "avatar msg-pic"),
        el("div", { class: "msg-main" },
          joined ? null : el("div", { class: "msg-head" }, el("b", {}, mine ? t("chatYou") : p.name), el("time", { datetime: m.created_at }, clock(m.created_at))),
          el("p", { class: "msg-body" }, messageText(m.body))));
      if (animate && shown > 0) row.classList.add("msg-in");
      log.append(row);
    }
    shown = msgs.length;
    if (atBottom || !animate) log.scrollTop = log.scrollHeight;
  }
  view.refresh = () => paint(true);

  // Autocomplete: after "@" the team, after "#" the orders (by number or by the recipient's name)
  function updatePop() {
    const upto = input.value.slice(0, input.selectionStart), m = /(^|\s)([@#])([\p{L}\d._-]*)$/u.exec(upto);
    if (!m) { pop.hidden = true; return; }
    const q = m[3].toLowerCase(), kind = m[2];
    picks = kind === "@"
      ? S.members.filter((p) => p.email !== S.me.email && (handleOf(p).toLowerCase().startsWith(q) || (p.name || "").toLowerCase().includes(q))).slice(0, 6).map((p) => ({ kind, p }))
      : S.orders.map((o) => {
          // Best first: number or a word of the name that starts with what was typed, then anything containing it; nearer dates first
          const name = (o.customer_name || "").toLowerCase(), starts = !q || o.num.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
          return { o, rank: starts ? 0 : o.num.includes(q) || name.includes(q) ? 1 : 2, far: Math.abs(new Date(o.date) - new Date(S.today)) };
        }).filter((x) => x.rank < 2).sort((a, b) => a.rank - b.rank || a.far - b.far).slice(0, 6).map(({ o }) => ({ kind, o }));
    if (!picks.length) { pop.hidden = true; return; }
    pickAt = Math.min(pickAt, picks.length - 1);
    pop.replaceChildren(...picks.map((x, i) => el("button", { type: "button", class: "mention-opt", role: "option", "aria-selected": String(i === pickAt), onmousedown: (e) => { e.preventDefault(); choose(x); } },
      ...(x.kind === "@"
        ? [avatarNode(x.p, "avatar xs"), el("b", {}, x.p.name), el("small", {}, t("role_" + x.p.role))]
        : [el("span", { class: "ref-ic" }, icon("orders")), el("b", {}, "#" + x.o.num), el("span", { class: "ref-name" }, x.o.customer_name || t("noName")), el("small", {}, shortDate(x.o.date))]))));
    pop.hidden = false;
  }
  function choose(x) {
    const token = x.kind === "@" ? "@" + handleOf(x.p) : "#" + x.o.num;
    const pos = input.selectionStart, upto = input.value.slice(0, pos).replace(/[@#]([\p{L}\d._-]*)$/u, token + " ");
    input.value = upto + input.value.slice(pos); input.setSelectionRange(upto.length, upto.length);
    pop.hidden = true; pickAt = 0; grow(); input.focus();
  }
  async function submit() {
    const body = input.value.trim(); if (!body) return;
    send.disabled = true; err.textContent = "";
    try { await sendMessage(thread, body); input.value = ""; grow(); pop.hidden = true; }
    catch (e) { err.textContent = e.message; send.disabled = false; }
    input.focus();
  }
  input.addEventListener("input", () => { grow(); updatePop(); });
  input.addEventListener("click", updatePop);
  input.addEventListener("blur", () => setTimeout(() => (pop.hidden = true), 120));
  input.addEventListener("keydown", (e) => {
    if (!pop.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); pickAt = (pickAt + (e.key === "ArrowDown" ? 1 : picks.length - 1)) % picks.length; updatePop(); return; }
    if (!pop.hidden && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); choose(picks[pickAt]); return; }
    if (!pop.hidden && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); pop.hidden = true; return; }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  send.addEventListener("click", submit);

  CH.views.add(view);
  paint(false);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; if (autofocus) input.focus({ preventScroll: true }); });
  markRead(thread);
  return node;
}
function refreshViews(thread) {
  for (const v of [...CH.views]) { if (!v.node.isConnected) { CH.views.delete(v); continue; } if (v.thread === thread) v.refresh(); }
  if (S.tab === "chat") renderChatList();
}

// The conversation section inside an order sheet
const chatSection = (o) => (CH.on && o?.id ? el("section", { class: "chat-sec", id: "chatSection" }, el("h3", {}, icon("message"), t("chatTitle")), threadView(o.id)) : null);
// The 💬 chip on order cards: how many messages, and the unread ones highlighted
function chatChip(o) {
  if (!CH.on) return null;
  const n = CH.msgs.filter((m) => m.order_id === o.id).length; if (!n) return null;
  const u = unreadIn(o.id);
  return el("button", { class: "chat-chip" + (u ? " unread" : ""), type: "button", "data-chat": o.id, title: u ? t("chatUnread", { n: u }) : t("chatCount", { n }), "aria-label": (u ? t("chatUnread", { n: u }) : t("chatCount", { n })) + " · #" + o.num,
    onclick: async (e) => { e.stopPropagation(); await openFresh(o); document.querySelector(".sheet #chatSection")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }); document.querySelector(".sheet #chatSection .chat-input")?.focus({ preventScroll: true }); } },
    icon("message"), el("span", {}, String(u || n)));
}
// Counters on the side bar and the phone header; chips on the cards are redrawn with the list
function paintChatCounts() {
  const n = CH.on ? totalUnread() : 0, tab = $("tabChat");
  let c = tab.querySelector(".rail-count");
  if (!c) { c = el("span", { class: "rail-count", "aria-hidden": "true" }); tab.append(c); }
  const before = c.textContent;
  c.textContent = n > 99 ? "99+" : n ? String(n) : "";
  c.hidden = !n;
  if (n && before !== c.textContent) bump(c);
  tab.setAttribute("aria-label", t("tabChat") + (n ? " · " + t("chatUnread", { n }) : ""));
  $("navOpen")?.classList.toggle("has-unread", !!n);
  for (const chip of document.querySelectorAll(".chat-chip[data-chat]")) {
    const o = byId(chip.dataset.chat); if (o) chip.replaceWith(chatChip(o) || el("span"));
  }
  if (S.tab === "chat") renderChatList();
}

// ---------- the Conversations page ----------
function threadTitle(th) {
  if (th === TEAM) return "#" + t("chatTeam");
  const o = byId(th) || CH.info.get(th);
  return o ? "#" + o.num + " · " + (o.customer_name || t("noName")) : "#…";
}
async function loadThreadInfo(ids) {
  const miss = ids.filter((id) => id !== TEAM && !byId(id) && !CH.info.has(id));
  if (!miss.length) return;
  const { data } = await sb.from("cdf_orders").select("id,num,customer_name,status,delivery,date,channel").in("id", miss);
  for (const o of data || []) CH.info.set(o.id, o);
  if (S.tab === "chat") renderChatList();
}
function threads() {
  const last = new Map();
  for (const m of CH.msgs) last.set(threadOf(m), m);
  const list = [...last.entries()].filter(([th]) => th !== TEAM).sort((a, b) => msgOrder(b[1], a[1]));
  return [[TEAM, last.get(TEAM) || null], ...list];
}
function renderChat() {
  if (!CH.on) return;
  if (!CH.open && !matchMedia("(max-width: 860px)").matches) CH.open = TEAM;
  renderChatList();
  // Any app refresh lands here: keep the open thread (and whatever is being typed) unless another one was picked
  const pane = $("chatPane");
  if (pane.dataset.thread !== String(CH.open) || !pane.querySelector(".chat, .chat-empty")) renderChatPane();
}
function renderChatList() {
  const box = $("chatList"); if (!box) return;
  const ts = threads();
  loadThreadInfo(ts.map(([th]) => th));
  box.replaceChildren(...ts.map(([th, m]) => {
    const u = unreadIn(th), team = th === TEAM, p = m ? person(m.author_email) : null;
    const o = team ? null : byId(th) || CH.info.get(th);
    return el("button", { type: "button", class: "thread" + (CH.open === th ? " on" : "") + (u ? " unread" : ""), "aria-current": CH.open === th ? "true" : "false", onclick: () => openThread(th) },
      el("span", { class: "thread-ic" + (team ? " team" : "") }, team ? "#" : o?.channel && CHANNELS.includes(o.channel) ? el("span", { class: "chan-logo sm", style: "--cc:" + chanColor(o.channel) }, chanMark(o.channel)) : icon("orders")),
      el("span", { class: "thread-main" },
        el("span", { class: "thread-top" }, el("b", {}, threadTitle(th)), m ? el("time", {}, manilaDay(m.created_at) === S.today ? clock(m.created_at) : shortDate(manilaDay(m.created_at))) : null),
        el("small", {}, m ? (m.author_email === S.me.email ? t("chatYou") : p.name) + ": " + m.body : t("chatTeamDesc"))),
      u ? el("span", { class: "thread-count" }, String(u)) : null);
  }));
}
function renderChatPane() {
  const pane = $("chatPane"), th = CH.open;
  pane.dataset.thread = String(th);
  $("chatView").dataset.pane = th ? "thread" : "list";
  if (!th) { pane.replaceChildren(el("p", { class: "chat-empty" }, icon("message"), t("chatPick"))); return; }
  const o = th === TEAM ? null : byId(th) || CH.info.get(th);
  const head = el("div", { class: "chat-head" },
    el("button", { class: "btn icon ghost chat-back", type: "button", "aria-label": t("chatBack"), onclick: () => { CH.open = null; renderChat(); } }, icon("left")),
    el("div", {}, el("b", {}, threadTitle(th)), el("small", {}, th === TEAM ? t("chatTeamDesc") : o ? longDate(o.date) + (o.slot ? " · " + o.slot : "") : "")),
    el("span", { class: "spacer" }),
    o ? el("button", { class: "btn", type: "button", onclick: () => openOrder(byId(th) || o) }, t("chatOpenOrder")) : null);
  pane.replaceChildren(head, threadView(th, { autofocus: !matchMedia("(pointer: coarse)").matches }));
  pane.classList.remove("pane-in"); void pane.offsetWidth; pane.classList.add("pane-in");
}
function openThread(th) {
  CH.open = th;
  if (S.tab !== "chat") setTab("chat"); else { renderChatList(); renderChatPane(); }
}
