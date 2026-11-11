// ================= CONFIG =================
const IMAGE_DIR = "HxH_Wordle_Images/";   // folder with your .webp files
const MIN_KNOWN_FIELDS = 4;               // answer pool: characters with at least this many known fields (of 8)

// Hints: a new hint unlocks every HINT_EVERY guesses. The answer's image is shown blurred;
// each entry below is the blur (px) for hint 1, 2, 3...  Lower = clearer. Add/remove entries freely.
const HINT_EVERY = 5;
const HINT_BLUR = [35, 22, 12, 5];

// Ordered lists used for the up/down arrows
const AGE_ORDER = ["1-20", "21-40", "41-60", "61-80", "100+"];
const ARC_ORDER = ["Hunter Exam", "Zoldyck Family", "Heavens Arena", "Yorknew City",
                   "Greed Island", "Chimera Ant", "Chairman Election"];

const COLUMNS = [
  { key: "gender",      label: "Gender" },
  { key: "race",        label: "Race" },
  { key: "hair_color",  label: "Hair" },
  { key: "age_range",   label: "Age",       order: AGE_ORDER },
  { key: "nen_type",    label: "Nen Type" },
  { key: "affiliation", label: "Affiliation" },
  { key: "first_arc",   label: "First Arc", order: ARC_ORDER },
  { key: "status",      label: "Status" },
];

// Nen type text: raw -> display (the data is already in "-er" form; this also covers raw names)
const NEN_DISPLAY = {
  enhancement: "Enhancer", transmutation: "Transmuter", emission: "Emitter",
  manipulation: "Manipulator", conjuration: "Conjurer", specialization: "Specialist",
};

const LAUNCH_DAY = 20763;   // arbitrary start for the daily rotation; keep fixed once you launch
const SHUFFLE_SEED = 1337;  // change only if you want a brand-new daily order
// ==========================================

const $ = id => document.getElementById(id);
const isUnknown = v => v == null || String(v).trim().toLowerCase() === "unknown";

let ALL = [], POOL = [];
let answer = null, guesses = [], mode = "daily", done = false, gaveUp = false, hintOpen = false, hintSeen = 0;
let suggestions = [], selIdx = -1;

// ---------- helpers ----------
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const r = seededRandom(seed), a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Local-date day number, so the puzzle flips at the player's midnight
function todayNumber() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function displayValue(col, v) {
  if (isUnknown(v)) return "?";
  if (col.key === "nen_type") return NEN_DISPLAY[String(v).toLowerCase()] || v;
  return v;
}
function imgSrc(c) { return IMAGE_DIR + encodeURIComponent(c.image_file); }
function thumb(c, cls = "thumb") {
  const img = document.createElement("img");
  img.className = cls; img.alt = ""; img.loading = "lazy"; img.src = imgSrc(c);
  img.onerror = () => { img.style.visibility = "hidden"; };
  return img;
}

// ---------- comparison ----------
function compare(col, guess, ans) {
  const g = guess[col.key], a = ans[col.key];
  const same = String(g).toLowerCase() === String(a).toLowerCase();
  let arrow = "";
  if (!same && col.order && !isUnknown(g) && !isUnknown(a)) {
    const gi = col.order.indexOf(g), ai = col.order.indexOf(a);
    if (gi !== -1 && ai !== -1) arrow = ai > gi ? "↑" : "↓";
  }
  return { correct: same, arrow };
}

