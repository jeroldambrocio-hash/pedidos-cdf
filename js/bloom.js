// My Bloom Journey: a plant on the person's profile that grows with each completed arrangement (florists)
// or delivery (drivers). Drawings, stages and timings follow the approved reference (bloom-demo) exactly.
// The numbers come only from cdf_member_stats (the database decides what counts; see migration 023).
// No simulation here: the demo controls live in tests/bloom-demo.html only.
const BLOOM_STAGES = [
  { name: "Seed", icon: "🌰", min: 0, range: "0–49" },
  { name: "Sprout", icon: "🌱", min: 50, range: "50–99" },
  { name: "Growing", icon: "🌿", min: 100, range: "100–149" },
  { name: "Budding", icon: "🌷", min: 150, range: "150–249" },
  { name: "Full Bloom", icon: "🌸", min: 250, range: "250+" },
];
const BLOOM_MAX = BLOOM_STAGES.at(-1).min; // the overall bar fills up to 250; the total keeps counting after
const BLOOM_FLOWER = { color: "#ce7890", petals: 8, width: 12 };
const BLOOM_TXT = {
  es: { title: "My Bloom Journey", sub: "Tu nivel sube con cada pedido completado.", plant: "Tu planta", level: "Nivel {n} de {of}", progress: "Progreso de la planta",
    next: "Faltan {n} para {stage}.", max: "Has alcanzado el nivel máximo.", stages: "Etapas de crecimiento",
    florist: "arreglos preparados en total", courier: "entregas completadas en total", rule_florist: "Cuenta cuando el pedido que preparaste llega al cliente.", rule_courier: "Cuenta cada entrega completada con su foto de entrega." },
  en: { title: "My Bloom Journey", sub: "Your level grows with every completed order.", plant: "Your plant", level: "Level {n} of {of}", progress: "Plant progress",
    next: "{n} more to {stage}.", max: "You have reached the top level.", stages: "Growth stages",
    florist: "arrangements prepared in total", courier: "deliveries completed in total", rule_florist: "Counts when an order you prepared reaches the customer.", rule_courier: "Counts every delivery completed with its delivery photo." },
};
const bloomT = (k, v = {}) => {
  const lang = typeof LANG !== "undefined" && BLOOM_TXT[LANG] ? LANG : "es";
  return BLOOM_TXT[lang][k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? "");
};
const bloomStage = (total) => BLOOM_STAGES.findLastIndex(({ min }) => total >= min);
const bloomIcon = (total) => BLOOM_STAGES[bloomStage(total)].icon;
// Florists grow with arrangements, drivers with deliveries; the office has no plant
const bloomKind = (role) => (role === "vendor" ? "florist" : role === "carrier" ? "courier" : null);
// Until migration 023 is applied the stats have no split counts: fall back to the existing total
const bloomTotal = (stats, kind) => Math.max(0, +(kind === "florist" ? stats?.arranged_total ?? stats?.done_total : stats?.delivered_total ?? stats?.done_total) || 0);

function bloomFlowerHead(flower) {
  const petals = Array.from({ length: flower.petals }, (_, i) => {
    const angle = i * 360 / flower.petals;
    const tip = 14 + (i % 3) * 2;
    const width = flower.width;
    return `<g transform="rotate(${angle} 100 50)">
      <path d="M100 52C${98-width} 47 ${92-width} 32 ${98-width} 23Q93 ${tip-4} 100 ${tip}Q112 ${tip-6} ${101+width} 26C${106+width} 39 108 47 100 52Z"
        fill="${flower.color}" stroke="#52363a" stroke-width=".8"/>
      <path d="M100 48Q${94-width/2} 34 99 ${tip+6}Q107 26 100 48Z" fill="#fff2da" opacity=".29"/>
      <path d="M101 48Q107 37 108 26" fill="none" stroke="#793d48" opacity=".38" stroke-width=".75"/>
    </g>`;
  }).join("");
  const pollen = Array.from({ length: 22 }, (_, i) => {
    const radius = 2 + (i % 5) * 1.5;
    return `<circle cx="100" cy="${50-radius}" r="${i % 3 === 0 ? 1.25 : .8}" transform="rotate(${i * 137.5} 100 50)" fill="${i % 2 ? "#f4d38c" : "#bc894c"}"/>`;
  }).join("");
  return `<g class="bloom-crown">${petals}<g transform="translate(100 50) rotate(22.5) scale(.66) translate(-100 -50)" opacity=".88">${petals}</g><circle cx="100" cy="50" r="10" fill="#814936" stroke="#dca964" stroke-width="1"/>${pollen}<circle cx="100" cy="50" r="2" fill="#ffe7a3"/></g><g class="bloom-glints" fill="#f3d297"><path d="M52 29Q56 29 57 23Q58 29 62 29Q58 30 57 35Q56 30 52 29Z"/><path d="M139 36Q143 36 144 30Q145 36 149 36Q145 37 144 42Q143 37 139 36Z"/><circle cx="129" cy="15" r="1.6"/></g>`;
}
function bloomPlant(stage, flower = BLOOM_FLOWER) {
  const stemTop = [155, 120, 78, 62, 82][stage];
  const leaf = '<path d="M100 124C87 129 73 119 66 101C84 101 97 106 100 124Z" fill="#66865c" stroke="#7baf83"/><path d="M100 124Q86 113 71 104M91 117L88 109M86 114L79 115M81 110L78 105" stroke="#7baf83" fill="none"/>';
  return `<svg viewBox="0 0 200 190" aria-hidden="true">
    <ellipse cx="100" cy="185" rx="40" ry="4" fill="#080808" opacity=".32"/>
    <path d="M71 154H129L124 177Q123 184 116 185H84Q77 184 76 177Z" fill="var(--pot-af745d, #af745d)" stroke="var(--pot-d99b7d, #d99b7d)" stroke-width="1"/>
    <path d="M113 158H128L124 177Q123 184 116 185H105Q113 181 113 158Z" fill="var(--pot-855443, #855443)" opacity=".65"/>
    <path d="M81 163L84 176" stroke="var(--pot-ebaf91, #ebaf91)" stroke-width="2" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="100" cy="154" rx="31" ry="7" fill="var(--pot-cb8f72, #cb8f72)"/>
    <ellipse cx="100" cy="153" rx="26" ry="4.5" fill="#3d2a23"/>
    <g class="plant-growth">${stage === 0 ? '<ellipse cx="100" cy="151" rx="10" ry="8" transform="rotate(-19 100 151)" fill="#9e7253"/><path d="M93 153Q100 151 106 148" stroke="#e4c3a3" fill="none"/>' : `
      <path d="M100 154Q95 133 100 ${stemTop + (stage === 4 ? 8 : 0)}" stroke="#92b688" stroke-width="2.1" fill="none"/>
      <g transform="translate(0 ${stage === 4 ? 27 : 0})">
        ${leaf}<g transform="translate(200 -8) scale(-1 1)">${leaf}</g>
        ${stage >= 2 ? `<g transform="translate(20 1) scale(.8)">${leaf}</g>` : ""}
      </g>
      ${stage === 3 ? `<path d="M100 74Q74 58 99 35Q122 52 100 74Z" fill="${flower.color}" stroke="#764e59"/><path d="M100 74Q112 60 99 42" fill="none" stroke="#764e59"/>` : ""}
      ${stage === 4 ? '<g transform="translate(0 40)">' + bloomFlowerHead(flower) + "</g>" : ""}`}</g>
        <path d="M69 154Q100 167 131 154V158Q100 171 69 158Z" fill="var(--pot-c78a6e, #c78a6e)"/>
    </svg>`;
}

