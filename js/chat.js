// Order chats and #team use cdf_messages. Private conversations use separate participant-scoped tables.
const TEAM = "team";
const CH = { on: false, reactOn: false, directOn: false, directs: new Map(), msgs: [], reads: new Map(), reacts: new Map(), typing: new Map(), open: null, views: new Set(), channel: null, info: new Map(), q: "", filter: "all", sentTyping: 0 };
const threadOf = (m) => m.direct_id || m.order_id || TEAM;
const msgOrder = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
const manilaDay = (ts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const clock = (ts) => new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const person = (email) => S.members.find((m) => m.email === email) || { email, name: email?.split("@")[0] || "?" };
const coarse = () => matchMedia("(pointer: coarse)").matches;

async function loadChat() {
  const [m, r, x, d, dm] = await Promise.all([
    sb.from("cdf_messages").select("*").order("created_at", { ascending: false }).limit(2000),
    sb.from("cdf_message_reads").select("*").eq("member_email", S.me.email),
    sb.from("cdf_message_reactions").select("*").limit(5000),
    sb.from("cdf_direct_threads").select("*"),
    sb.from("cdf_direct_messages").select("*").order("created_at", { ascending: false }).limit(2000),
  ]);
  CH.on = !m.error && !r.error;
  $("tabChat").hidden = !CH.on;
  if (!CH.on) return;
  CH.reactOn = !x.error;
  CH.directOn = !d.error && !dm.error;
  CH.directs = new Map((d.data || []).map((thread) => [thread.id, thread]));
  CH.msgs = [...(m.data || []), ...(CH.directOn ? dm.data || [] : [])].sort(msgOrder);
  CH.reads = new Map((r.data || []).map((y) => [y.thread, y.last_read_at]));
  CH.reacts = new Map();
  for (const y of x.data || []) CH.reacts.set(y.message_id, [...(CH.reacts.get(y.message_id) || []), y]);
  // Florists and drivers cannot read the team table; the directory gives them names and photos for the chat
  if (!isStaff()) { const { data } = await sb.rpc("cdf_team_directory"); if (Array.isArray(data)) S.members = data; }
  chatSubscribe();
  paintChatCounts();
  render(); // the order cards were drawn before the chat loaded: now with their 💬 chips
}
function chatSubscribe() {
  if (CH.channel) sb.removeChannel(CH.channel);
  let ch = sb.channel("cdf-chat")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cdf_messages" }, (p) => addMessage(p.new, true))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cdf_messages" }, (p) => updateMessage(p.new))
    .on("broadcast", { event: "typing" }, (p) => onTyping(p.payload || p));
  if (CH.reactOn) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "cdf_message_reactions" }, onReactChange);
  if (CH.directOn) ch = ch
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cdf_direct_threads" }, (p) => {
      CH.directs.set(p.new.id, p.new);
      if (S.tab === "chat") renderChatList();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "cdf_direct_messages" }, (p) => receiveDirect(p.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "cdf_direct_messages" }, (p) => updateMessage(p.new));
  CH.channel = ch.subscribe();
}
function stopChat() {
  if (CH.channel) sb.removeChannel(CH.channel);
  Object.assign(CH, { on: false, reactOn: false, msgs: [], reads: new Map(), reacts: new Map(), typing: new Map(), open: null, channel: null, info: new Map(), q: "", filter: "all" });
  CH.views.clear();
  CH.directOn = false;
  CH.directs.clear();
  $("chatList").replaceChildren();
  $("chatPane").replaceChildren();
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
  const th = threadOf(m);
  CH.typing.get(th)?.delete(m.author_email); // whoever was typing just sent it
  const seen = [...CH.views].some((v) => v.thread === th && v.node.isConnected) && document.visibilityState === "visible";
  refreshViews(th);
  if (seen) markRead(th);
  else if (live && m.author_email !== S.me.email && (m.direct_id || mentionsMe(m.body))) {
    toast(t("chatMentioned", { name: person(m.author_email).name, where: threadTitle(th) }), { type: "info", ms: 9000, action: t("chatSee"), onAction: () => openThread(th) });
  }
  paintChatCounts();
}
async function sendMessage(thread, body) {
  const direct = CH.directs.has(thread);
  const target = direct ? { direct_id: thread } : { order_id: thread === TEAM ? null : thread };
  const { data, error } = await sb.from(direct ? "cdf_direct_messages" : "cdf_messages")
    .insert({ ...target, author_email: S.me.email, body }).select().single();
  if (error || !data) throw new Error(t("chatFail"));
  addMessage(data, false);
  CH.reads.set(thread, data.created_at);
  sb.from("cdf_message_reads").upsert({ member_email: S.me.email, thread, last_read_at: data.created_at }, { onConflict: "member_email,thread" }).then(() => {});
  paintChatCounts();
}
function updateMessage(message) {
  const i = CH.msgs.findIndex((m) => m.id === message.id && threadOf(m) === threadOf(message));
  if (i < 0 || !message.edited_at || (CH.msgs[i].edited_at || "") >= message.edited_at) return;
  CH.msgs[i] = message;
  for (const view of CH.views) {
    if (view.node.isConnected && view.thread === threadOf(message)) view.edit(message);
  }
  if (S.tab === "chat") renderChatList();
}
async function saveMessageEdit(message, body) {
  const table = message.direct_id ? "cdf_direct_messages" : "cdf_messages";
  const request = sb.from(table).update({ body }).eq("id", message.id);
  const unchanged = message.edited_at ? request.eq("edited_at", message.edited_at) : request.is("edited_at", null);
  const { data, error } = await unchanged.select().maybeSingle();
  if (error || !data) throw new Error(t("chatEditFail"));
  return data;
}

