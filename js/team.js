// Team (admin only): who has access and with which role. Accounts are created by the cdf-users function.

function renderTeam() {
  const box = $("team"); box.replaceChildren();
  const open = S.orders.filter((o) => stepOf(o) !== 3);
  for (const m of S.members) {
    const self = m.email === S.me.email;
    const load = m.role === "carrier" ? open.filter((o) => o.carrier_email === m.email).length : open.filter((o) => o.vendor_email === m.email).length;
    box.append(el("div", { class: "member" },
      el("span", { class: "avatar", "aria-hidden": "true" }, m.name.trim().charAt(0).toUpperCase()),
      el("div", {}, el("b", {}, m.name, el("span", { class: "role-tag" }, t("role_" + m.role))), el("small", {}, m.email),
        m.role === "vendor" || m.role === "carrier" ? el("small", { class: "load" }, t("openLoad", { n: load })) : null),
      self ? el("span", { class: "hint" }, t("you")) : el("button", { class: "btn ghost", type: "button", onclick: async (e) => {
        const b = e.currentTarget;
        if (!(await askConfirm(t("removeAsk", { name: m.name }), t("remove"), { danger: true, detail: t("removeHint") }))) return;
        b.disabled = true;
        const { data, error } = await sb.functions.invoke("cdf-users", { body: { action: "remove", email: m.email } });
        if (error || data?.error) { b.disabled = false; toast(data?.error || t("removeFail")); return; }
        toast(t("removed", { name: m.name })); await loadMembers(); renderTeam();
      } }, t("remove"))));
  }
}
$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault(); $("aErr").textContent = ""; $("aBtn").disabled = true;
  const body = { action: "add", name: $("aName").value.trim(), email: $("aEmail").value.trim(), role: $("aRole").value, password: $("aPass").value };
  const { data, error } = await sb.functions.invoke("cdf-users", { body });
  $("aBtn").disabled = false;
  let msg = data?.error;
  if (error && !msg) { try { msg = (await error.context.json()).error; } catch { msg = t("addFail"); } }
  if (msg) { $("aErr").textContent = msg; return; }
  toast(t(data.existed ? "addedExisting" : "added", { name: body.name }));
  e.target.reset(); await loadMembers(); renderTeam();
});
