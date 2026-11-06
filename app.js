// ================= CONFIG =================
const IMAGE_DIR = "HxH_Wordle_Images/";   // folder with your .webp files
const MIN_KNOWN_FIELDS = 4;               // answer pool: characters with at least this many known fields (of 8)

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
let answer = null, guesses = [], mode = "daily", done = false;
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
  guesses.push(c);
  $("input").value = ""; updateSuggestions();
  renderRows(true);
  if (c.name === answer.name) finish(true);
  if (mode === "daily") saveDaily();
}
function finish(won) {
  done = true;
  $("input").disabled = true;
  $("input").placeholder = "Solved!";
  const b = $("banner");
  b.hidden = false; b.innerHTML = "";
  b.appendChild(thumb(answer, ""));
  const h = document.createElement("h2"); h.textContent = answer.name; b.appendChild(h);
  const p = document.createElement("p");
  p.textContent = `Found in ${guesses.length} guess${guesses.length === 1 ? "" : "es"}.`;
  if (mode === "daily") {
    const s = recordStats(won);
    p.textContent += ` Streak: ${s.streak} · Best: ${s.best} · Solved: ${s.wins}`;
  }
  b.appendChild(p);
  const share = document.createElement("button"); share.textContent = "Copy result";
  share.onclick = () => copyShare(share);
  b.appendChild(share);
  if (mode === "practice") {
    const again = document.createElement("button"); again.className = "alt"; again.textContent = "Another one";
    again.onclick = () => startGame("practice");
    b.appendChild(again);
  }
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

function saveDaily() { save("hunterdle-daily", { day: todayNumber(), names: guesses.map(g => g.name) }); }
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
  guesses = []; done = false;
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
      renderRows(false);
      if (guesses.some(g => g.name === answer.name)) finish(true);
    }
  } else {
    answer = POOL[Math.floor(Math.random() * POOL.length)];
    $("subtitle").textContent = "Practice round — random character.";
  }
  $("input").focus();
}

// ---------- init ----------
async function init() {
  renderHead();
  try {
    const res = await fetch("characters.json");
    ALL = await res.json();
  } catch (e) {
    $("subtitle").textContent = "Couldn't load characters.json (open the site through a web server, not file://).";
    return;
  }
  POOL = ALL.filter(c => COLUMNS.filter(col => !isUnknown(c[col.key])).length >= MIN_KNOWN_FIELDS);

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