// ---------- "is typing…" (a broadcast, nothing is stored) ----------
function sendTyping(thread) {
  if (!CH.channel || CH.directs.has(thread) || Date.now() - CH.sentTyping < 2500) return;
  CH.sentTyping = Date.now();
  CH.channel.send?.({ type: "broadcast", event: "typing", payload: { thread, email: S.me.email } })?.catch?.(() => {});
}
function onTyping(p) {
  if (!p?.thread || !p.email || p.email === S.me?.email) return;
  if (!CH.typing.has(p.thread)) CH.typing.set(p.thread, new Map());
  CH.typing.get(p.thread).set(p.email, Date.now() + 4000);
  paintTyping(p.thread);
  setTimeout(() => paintTyping(p.thread), 4100);
}
function typingText(thread) {
  const now = Date.now(), who = [...(CH.typing.get(thread) || new Map())].filter(([, until]) => until > now).map(([e]) => person(e).name);
  return !who.length ? "" : who.length === 1 ? t("chatTyping", { name: who[0] }) : t("chatTypingMany");
}
function paintTyping(thread) {
  for (const v of CH.views) if (v.thread === thread && v.node.isConnected) v.typing();
  if (S.tab === "chat") renderChatList(); // the list shows it too, in place of the last message
}

// ---------- reactions ----------
const QUICK = ["👍", "✅", "❤️", "😂", "🎉", "🙏"];
const reactsOf = (id) => CH.reacts.get(id) || [];
function applyReact(r, on) {
  if (!r?.message_id) return;
  const list = reactsOf(r.message_id).filter((x) => !(x.member_email === r.member_email && x.emoji === r.emoji));
  if (on) list.push(r);
  CH.reacts.set(r.message_id, list);
  for (const box of document.querySelectorAll(`.cmsg[data-id="${CSS.escape(r.message_id)}"] .msg-reacts`)) box.replaceWith(reactsNode(CH.msgs.find((m) => m.id === r.message_id) || { id: r.message_id }));
}
function onReactChange(p) { if (p.eventType === "DELETE") applyReact(p.old, false); else applyReact(p.new, true); }
async function toggleReact(m, emoji) {
  if (!CH.reactOn) return;
  const row = { message_id: m.id, member_email: S.me.email, emoji }, mine = reactsOf(m.id).some((x) => x.member_email === S.me.email && x.emoji === emoji);
  applyReact(row, !mine); // at once; undone if the server says no
  rememberEmoji(emoji);
  const { error } = mine
    ? await sb.from("cdf_message_reactions").delete().eq("message_id", m.id).eq("member_email", S.me.email).eq("emoji", emoji)
    : await sb.from("cdf_message_reactions").insert(row);
  if (error) { applyReact(row, mine); toast(t("chatFail"), { type: "error" }); }
}
function reactsNode(m) {
  const groups = new Map();
  for (const r of reactsOf(m.id)) groups.set(r.emoji, [...(groups.get(r.emoji) || []), r.member_email]);
  const box = el("div", { class: "msg-reacts" });
  if (!groups.size) return box;
  for (const [emoji, who] of groups) {
    const mine = who.includes(S.me.email), names = who.map((e) => (e === S.me.email ? t("chatYou") : person(e).name)).join(", ");
    box.append(el("button", { type: "button", class: "react" + (mine ? " mine" : ""), title: names, "aria-label": emoji + " · " + names, "aria-pressed": String(mine), onclick: () => toggleReact(m, emoji) },
      el("span", { class: "react-e" }, emoji), el("b", {}, String(who.length))));
  }
  return box;
}

