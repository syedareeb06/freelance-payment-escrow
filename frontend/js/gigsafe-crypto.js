/* GigSafe helpers (everything runs in the browser):
 *  - the canonical job brief whose SHA-256 is committed on-chain (scope of work),
 *  - built-in sample deliverables generated from a seed, so the demo needs no files:
 *      a logo (SVG), website copy (plain text) and a content calendar (CSV),
 *  - safe previews of deliverables (SVG shown as an image, text, CSV as a table).
 * File fingerprints use SHA-256 from the Web Crypto API (UI.sha256).
 */
(function () {
  const MAX_UPLOAD = 5 * 1024 * 1024; // largest file the app will hash
  const MAX_STORED = 256 * 1024; // larger files: only the hash is kept (browser storage is ~5 MB)

  const KINDS = {
    logo: { label: "Logo (SVG)", noun: "logo", ext: "svg", type: "image/svg+xml" },
    copy: { label: "Website copy (TXT)", noun: "website copy", ext: "txt", type: "text/plain" },
    csv: { label: "Content calendar (CSV)", noun: "content calendar", ext: "csv", type: "text/csv" },
  };

  // ---------- deterministic randomness from a text seed (FNV-1a + mulberry32) ----------
  function seedOf(text) {
    let h = 0x811c9dc5;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function rng(seedText) {
    let a = seedOf(seedText);
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file";
  const initials = (name) =>
    String(name)
      .split(/[\s._-]+/)
      .filter((w) => /[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w.match(/[A-Za-z]/)[0].toUpperCase())
      .join("") || "G";

  // ---------- sample deliverable 1: an SVG logo drawn from a seed ----------
  function logoSvg(brand, seed) {
    const r = rng(`logo|${brand}|${seed}`);
    const palettes = [
      ["#1d4ed8", "#dbeafe", "#0b1b4d"],
      ["#0f766e", "#ccfbf1", "#042f2e"],
      ["#b45309", "#fef3c7", "#3b1d02"],
      ["#be185d", "#fce7f3", "#4a0721"],
      ["#15803d", "#dcfce7", "#052e16"],
      ["#6d28d9", "#ede9fe", "#2e1065"],
    ];
    const [main, soft, ink] = pick(r, palettes);
    const rot = Math.floor(r() * 60);
    let mark;
    switch (Math.floor(r() * 4)) {
      case 0:
        mark = `<circle cx="120" cy="104" r="62" fill="${main}"/><circle cx="120" cy="104" r="74" fill="none" stroke="${main}" stroke-width="4" stroke-dasharray="${8 + Math.floor(r() * 10)} 7" opacity="0.6"/>`;
        break;
      case 1: {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = ((60 * i + rot) * Math.PI) / 180;
          return `${(120 + 70 * Math.cos(a)).toFixed(1)},${(104 + 70 * Math.sin(a)).toFixed(1)}`;
        }).join(" ");
        mark = `<polygon points="${pts}" fill="${main}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
        break;
      }
      case 2:
        mark = `<rect x="70" y="54" width="100" height="100" rx="22" fill="${main}" transform="rotate(${45 + (rot % 10)} 120 104)"/><circle cx="${150 + Math.floor(r() * 20)}" cy="${48 + Math.floor(r() * 16)}" r="11" fill="${ink}"/>`;
        break;
      default:
        mark = `<path d="M44 132 Q82 ${30 + Math.floor(r() * 30)} 120 92 T196 ${60 + Math.floor(r() * 40)} L196 160 L44 160 Z" fill="${main}"/><circle cx="120" cy="104" r="44" fill="${ink}" opacity="0.18"/>`;
    }
    const name = String(brand).toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <title>${xmlEsc(brand)} logo concept (${xmlEsc(seed)})</title>
  <rect width="240" height="240" rx="36" fill="${soft}"/>
  ${mark}
  <text x="120" y="124" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="54" font-weight="800" fill="#ffffff">${xmlEsc(initials(brand))}</text>
  <text x="120" y="208" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="${name.length > 14 ? 14 : 17}" font-weight="700" letter-spacing="2" fill="${ink}">${xmlEsc(name)}</text>
</svg>
`;
  }

  // ---------- sample deliverable 2: website copy (plain text) ----------
  function websiteCopy(brand, seed, author) {
    const r = rng(`copy|${brand}|${seed}`);
    const headline = pick(r, [
      `${brand}: start small, grow fast.`,
      `Good things begin at ${brand}.`,
      `Your next chapter starts here.`,
      `Made with care. Ready when you are.`,
    ]);
    const sub = pick(r, [
      "Everything you need in one friendly place, without the jargon.",
      "Simple, honest and built around the people we serve.",
      "Less waiting, more doing. We take care of the details.",
    ]);
    const offers = [
      ["Open every day", "Drop in early or stay late. We keep the doors open when you need us."],
      ["Real people", "Talk to a person, not a ticket. We answer within one working day."],
      ["Fair prices", "One clear price list. No hidden fees, no surprises at the end."],
      ["Community first", "Monthly meet-ups, workshops and a noticeboard for local news."],
      ["Fresh every week", "New ideas and new products, tested by our own team first."],
    ];
    for (let i = offers.length - 1; i > 0; i--) {
      const k = Math.floor(r() * (i + 1)); // Fisher-Yates shuffle with the seeded generator
      [offers[i], offers[k]] = [offers[k], offers[i]];
    }
    const chosen = offers.slice(0, 3);
    const cta = pick(r, ["Book a free first visit", "See this week's offers", "Say hello today", "Join the waiting list"]);
    const line = "=".repeat(54);
    return [
      `${String(brand).toUpperCase()} - LANDING PAGE COPY`,
      `Draft ${seed} by ${author}`,
      line,
      "",
      `HEADLINE`,
      headline,
      "",
      `SUBHEADLINE`,
      sub,
      "",
      `ABOUT US`,
      `${brand} is a small team with a simple idea: make every visit feel easy. ` +
        pick(r, ["We started in 2023 with one room and a lot of coffee.", "We grew from a weekend project into a neighbourhood favourite.", "We listen first and build second."]),
      "",
      `WHAT WE OFFER`,
      ...chosen.map(([t, d]) => `- ${t}: ${d}`),
      "",
      `CALL TO ACTION`,
      `[ ${cta} ]`,
      "",
      line,
      `Prepared for ${brand}. Delivered through GigSafe escrow.`,
      "",
    ].join("\n");
  }

  // ---------- sample deliverable 3: a CSV content calendar ----------
  function contentCalendar(brand, seed) {
    const r = rng(`csv|${brand}|${seed}`);
    const tag = "#" + String(brand).replace(/[^A-Za-z0-9]/g, "");
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const platforms = ["Instagram", "LinkedIn", "Facebook", "Newsletter"];
    const ideas = [
      "Behind the scenes: meet the team",
      "Customer story of the week",
      "Three tips for getting started",
      "Launch countdown",
      "Before and after",
      "Ask us anything (live)",
      "Thank-you post for early supporters",
      "Weekend special announcement",
      "Quick poll: what should we try next?",
      "Photo tour of the space",
    ];
    const rows = [["week", "day", "platform", "post", "hashtag"]];
    for (let w = 1; w <= 2; w++)
      for (const d of days.slice(0, 5 + Math.floor(r() * 2)))
        rows.push([String(w), d, pick(r, platforms), pick(r, ideas), pick(r, [tag, "#LaunchWeek", "#SmallBusiness", "#Community"])]);
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }
  const csvCell = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  /** Generate a built-in sample deliverable. Returns { name, type, bytes }. */
  function sample(kind, { brand, author, jobId, index, version }) {
    const k = KINDS[kind] || KINDS.copy;
    const seed = `job${jobId}-m${index + 1}-v${version}`;
    let text;
    if (kind === "logo") text = logoSvg(brand, seed);
    else if (kind === "csv") text = contentCalendar(brand, seed);
    else text = websiteCopy(brand, `v${version}`, author);
    return { name: `${slug(brand)}-${slug(k.noun)}-v${version}.${k.ext}`, type: k.type, bytes: UI.toBytes(text) };
  }

  // ---------- the job brief (scope of work) ----------
  /** Fixed key order so the same brief always gives the same SHA-256. */
  function canonicalBrief(b) {
    return JSON.stringify({
      format: "gigsafe-brief/1",
      title: b.title,
      client: b.client,
      freelancer: b.freelancer,
      description: b.description,
      milestones: b.milestones.map((m) => ({ title: m.title, kind: m.kind, amountEth: String(m.eth), dueInDays: Number(m.days) })),
      reviewWindowDays: Number(b.reviewDays),
      salt: b.salt,
    });
  }
  function parseBrief(text) {
    const o = JSON.parse(text);
    if (o.format !== "gigsafe-brief/1") throw new Error("Not a GigSafe job brief");
    return o;
  }

  // ---------- previews ----------
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") row.push(cell), (cell = "");
      else if (c === "\n") row.push(cell), rows.push(row), (row = []), (cell = "");
      else if (c !== "\r") cell += c;
    }
    if (cell || row.length) row.push(cell), rows.push(row);
    return rows;
  }

  const isImage = (file) => /^image\/(svg\+xml|png|jpeg|gif|webp)$/.test((file && file.type) || "");
  const isText = (type, name) => /^text\/|json|xml|csv/.test(type || "") || /\.(txt|md|csv|json|html|css|js)$/i.test(name || "");

  /** HTML preview of a stored deliverable { name, type, b64 }. Never executes content. */
  function preview(file) {
    if (!file || !file.b64) return `<p class="muted small">No preview: the file is not stored in this browser.</p>`;
    const type = file.type || "";
    if (isImage(file)) {
      return `<img class="deliv-img" alt="Preview of ${UI.esc(file.name)}" src="data:${type};base64,${file.b64}">`;
    }
    if (isText(type, file.name)) {
      const text = UI.utf8.decode(UI.base64ToBytes(file.b64));
      if (/csv/.test(type) || /\.csv$/i.test(file.name)) {
        const rows = parseCsv(text).filter((r) => r.length > 1);
        const head = rows[0] || [];
        const body = rows.slice(1, 9);
        return `<div class="csv-wrap"><table class="csv-table"><thead><tr>${head.map((h) => `<th>${UI.esc(h)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${UI.esc(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>${rows.length > 9 ? `<p class="muted small">… ${rows.length - 9} more rows</p>` : ""}</div>`;
      }
      return `<pre class="deliv-text">${UI.esc(text.length > 4000 ? text.slice(0, 4000) + "\n…" : text)}</pre>`;
    }
    return `<p class="muted small">No preview for this file type (${UI.esc(type || "unknown")}). Download it to open it.</p>`;
  }

  function fmtBytes(n) {
    n = Number(n);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  window.GigCrypto = { KINDS, MAX_UPLOAD, MAX_STORED, sample, logoSvg, websiteCopy, contentCalendar, canonicalBrief, parseBrief, parseCsv, preview, isImage, fmtBytes, slug };
})();