// ---------- rendering ----------
function renderHead() {
  const head = $("head-row");
  head.innerHTML = "";
  const blank = document.createElement("div"); blank.className = "h"; blank.textContent = "Character";
  head.appendChild(blank);
  COLUMNS.forEach(c => {
    const d = document.createElement("div"); d.className = "h"; d.textContent = c.label;
    head.appendChild(d);
  });
}
function buildRow(guess, isNew) {
  const row = document.createElement("div");
  row.className = "row" + (isNew ? " new" : "");

  const who = document.createElement("div"); who.className = "cell who";
  who.appendChild(thumb(guess));
  const nm = document.createElement("span"); nm.textContent = guess.name;
  who.appendChild(nm);
  row.appendChild(who);

  COLUMNS.forEach(col => {
    const res = compare(col, guess, answer);
    const cell = document.createElement("div");
    cell.className = "cell " + (res.correct ? "correct" : "wrong");
    const t = document.createElement("span"); t.textContent = displayValue(col, guess[col.key]);
    cell.appendChild(t);
    if (res.arrow) {
      const ar = document.createElement("span"); ar.className = "arrow"; ar.textContent = res.arrow;
      cell.appendChild(ar);
    }
    row.appendChild(cell);
  });
  return row;
}
function renderRows(newestIsNew = false) {
  const rows = $("rows");
  rows.innerHTML = "";
  // newest guess on top
  for (let i = guesses.length - 1; i >= 0; i--) {
    rows.appendChild(buildRow(guesses[i], newestIsNew && i === guesses.length - 1));
  }
  if (gaveUp) {                      // reveal the answer's own row on top
    const r = buildRow(answer, false);
    r.classList.add("answer-row");
    rows.insertBefore(r, rows.firstChild);
  }
}

// ---------- autocomplete ----------
function updateSuggestions() {
  const q = $("input").value.trim().toLowerCase();
  const list = $("suggestions");
  list.innerHTML = ""; selIdx = -1;
  if (!q || done) { suggestions = []; return; }
  const taken = new Set(guesses.map(g => g.name));
  suggestions = ALL
    .filter(c => !taken.has(c.name) && c.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name);
    })
    .slice(0, 8);
  suggestions.forEach((c, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.appendChild(thumb(c));
    const s = document.createElement("span"); s.textContent = c.name; li.appendChild(s);
    li.addEventListener("mousedown", e => { e.preventDefault(); submitGuess(c); });
    list.appendChild(li);
  });
}
function highlight() {
  [...$("suggestions").children].forEach((li, i) => li.classList.toggle("sel", i === selIdx));
}

// ---------- game flow ----------
function submitGuess(c) {
  if (done || guesses.some(g => g.name === c.name)) return;
  const levelBefore = hintLevel();
  guesses.push(c);
  if (hintLevel() > levelBefore) hintOpen = false;     // a new hint unlocked: the player has to click to see it
  $("input").value = ""; updateSuggestions();
  renderRows(true);
  if (c.name === answer.name) finish(true);
  if (mode === "daily") saveDaily();
  updateHint();
}

// ---------- help: list of affiliations (built from characters.json, so it never goes stale) ----------
function renderHelpLists() {
  // order by first appearance in the show: earliest arc, then position in characters.json
  const firstSeen = new Map();                       // affiliation -> [arc index, position in file]
  ALL.forEach((c, i) => {
    const aff = c.affiliation;
    if (isUnknown(aff) || aff === "None") return;
    const arc = ARC_ORDER.indexOf(c.first_arc), arcIdx = arc === -1 ? 999 : arc;
    const cur = firstSeen.get(aff);
    if (!cur || arcIdx < cur[0]) firstSeen.set(aff, [arcIdx, i]);
  });
  const affs = [...firstSeen.keys()].sort((x, y) => {
    const p = firstSeen.get(x), q = firstSeen.get(y);
    return p[0] - q[0] || p[1] - q[1];
  });
  if (ALL.some(c => c.affiliation === "None")) affs.push("None");
  let p = $("help-affs");
  if (!p) { p = document.createElement("p"); p.id = "help-affs"; p.className = "arcs"; $("help").appendChild(p); }
  p.textContent = "";
  const label = document.createElement("b"); label.textContent = "Affiliations: ";
  p.append(label, affs.join(" · "));
}

// ---------- yesterday's character ----------
function showYesterday() {
  let el = $("yesterday");
  if (!el) {
    el = document.createElement("p"); el.id = "yesterday";
    $("subtitle").insertAdjacentElement("afterend", el);
  }
  const prev = todayNumber() - 1 - LAUNCH_DAY;       // yesterday's slot in the daily rotation
  if (prev < 0 || !POOL.length) { el.hidden = true; return; }
  const order = seededShuffle(POOL, SHUFFLE_SEED);
  const c = order[prev % order.length];
  el.hidden = false; el.textContent = "";
  el.append(thumb(c), "Yesterday's character was ");
  const b = document.createElement("b"); b.textContent = c.name;
  el.append(b);
}