// ---------- emoji picker (composer and reactions) ----------
const EMOJI = [
  ["flowers", "🌸", "🌸 flor cerezo blossom pink|🌹 rosa rose|🌷 tulipán tulip|💐 ramo bouquet flores|🌻 girasol sunflower|🌺 hibisco hibiscus|🌼 margarita daisy|🪷 loto lotus|🪻 lavanda jacinto hyacinth|🌿 hoja planta leaf green|🍃 hojas leaves|🌱 brote sprout|🥀 marchita wilted|🌾 espiga wheat|🎀 lazo cinta ribbon bow|🎁 regalo gift"],
  ["work", "🚚", "🚚 camión entrega truck delivery|🛵 moto scooter|🚗 coche car|📦 paquete package box|📍 ubicación dirección pin location|🗺️ mapa map|⏰ hora alarma time|⏳ espera wait|📞 llamar teléfono call phone|📸 foto photo camera|✅ hecho listo done ok|❌ no cancelado cancel|⚠️ aviso cuidado warning|🔔 aviso notification bell|📝 nota note|💳 tarjeta pago card payment|💵 dinero efectivo cash money|🧾 recibo receipt|🏠 casa home|🏢 oficina edificio building|🚪 puerta door|🔑 llave key"],
  ["faces", "😊", "😀 sonrisa smile|😄 feliz happy|😁 dientes grin|😆 risa laugh|😅 sudor phew|😂 llorar de risa lol|🤣 carcajada rofl|😊 contento blush|🙂 ok slight|😉 guiño wink|😍 enamorado love|🥰 cariño love|😘 beso kiss|😎 guay cool|🤩 wow star|🥳 fiesta party|😇 ángel angel|🤗 abrazo hug|🤔 pensando thinking|🤨 duda doubt|😐 serio neutral|😴 sueño sleep|😮 sorpresa wow|😢 triste sad|😭 llorar cry|😤 enfadado huff|😡 furioso angry|🤯 explota mind blown|😬 uy oops|🙃 al revés upside|🥲 sonrisa triste|🤭 tapar risa|😷 enfermo mask"],
  ["hands", "👍", "👍 bien like ok sí|👎 mal no dislike|👌 perfecto perfect|✌️ paz peace|🤞 suerte luck|👏 aplausos clap|🙌 genial hooray|🙏 gracias por favor thanks please|💪 fuerza strong|👋 hola adiós wave hi bye|🤝 trato deal|✍️ escribir write|👀 mirando look|🫶 corazón manos love|☝️ uno one|👉 aquí this"],
  ["hearts", "❤️", "❤️ corazón rojo heart love|🧡 naranja orange heart|💛 amarillo yellow heart|💚 verde green heart|💙 azul blue heart|💜 morado purple heart|🤍 blanco white heart|🖤 negro black heart|💕 corazones hearts|💖 brillante sparkling heart|💗 creciente growing heart|💝 regalo corazón heart gift"],
  ["party", "🎉", "🎉 fiesta party|🎊 confeti confetti|🎂 tarta cumpleaños birthday cake|🍰 pastel cake|🥂 brindis cheers|🍾 champán champagne|🎈 globo balloon|✨ brillo sparkles|⭐ estrella star|🌟 estrella brillante star|🔥 fuego fire|💯 cien hundred|🏆 trofeo trophy|💍 anillo boda ring wedding|👰 novia bride|🎓 graduación graduation"],
].map(([id, icon, list]) => ({ id, icon, items: list.split("|").map((s) => { const [e, ...k] = s.split(" "); return { e, k: k.join(" ") }; }) }));
const recentEmoji = () => { try { return JSON.parse(localStorage.getItem("cdf-emoji") || "[]"); } catch { return []; } };
function rememberEmoji(e) { try { localStorage.setItem("cdf-emoji", JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 16))); } catch {} }
let emojiPop = null;
function closeEmoji() {
  if (!emojiPop) return;
  const p = emojiPop; emojiPop = null;
  p.classList.add("out"); setTimeout(() => p.remove(), prefersReducedMotion() ? 0 : 260);
  document.removeEventListener("pointerdown", p._outside, true);
}
// A floating panel next to `anchor`: search, categories (recent first) and a grid; picking calls onPick(emoji)
function openEmoji(anchor, onPick) {
  if (emojiPop && emojiPop._anchor === anchor) return closeEmoji();
  closeEmoji();
  const recent = [...new Set([...recentEmoji(), ...QUICK, "🌸", "🚚"])].slice(0, 16);
  const cats = [{ id: "recent", icon: "🕘", items: recent.map((e) => ({ e, k: "" })) }, ...EMOJI];
  let cat = "recent";
  const search = el("input", { class: "emoji-search", type: "search", placeholder: t("chatEmojiSearch"), "aria-label": t("chatEmojiSearch") });
  const grid = el("div", { class: "emoji-grid", role: "listbox", "aria-label": t("chatEmoji") });
  const tabs = el("div", { class: "emoji-tabs", role: "tablist" }, cats.map((c) => el("button", { type: "button", role: "tab", class: "emoji-tab", "data-cat": c.id, title: t("emo_" + c.id), "aria-label": t("emo_" + c.id), onclick: () => { cat = c.id; search.value = ""; paint(); } }, c.icon)));
  const pop = el("div", { class: "emoji-pop", role: "dialog", "aria-label": t("chatEmoji") }, search, tabs, grid);
  function paint() {
    const q = search.value.trim().toLowerCase();
    // A search matches the emoji's words or its category's name ("flor" brings every flower)
    const items = q ? EMOJI.flatMap((c) => { const label = t("emo_" + c.id).toLowerCase(); return c.items.filter((x) => x.k.includes(q) || x.e === q || label.includes(q)); }) : cats.find((c) => c.id === cat).items;
    tabs.querySelectorAll(".emoji-tab").forEach((b) => b.setAttribute("aria-selected", String(!q && b.dataset.cat === cat)));
    grid.replaceChildren(...(items.length ? items.map((x) => el("button", { type: "button", class: "emoji-btn", title: x.k.split(" ")[0] || x.e, "aria-label": x.k.split(" ")[0] || x.e, onclick: () => { rememberEmoji(x.e); onPick(x.e); closeEmoji(); } }, x.e)) : [el("p", { class: "emoji-none" }, t("chatNoResults"))]));
  }
  search.addEventListener("input", paint);
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeEmoji(); anchor.focus(); } });
  document.body.append(pop);
  // Above the button when there is room, otherwise below; kept inside the screen
  const r = anchor.getBoundingClientRect(), w = Math.min(320, innerWidth - 16), h = 300;
  pop.style.width = w + "px";
  pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  pop.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8)) + "px";
  pop._anchor = anchor;
  pop._outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeEmoji(); };
  document.addEventListener("pointerdown", pop._outside, true);
  emojiPop = pop;
  paint();
  if (!coarse()) search.focus({ preventScroll: true });
}

