export function formatSlot12(value: unknown) {
  return String(value ?? "").replace(/\b(\d{1,2}):(\d{2})\b/g, (raw, hs, ms) => {
    const h = +hs, m = +ms;
    if (h > 24 || m > 59 || (h === 24 && m !== 0)) return raw;
    return (h % 12 || 12) + ":" + ms + " " + (h % 24 < 12 ? "AM" : "PM");
  });
}

