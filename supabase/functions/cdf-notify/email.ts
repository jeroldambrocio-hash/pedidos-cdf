// Customer email for Casa de Flores: cream card, dark green text and button, sage details, the real logo,
// the bouquet photo when there is one, and a "View my order" button to the tracking link.
// Table layout with inline styles for Gmail, Outlook and Apple Mail; no scripts, forms or animation.
// Plain TypeScript with nothing to compile away, so Node can load it for the local preview (tests/email-preview).

export type Step = "prep" | "ready" | "transit" | "done" | "fail";

// The same five steps as the panel and the tracking page (status + delivery)
export const stepOf = (status: string, delivery: string): Step =>
  delivery === "Failed" ? "fail" : delivery === "Delivered" ? "done" : delivery === "In transit" ? "transit" : status === "Ready" ? "ready" : "prep";

// What each step says. Only what the order's state tells: no dates or details that aren't known.
const COPY: Record<Step, { subject: string; title: string; line: string }> = {
  prep: { subject: "We're preparing your order #{num}", title: "We're preparing your bouquet", line: "Our florists are arranging your flowers." },
  ready: { subject: "Your order #{num} is ready", title: "Your bouquet is ready", line: "Your bouquet is ready and will leave our studio soon." },
  transit: { subject: "Your order #{num} is on its way", title: "Your bouquet is on its way", line: "Your order is ready and on its way." },
  done: { subject: "Your order #{num} has been delivered", title: "Your bouquet has been delivered", line: "Your order has been delivered. Thank you for sharing flowers." },
  fail: { subject: "We tried to deliver your order #{num}", title: "We tried to deliver your bouquet", line: "We came to the address and nobody was home. We'll contact you to try again." },
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const C = { page: "#f3ede4", card: "#fbf8f3", ink: "#1f3a24", body: "#33402f", muted: "#6e7a67", sage: "#7f9873", line: "#cfd8c6", button: "#1f4d2b" };
const SERIF = "'Newsreader', Georgia, 'Times New Roman', Times, serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export type CustomerEmail = {
  appUrl: string;        // the site, for the logo (absolute URLs only)
  num: string;           // order number
  name?: string | null;  // buyer, or the recipient when they are the same person
  step: Step;
  link: string;          // the order's tracking link; empty = tracking switched off, the button is left out
  photoUrl?: string | null; // signed link to the bouquet photo; the block is left out without one
  message?: string | null;  // a note written by the shop, shown under the status line
};

export function customerEmail(e: CustomerEmail): { subject: string; html: string; text: string } {
  const copy = COPY[e.step];
  const first = String(e.name || "").trim().split(/\s+/)[0] || "";
  const hi = first ? `Hi, ${first}.` : "Hi.";
  const subject = copy.subject.replace("{num}", e.num) + " · Casa de Flores";
  const note = String(e.message || "").trim();
  const noteHtml = esc(note).replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${C.button}">$1</a>`).replace(/\n/g, "<br>");
  const logo = e.appUrl.replace(/\/$/, "") + "/img/logo.png";

  const photo = e.photoUrl ? `
          <tr><td style="padding:8px 28px 4px">
            <img src="${esc(e.photoUrl)}" width="544" alt="Your bouquet from Casa de Flores" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:10px;background:${C.page}">
          </td></tr>` : "";
  const noteRow = note ? `
          <tr><td align="center" class="px" style="padding:4px 44px 8px;font-family:${SERIF};font-size:16px;line-height:1.55;color:${C.body}">${noteHtml}</td></tr>` : "";

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; }
  a { text-decoration: none; }
  @media (max-width: 620px) {
    .card { width: 100% !important; border-radius: 0 !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .title { font-size: 30px !important; }
    .btn a { display: block !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(copy.line)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
  <tr><td align="center" style="padding:28px 12px">
    <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${C.card};border-radius:14px">
      <tr><td align="center" class="px" style="padding:30px 28px 18px">
        <img src="${esc(logo)}" width="220" alt="Casa de Flores" style="display:block;width:220px;max-width:70%;height:auto;border:0">
      </td></tr>
      <tr><td class="px" style="padding:0 44px"><div style="height:1px;line-height:1px;font-size:1px;background:${C.line}">&nbsp;</div></td></tr>
      <tr><td align="center" class="px" style="padding:26px 28px 6px;font-family:${SANS};font-size:13px;letter-spacing:3px;color:${C.sage};text-transform:uppercase">Order #${esc(e.num)}</td></tr>
      <tr><td align="center" class="px title" style="padding:4px 28px 10px;font-family:${SERIF};font-size:36px;line-height:1.15;font-weight:500;color:${C.ink}">${esc(copy.title)}</td></tr>
      <tr><td align="center" class="px" style="padding:0 28px;font-family:${SERIF};font-size:19px;line-height:1.5;color:${C.body}">${esc(hi)}</td></tr>
      <tr><td align="center" class="px" style="padding:2px 28px 18px;font-family:${SERIF};font-size:17px;line-height:1.5;color:${C.body}">${esc(copy.line)}</td></tr>${noteRow}${photo}
${e.link ? `      <tr><td align="center" class="px" style="padding:24px 60px 8px">
        <table role="presentation" class="btn" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px">
          <tr><td align="center" bgcolor="${C.button}" style="background:${C.button};border-radius:8px">
            <a href="${esc(e.link)}" target="_blank" style="display:inline-block;padding:15px 28px;font-family:${SERIF};font-size:19px;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px">View my order</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" class="px" style="padding:6px 28px 26px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${C.muted}">Track your order and view its details.</td></tr>` : ""}
      <tr><td class="px" style="padding:0 44px"><div style="height:1px;line-height:1px;font-size:1px;background:${C.line}">&nbsp;</div></td></tr>
      <tr><td align="center" class="px" style="padding:20px 28px 4px;font-family:${SERIF};font-size:15px;letter-spacing:5px;color:${C.ink};text-transform:uppercase">Casa de Flores</td></tr>
      <tr><td align="center" class="px" style="padding:0 28px 28px;font-family:${SERIF};font-size:15px;line-height:1.5;color:${C.muted}">Thank you for letting us brighten your day.</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    "CASA DE FLORES", "", `ORDER #${e.num}`, copy.title, "", hi, copy.line, ...(note ? ["", note] : []), "",
    ...(e.link ? [`View my order: ${e.link}`, "Track your order and view its details.", ""] : []), "Thank you for letting us brighten your day.",
  ].join("\n");

  return { subject, html, text };
}