// ---------- mentions and #order links ----------
const handleOf = (m) => (m.name || "").trim().split(/\s+/)[0];
const mentionsMe = (body) => { const h = handleOf(S.me || {}).toLowerCase(); return !!h && new RegExp("(^|\\s)@" + h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(body || ""); };
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
// Up to three emoji and nothing else: shown large, without a bubble
const onlyEmoji = (s) => /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍|\s)+$/u.test(s) && [...s.matchAll(/\p{Extended_Pictographic}/gu)].length <= 3;

// ---------- a thread: the messages and the box to write ----------
function threadView(thread, { autofocus = false } = {}) {
  const readAt = CH.reads.get(thread) || ""; // where the "New" line goes, before this view marks everything read
  const log = el("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": t("chatTitle") });
  const jump = el("button", { class: "chat-jump", type: "button", hidden: true, onclick: () => toBottom(true) }, icon("arrow", "i down"), el("span", {}, t("chatJump")));
  const typing = el("div", { class: "chat-typing", "aria-live": "polite" });
  const input = el("textarea", { class: "chat-input", rows: 1, placeholder: t("chatPh"), "aria-label": t("chatPh") });
  const emojiBtn = el("button", { class: "btn icon ghost chat-emoji", type: "button", "aria-label": t("chatEmoji"), title: t("chatEmoji") }, el("span", { "aria-hidden": "true" }, "😊"));
  const send = el("button", { class: "btn primary icon chat-send", type: "button", "aria-label": t("chatSend"), title: t("chatSend"), disabled: true }, icon("arrow"));
  const pop = el("div", { class: "mention-pop", role: "listbox", hidden: true });
  const err = el("div", { class: "err", role: "alert" });
  const node = el("div", { class: "chat", "data-thread": thread }, el("div", { class: "chat-scroll" }, log, jump), typing, el("div", { class: "chat-compose" }, pop, emojiBtn, input, send), err);
  const view = { thread, node, refresh: null, typing: null, edit: null };
  let shown = 0, picks = [], pickAt = 0, newMark = false;

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const toBottom = (smooth) => { log.scrollTo({ top: log.scrollHeight, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" }); jump.hidden = true; };
  log.addEventListener("scroll", () => { if (nearBottom()) jump.hidden = true; }, { passive: true });
  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; send.disabled = !input.value.trim(); };

  function row(m, prev) {
    const p = person(m.author_email), mine = m.author_email === S.me.email, day = manilaDay(m.created_at);
    const joined = prev && prev.author_email === m.author_email && manilaDay(prev.created_at) === day && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60000;
    const big = onlyEmoji(m.body);
    const canReact = CH.reactOn && !m.direct_id;
    const canEdit = mine && Object.hasOwn(m, "edited_at");
    const tools = el("div", { class: "msg-tools", role: "toolbar", "aria-label": t("chatReact") },
      canReact ? QUICK.map((e) => el("button", { type: "button", class: "tool-e", "aria-label": t("chatReact") + " " + e, onclick: () => { toggleReact(m, e); r.classList.remove("tools-on"); } }, e)) : null,
      canReact ? el("button", { type: "button", class: "tool-more", "aria-label": t("chatMoreReact"), title: t("chatMoreReact"), onclick: (ev) => openEmoji(ev.currentTarget, (e) => toggleReact(m, e)) }, "＋") : null,
      canEdit ? el("button", { type: "button", class: "tool-edit", "aria-label": t("chatEdit"), title: t("chatEdit"), onclick: () => editRow(r, m) }, icon("edit")) : null,
      el("button", { type: "button", class: "tool-copy", "aria-label": t("chatCopy"), title: t("chatCopy"), onclick: () => navigator.clipboard?.writeText(m.body).then(() => toast(t("chatCopied")), () => {}) }, icon("copy")));
    const r = el("div", { class: "cmsg" + (joined ? " joined" : "") + (mine ? " mine" : "") + (!mine && mentionsMe(m.body) ? " for-me" : "") + (big ? " jumbo" : ""), "data-id": m.id },
      mine ? null : joined ? el("span", { class: "msg-gap" }) : avatarNode(p, "avatar msg-pic"),
      el("div", { class: "msg-main" },
        !mine && !joined ? el("div", { class: "msg-head" }, el("b", {}, p.name)) : null,
        el("div", { class: "msg-bubble" }, el("p", { class: "msg-body" }, messageText(m.body)),
          m.edited_at ? el("small", { class: "msg-time" }, t("chatEdited")) : null,
          el("time", { class: "msg-time", datetime: m.created_at, title: longDate(manilaDay(m.created_at)) + " · " + clock(m.created_at) }, clock(m.created_at))),
        reactsNode(m)),
      tools);
    // Phones: hold a message to react or copy
    let hold;
    r.addEventListener("touchstart", () => { hold = setTimeout(() => { document.querySelectorAll(".cmsg.tools-on").forEach((x) => x.classList.remove("tools-on")); r.classList.add("tools-on"); navigator.vibrate?.(10); }, 450); }, { passive: true });
    for (const ev of ["touchend", "touchmove", "touchcancel"]) r.addEventListener(ev, () => clearTimeout(hold), { passive: true });
    return r;
  }
  function editRow(messageRow, message) {
    if (messageRow.querySelector(".msg-edit")) return;
    const field = el("textarea", { class: "input", rows: 3, maxlength: 4000, required: true, "aria-label": t("chatEdit") });
    field.value = message.body;
    const error = el("div", { class: "err", role: "alert" });
    const save = el("button", { class: "btn primary", type: "submit", disabled: true }, t("save"));
    const cancel = el("button", { class: "btn", type: "button", onclick: () => finish() }, t("cancel"));
    const form = el("form", { class: "msg-edit", onsubmit: async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      const body = field.value.trim();
      save.disabled = cancel.disabled = field.disabled = true;
      error.textContent = "";
      try {
        updateMessage(await saveMessageEdit(message, body));
        finish();
      } catch {
        save.disabled = cancel.disabled = field.disabled = false;
        error.textContent = t("chatEditFail");
        field.focus();
      }
    } }, field, error, el("div", {}, cancel, save));
    function finish() {
      form.remove();
      const current = CH.msgs.find((m) => m.id === message.id && threadOf(m) === thread);
      if (current) view.edit(current)?.querySelector(".tool-edit")?.focus({ preventScroll: true });
    }
    field.oninput = () => { save.disabled = !field.value.trim() || field.value.trim() === message.body; };
    form.onkeydown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!cancel.disabled) finish();
    };
    messageRow.querySelector(".msg-bubble").hidden = true;
    messageRow.querySelector(".msg-main").prepend(form);
    field.focus();
  }
  function paint(animate) {
    const msgs = CH.msgs.filter((m) => threadOf(m) === thread);
    if (!msgs.length) {
      log.replaceChildren(el("div", { class: "chat-empty" }, el("span", { class: "chat-empty-ic" }, icon("message")), el("b", {}, t("chatEmpty")), el("small", {}, t("chatEmptyHint"))));
      shown = 0; return;
    }
    if (!animate || shown === 0 || msgs.length < shown) { log.replaceChildren(); shown = 0; }
    const atBottom = nearBottom();
    let fresh = 0;
    for (let i = shown; i < msgs.length; i++) {
      const m = msgs[i], prev = msgs[i - 1], day = manilaDay(m.created_at);
      if (!prev || manilaDay(prev.created_at) !== day) log.append(el("div", { class: "chat-day" }, el("span", {}, day === S.today ? t("today") : day === addDays(S.today, -1) ? t("chatYesterday") : shortDate(day))));
      // "New" line once, above the first message that arrived since this person last read the thread
      if (!newMark && !animate && readAt && m.author_email !== S.me.email && m.created_at > readAt) { newMark = true; log.append(el("div", { class: "chat-new" }, el("span", {}, t("chatNew")))); }
      const r = row(m, prev);
      if (animate && shown > 0) { r.classList.add("msg-in"); if (m.author_email !== S.me.email) fresh++; }
      log.append(r);
    }
    shown = msgs.length;
    if (!animate) requestAnimationFrame(() => { const nl = log.querySelector(".chat-new"); nl ? nl.scrollIntoView({ block: "center" }) : toBottom(false); });
    else if (atBottom || !fresh) toBottom(true);
    else jump.hidden = false;
  }
  view.refresh = () => paint(true);
  view.edit = (message) => {
    const existing = log.querySelector(`.cmsg[data-id="${CSS.escape(message.id)}"]`);
    if (!existing || existing.querySelector(".msg-edit")) return;
    const msgs = CH.msgs.filter((m) => threadOf(m) === thread);
    const updated = row(message, msgs[msgs.indexOf(message) - 1]);
    existing.replaceWith(updated);
    return updated;
  };
  view.typing = () => { const s = typingText(thread); typing.classList.toggle("on", !!s); if (s) typing.replaceChildren(el("span", { class: "dots", "aria-hidden": "true" }, el("i"), el("i"), el("i")), el("span", {}, s)); };

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
  function insertAtCaret(text) {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    input.value = input.value.slice(0, a) + text + input.value.slice(b);
    input.setSelectionRange(a + text.length, a + text.length); grow(); input.focus();
  }
  async function submit() {
    const body = input.value.trim(); if (!body) return;
    send.disabled = true; err.textContent = "";
    try { await sendMessage(thread, body); input.value = ""; grow(); pop.hidden = true; send.classList.remove("sent"); void send.offsetWidth; send.classList.add("sent"); }
    catch (e) { err.textContent = e.message; send.disabled = false; }
    input.focus();
  }
  input.addEventListener("input", () => { grow(); updatePop(); if (input.value.trim()) sendTyping(thread); });
  input.addEventListener("click", updatePop);
  input.addEventListener("blur", () => setTimeout(() => (pop.hidden = true), 120));
  input.addEventListener("keydown", (e) => {
    if (!pop.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); pickAt = (pickAt + (e.key === "ArrowDown" ? 1 : picks.length - 1)) % picks.length; updatePop(); return; }
    if (!pop.hidden && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); choose(picks[pickAt]); return; }
    if (!pop.hidden && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); pop.hidden = true; return; }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  emojiBtn.addEventListener("click", () => openEmoji(emojiBtn, insertAtCaret));
  send.addEventListener("click", submit);

  CH.views.add(view);
  paint(false);
  view.typing();
  if (autofocus) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  markRead(thread);
  return node;
}
function refreshViews(thread) {
  for (const v of [...CH.views]) { if (!v.node.isConnected) { CH.views.delete(v); continue; } if (v.thread === thread) { v.refresh(); v.typing(); } }
  if (S.tab === "chat") renderChatList();
}
// Tapping anywhere else hides a held message's tools (phones)
document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.(".cmsg.tools-on")) document.querySelectorAll(".cmsg.tools-on").forEach((x) => x.classList.remove("tools-on")); });