// ---------- hints + give up ----------
function hintLevel() { return Math.min(Math.floor(guesses.length / HINT_EVERY), HINT_BLUR.length); }

function buildTools() {
  const tools = document.createElement("div");
  tools.id = "tools";
  tools.innerHTML = '<button id="hint-btn" type="button"></button><button id="giveup-btn" type="button">Give up</button>';
  $("search").insertAdjacentElement("afterend", tools);

  const panel = document.createElement("div");
  panel.id = "hint-panel"; panel.hidden = true;
  panel.innerHTML = '<div class="hint-img"><img id="hint-img" alt="Blurred hint" draggable="false"></div><p id="hint-note"></p>';
  tools.insertAdjacentElement("afterend", panel);

  $("hint-btn").onclick = () => { hintOpen = !hintOpen; updateHint(); };
  $("giveup-btn").onclick = giveUp;
}
function updateHint() {
  const tools = $("tools");
  if (!tools) return;
  tools.hidden = done;
  const panel = $("hint-panel"), btn = $("hint-btn");
  if (done || !answer) { panel.hidden = true; return; }
  const lvl = hintLevel(), max = HINT_BLUR.length;
  const toNext = HINT_EVERY - (guesses.length % HINT_EVERY);
  const plural = n => (n === 1 ? "guess" : "guesses");
  if (lvl === 0) {
    btn.disabled = true; btn.textContent = "Hint in " + toNext + " " + plural(toNext);
    panel.hidden = true; hintOpen = false;
    return;
  }
  if (hintOpen) hintSeen = lvl;
  btn.disabled = false;
  btn.textContent = hintOpen ? "Hide hint" : (lvl > hintSeen ? "Show hint (new)" : "Show hint");
  panel.hidden = !hintOpen;
  const img = $("hint-img");
  const src = imgSrc(answer);
  if (img.getAttribute("src") !== src) img.src = src;
  img.style.filter = "blur(" + HINT_BLUR[lvl - 1] + "px)";
  $("hint-note").textContent = lvl < max
    ? "Hint " + lvl + " of " + max + " · clearer in " + toNext + " " + plural(toNext)
    : "Hint " + lvl + " of " + max + " · clearest hint";
}
function giveUp() {
  if (done) return;
  if (!confirm("Give up and reveal the answer?")) return;
  gaveUp = true;
  renderRows(false);
  finish(false);
  if (mode === "daily") saveDaily();
}
function finish(won) {
  done = true;
  $("input").disabled = true;
  $("input").placeholder = won ? "Solved!" : "Answer revealed";
  const b = $("banner");
  b.hidden = false; b.innerHTML = "";
  b.appendChild(thumb(answer, ""));
  const h = document.createElement("h2"); h.textContent = answer.name; b.appendChild(h);
  const p = document.createElement("p");
  const n = guesses.length;
  p.textContent = won
    ? `Found in ${n} guess${n === 1 ? "" : "es"}.`
    : `You gave up after ${n} guess${n === 1 ? "" : "es"}.`;
  if (mode === "daily" && won) {
    const s = recordStats(won);
    p.textContent += ` Streak: ${s.streak} · Best: ${s.best} · Solved: ${s.wins}`;
  }
  b.appendChild(p);
  if (won) {
    const share = document.createElement("button"); share.textContent = "Copy result";
    share.onclick = () => copyShare(share);
    b.appendChild(share);
  }
  if (mode === "daily") {
    document.dispatchEvent(new CustomEvent(won ? "hunterdle:solved" : "hunterdle:gaveup", { detail: { day: todayNumber(), guesses: guesses.length } }));
  }
  if (mode === "practice") {
    const again = document.createElement("button"); again.className = "alt"; again.textContent = "Another one";
    again.onclick = () => startGame("practice");
    b.appendChild(again);
  }
  updateHint();
}
function shareText() {
  const label = mode === "daily" ? `Hunterdle #${todayNumber() - LAUNCH_DAY}` : "Hunterdle (practice)";
  const lines = [...guesses].map(g =>
    COLUMNS.map(col => {
      const r = compare(col, g, answer);
      return r.correct ? "🟩" : r.arrow === "↑" ? "🔼" : r.arrow === "↓" ? "🔽" : "🟥";
    }).join("")
  );
  return `${label} — ${guesses.length} guesses\n${lines.join("\n")}`;
}
function copyShare(btn) {
  const text = shareText();
  const ok = () => { btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = "Copy result"), 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok, () => prompt("Copy:", text));
  else prompt("Copy:", text);
}