// The compact journey block: plant on a transparent background, level, stage, total, bar to 250 and stage lines.
// Returns { node, update(total) }; update() swaps the plant with the reference's 300 ms crossfade.
function bloomJourney(kind, total = 0) {
  const mk = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const node = mk("div", "bloom");
  node.innerHTML = `<section class="journey">
      <div class="specimen"><div class="specimen-index"><span></span></div><div class="plant-stage"><div class="plant"></div></div></div>
      <div class="journey-copy">
        <p class="level"></p><h2 class="bloom-stage"></h2><p class="bloom-desc"></p>
        <div class="progress-label"><span class="bloom-plabel"></span><strong class="bloom-count"></strong></div>
        <progress class="bloom-bar-p" max="${BLOOM_MAX}" value="0"></progress>
        <p class="bloom-next"></p><p class="bloom-rule"></p>
      </div>
    </section>
    <ol class="stage-list"></ol>`;
  const q = (s) => node.querySelector(s), plant = q(".plant"), list = q(".stage-list");
  q(".specimen-index span").textContent = bloomT("plant");
  q(".bloom-plabel").textContent = bloomT("progress");
  q(".bloom-bar-p").setAttribute("aria-label", bloomT("progress"));
  list.setAttribute("aria-label", bloomT("stages"));
  for (const s of BLOOM_STAGES) { const li = mk("li"); li.append(mk("strong", "", s.name), mk("span", "", s.range)); list.append(li); }
  let shownStage = null;
  function update(n) {
    total = Math.max(0, Math.floor(+n || 0));
    const stage = bloomStage(total), next = BLOOM_STAGES[stage + 1];
    q(".level").textContent = bloomT("level", { n: stage + 1, of: BLOOM_STAGES.length });
    q(".bloom-stage").textContent = BLOOM_STAGES[stage].name;
    q(".bloom-desc").textContent = `${total} ${bloomT(kind)}`;
    q(".bloom-count").textContent = `${Math.min(total, BLOOM_MAX)} / ${BLOOM_MAX}`;
    q(".bloom-bar-p").value = Math.min(total, BLOOM_MAX);
    q(".bloom-next").textContent = next ? bloomT("next", { n: next.min - total, stage: next.name }) : bloomT("max");
    q(".bloom-rule").textContent = bloomT("rule_" + kind);
    [...list.children].forEach((li, i) => {
      const start = BLOOM_STAGES[i].min, end = BLOOM_STAGES[i + 1]?.min;
      li.style.setProperty("--stage-fill", end ? Math.max(0, Math.min(1, (total - start) / (end - start))) : Number(total >= start));
      if (i === stage) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    if (shownStage !== stage) {
      const previous = plant.querySelector("svg:not(.plant-outgoing)");
      plant.innerHTML = bloomPlant(stage);
      // The pot stays; the old growth fades while the new one settles in (skipped when animations are Reduced)
      if (previous && shownStage != null && document.documentElement.dataset.motion !== "reduced") {
        for (const part of [...previous.children]) if (!part.classList.contains("plant-growth")) part.remove();
        previous.classList.add("plant-outgoing");
        previous.addEventListener("animationend", () => previous.remove(), { once: true });
        plant.prepend(previous);
      }
      shownStage = stage;
    }
  }
  update(total);
  return { node, update, get total() { return total; } };
}