// The conversation section inside an order sheet
const chatSection = (o) => (CH.on && o?.id ? el("section", { class: "chat-sec", id: "chatSection" },
  el("h3", {}, icon("message"), t("chatOrderTitle")),
  el("p", { class: "chat-privacy" }, t("chatOrderPrivacy")),
  threadView(o.id)) : null);
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
function directPeer(thread) {
  const pair = CH.directs.get(thread);
  return pair ? person(pair.member_a === S.me.email ? pair.member_b : pair.member_a) : null;
}
async function receiveDirect(message) {
  const me = S.me;
  if (!CH.directs.has(message.direct_id)) {
    const { data } = await sb.from("cdf_direct_threads").select("*").eq("id", message.direct_id).maybeSingle();
    if (!data || S.me !== me) return;
    CH.directs.set(data.id, data);
  }
  addMessage(message, true);
}
async function openDirect(email, control) {
  const me = S.me;
  control.disabled = true;
  try {
    const { data, error } = await sb.rpc("cdf_open_direct", { peer: email }).single();
    if (S.me !== me) return;
    if (error || !data) throw new Error(t("chatDirectFail"));
    CH.directs.set(data.id, data);
    CH.q = "";
    CH.filter = "all";
    $("chatList").replaceChildren();
    openThread(data.id);
  } catch {
    if (S.me === me) toast(t("chatDirectFail"));
  } finally {
    control.disabled = false;
  }
}
function threadTitle(th) {
  if (th === TEAM) return "#" + t("chatTeam");
  const peer = directPeer(th);
  if (peer) return peer.name;
  const o = byId(th) || CH.info.get(th);
  return o ? "#" + o.num + " · " + (o.customer_name || t("noName")) : "#…";
}
async function loadThreadInfo(ids) {
  const miss = ids.filter((id) => id !== TEAM && !CH.directs.has(id) && !byId(id) && !CH.info.has(id));
  if (!miss.length) return;
  for (const id of miss) CH.info.set(id, null); // asked once
  const { data } = await sb.from("cdf_orders").select("id,num,customer_name,status,delivery,date,slot,channel,vendor_email,photo_path,bouquet_path").in("id", miss);
  for (const o of data || []) CH.info.set(o.id, o);
  if (S.tab === "chat") { renderChatList(); if (miss.includes(CH.open)) renderChatPane(); }
}
function threads() {
  const last = new Map();
  for (const m of CH.msgs) last.set(threadOf(m), m);
  const list = [...last.entries()].filter(([th]) => th !== TEAM).sort((a, b) => msgOrder(b[1], a[1]));
  for (const id of CH.directs.keys()) if (!last.has(id)) list.push([id, null]);
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
// Search and the All / Unread switch are built once, so typing in the search box is never interrupted
function chatListTools(box) {
  let tools = box.querySelector(".chat-tools");
  if (tools) return box.querySelector(".chat-threads");
  const q = el("input", { class: "chat-search", type: "search", placeholder: t("chatSearch"), "aria-label": t("chatSearch"), oninput: (e) => { CH.q = e.target.value.trim().toLowerCase(); renderChatList(); } });
  const seg = el("div", { class: "seg chat-filter", role: "group", "aria-label": t("chatFilter") },
    ["all", "unread"].map((f) => el("button", { type: "button", "data-f": f, "aria-pressed": String(CH.filter === f), onclick: () => { CH.filter = f; seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === f))); placePill(seg); renderChatList(); } }, t(f === "all" ? "chatAll" : "chatUnreadOnly"))));
  q.value = CH.q;
  const direct = CH.directOn ? el("select", { class: "chat-direct-picker", "aria-label": t("chatDirectNew"), onchange: (e) => {
    const select = e.currentTarget;
    const email = select.value;
    select.value = "";
    if (email) openDirect(email, select);
  } }, el("option", { value: "" }, t("chatDirectNew")),
  S.members.filter((m) => m.email !== S.me.email).map((m) => el("option", { value: m.email }, m.name + " · " + t("role_" + m.role)))) : null;
  tools = el("div", { class: "chat-tools" }, el("label", { class: "chat-search-wrap" }, icon("search"), q), seg, direct);
  const list = el("div", { class: "chat-threads" });
  box.replaceChildren(tools, list);
  requestAnimationFrame(() => placePill(seg));
  return list;
}
function renderChatList() {
  const box = $("chatList"); if (!box) return;
  const list = chatListTools(box);
  const all = threads();
  loadThreadInfo(all.map(([th]) => th));
  const ts = all.filter(([th, m]) => (CH.filter !== "unread" || unreadIn(th)) && (!CH.q || threadTitle(th).toLowerCase().includes(CH.q) || (m?.body || "").toLowerCase().includes(CH.q)));
  if (!ts.length) { list.replaceChildren(el("p", { class: "chat-list-empty" }, t(CH.filter === "unread" && !CH.q ? "chatAllRead" : "chatNoResults"))); return; }
  list.replaceChildren(...ts.map(([th, m]) => {
    const u = unreadIn(th), team = th === TEAM, p = m ? person(m.author_email) : null;
    const peer = directPeer(th);
    const o = team ? null : byId(th) || CH.info.get(th);
    const k = o ? STEPS[stepOf(o)]?.k : null;
    const who = m ? (m.author_email === S.me.email ? t("chatYou") : handleOf(p)) + ": " : "";
    return el("button", { type: "button", class: "thread" + (CH.open === th ? " on" : "") + (u ? " unread" : ""), "aria-current": CH.open === th ? "true" : "false", onclick: () => openThread(th) },
      el("span", { class: "thread-ic" + (team ? " team" : "") },
        team ? "#" : peer ? icon("message") : o?.channel && CHANNELS.includes(o.channel) ? el("span", { class: "chan-logo sm", style: "--cc:" + chanColor(o.channel) }, chanMark(o.channel)) : icon("orders"),
        k ? el("i", { class: "thread-dot", style: "--c: var(--" + k + "-solid)", title: stepName(stepOf(o)) }) : null),
      el("span", { class: "thread-main" },
        el("span", { class: "thread-top" }, el("b", {}, threadTitle(th)), m ? el("time", {}, manilaDay(m.created_at) === S.today ? clock(m.created_at) : shortDate(manilaDay(m.created_at))) : null),
        el("small", {}, typingText(th) ? el("em", { class: "thread-typing" }, typingText(th)) : m ? who + m.body : t(peer ? "chatDirect" : "chatTeamDesc"))),
      u ? el("span", { class: "thread-count" }, String(u)) : null);
  }));
}
function renderChatPane() {
  const pane = $("chatPane"), th = CH.open;
  pane.dataset.thread = String(th);
  $("chatView").dataset.pane = th ? "thread" : "list";
  if (!th) { pane.replaceChildren(el("div", { class: "chat-empty" }, el("span", { class: "chat-empty-ic" }, icon("message")), el("b", {}, t("chatPick")))); return; }
  const o = th === TEAM ? null : byId(th) || CH.info.get(th);
  const back = el("button", { class: "btn icon ghost chat-back", type: "button", "aria-label": t("chatBack"), onclick: () => { CH.open = null; renderChat(); } }, icon("left"));
  let head;
  const peer = directPeer(th);
  if (th === TEAM) {
    const team = S.members.slice(0, 5);
    head = el("div", { class: "chat-head" }, back,
      el("span", { class: "thread-ic team big" }, "#"),
      el("div", { class: "chat-head-txt" }, el("b", {}, threadTitle(th)), el("small", {}, t("chatTeamDesc"))),
      el("span", { class: "spacer" }),
      el("span", { class: "avatar-stack", title: S.members.map((m) => m.name).join(", ") }, team.map((m) => avatarNode(m, "avatar xs")), el("small", {}, t("chatPeople", { n: S.members.length }))));
  } else if (peer) {
    head = el("div", { class: "chat-head" }, back, avatarNode(peer),
      el("div", { class: "chat-head-txt" }, el("b", {}, peer.name), el("small", {}, t("chatDirect"))));
  } else {
    const k = o ? stepOf(o) : null;
    head = el("div", { class: "chat-head" }, back,
      o ? el("button", { class: "chat-head-pic", type: "button", "aria-label": t("chatOpenOrder"), onclick: () => openOrder(byId(th) || o) }, thumb(o)) : null,
      el("div", { class: "chat-head-txt" },
        el("b", {}, threadTitle(th)),
        o ? el("small", {}, [shortDate(o.date), o.slot, o.vendor_email ? memberName(o.vendor_email) : null].filter(Boolean).join(" · ")) : null),
      o && k != null ? badge(k) : null,
      el("span", { class: "spacer" }),
      o ? el("button", { class: "btn", type: "button", onclick: () => openOrder(byId(th) || o) }, t("chatOpenOrder")) : null);
  }
  pane.replaceChildren(head, threadView(th, { autofocus: !coarse() }));
  pane.classList.remove("pane-in"); void pane.offsetWidth; pane.classList.add("pane-in");
}
function openThread(th) {
  CH.open = th;
  if (S.tab !== "chat") setTab("chat"); else { renderChatList(); renderChatPane(); }
}