// ---------- persistence (localStorage, wrapped in try/catch) ----------
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

function saveDaily() { save("hunterdle-daily", { day: todayNumber(), names: guesses.map(g => g.name), gaveUp }); }
function recordStats(won) {
  const s = load("hunterdle-stats", { wins: 0, streak: 0, best: 0, lastWinDay: null });
  const today = todayNumber();
  if (won && s.lastWinDay !== today) {
    s.streak = s.lastWinDay === today - 1 ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.wins += 1; s.lastWinDay = today;
    save("hunterdle-stats", s);
  }
  return s;
}

function startGame(newMode) {
  mode = newMode;
  guesses = []; done = false; gaveUp = false; hintOpen = false; hintSeen = 0;
  $("input").disabled = false; $("input").placeholder = "Type a character name…"; $("input").value = "";
  $("banner").hidden = true; $("rows").innerHTML = "";
  $("mode-daily").classList.toggle("active", mode === "daily");
  $("mode-practice").classList.toggle("active", mode === "practice");

  if (mode === "daily") {
    const order = seededShuffle(POOL, SHUFFLE_SEED);
    answer = order[((todayNumber() - LAUNCH_DAY) % order.length + order.length) % order.length];
    $("subtitle").textContent = "Identify today's character.";
    const saved = load("hunterdle-daily", null);
    if (saved && saved.day === todayNumber()) {
      guesses = saved.names.map(n => ALL.find(c => c.name === n)).filter(Boolean);
      gaveUp = !!saved.gaveUp;
      renderRows(false);
      if (gaveUp) finish(false);
      else if (guesses.some(g => g.name === answer.name)) finish(true);
    }
  } else {
    answer = POOL[Math.floor(Math.random() * POOL.length)];
    $("subtitle").textContent = "Practice round — random character.";
  }
  showYesterday();
  updateHint();
  $("input").focus();
}

// ---------- init ----------
async function init() {
  renderHead();
  buildTools();
  try {
    const res = await fetch("characters.json");
    ALL = await res.json();
  } catch (e) {
    $("subtitle").textContent = "Couldn't load characters.json (open the site through a web server, not file://).";
    return;
  }
  POOL = ALL.filter(c => COLUMNS.filter(col => !isUnknown(c[col.key])).length >= MIN_KNOWN_FIELDS);
  renderHelpLists();

  $("input").addEventListener("input", updateSuggestions);
  $("input").addEventListener("keydown", e => {
    if (!suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); selIdx = (selIdx + 1) % suggestions.length; highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = (selIdx - 1 + suggestions.length) % suggestions.length; highlight(); }
    else if (e.key === "Enter") { e.preventDefault(); submitGuess(suggestions[selIdx >= 0 ? selIdx : 0]); }
    else if (e.key === "Escape") { $("input").value = ""; updateSuggestions(); }
  });
  $("input").addEventListener("blur", () => setTimeout(() => ($("suggestions").innerHTML = ""), 100));
  $("input").addEventListener("focus", updateSuggestions);

  $("mode-daily").onclick = () => startGame("daily");
  $("mode-practice").onclick = () => startGame("practice");
  $("help-btn").onclick = () => { $("help").hidden = !$("help").hidden; };

  startGame("daily");
}
init();