// Character popularity: rate the day's character after finishing, plus a ranked list tab.
// Reuses the Supabase settings from leaderboard.js (it publishes them as window.HUNTERDLE_SUPABASE).
(() => {
  const cfg = window.HUNTERDLE_SUPABASE;
  if (!cfg || !cfg.url || !cfg.key) {
    console.warn("Popularity tab is off: leaderboard.js has no Supabase URL/key (or doesn't publish them).");
    return;
  }
  const $ = id => document.getElementById(id);
  const PID_KEY = "hunterdle-pid", RATED_KEY = "hunterdle-rated", UNLOCK_KEY = "hunterdle-popunlock";
  const IMG_DIR = (typeof IMAGE_DIR !== "undefined") ? IMAGE_DIR : "HxH_Wordle_Images/";

  const load = (k, fb = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      }));
  const playerId = () => { let id = load(PID_KEY); if (!id) { id = uuid(); save(PID_KEY, id); } return id; };
  const todayNumber = () => {
    const d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  };
  // the tab unlocks once today's daily puzzle is finished (solved or given up)
  const isUnlocked = () => {
    const rated = load(RATED_KEY);
    return load(UNLOCK_KEY) === todayNumber() || !!(rated && rated.day === todayNumber());
  };
  const headers = () => {
    const h = { apikey: cfg.key, "Content-Type": "application/json" };
    if (cfg.key.startsWith("eyJ")) h.Authorization = "Bearer " + cfg.key;
    return h;
  };

  // ---------- rating box (shown in the result banner after a daily puzzle ends) ----------
  function renderRating(banner, name, day) {
    const old = banner.querySelector(".rate-box"); if (old) old.remove();
    const box = document.createElement("div"); box.className = "rate-box";
    banner.appendChild(box);

    const done = load(RATED_KEY);
    if (done && done.day === day) {
      thanks(box, done.character === name ? name : null, done.rating);
      return;
    }
    const q = document.createElement("p"); q.textContent = "How much do you like " + name + "?";
    const btns = document.createElement("div"); btns.className = "rate-btns";
    const send = document.createElement("button");
    send.type = "button"; send.className = "rate-submit"; send.textContent = "Pick a rating"; send.disabled = true;
    const err = document.createElement("p"); err.className = "err";
    let chosen = 0;
    for (let n = 1; n <= 10; n++) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = n;
      b.onclick = () => {                       // selecting only highlights; nothing is sent yet
        chosen = n;
        btns.querySelectorAll("button").forEach(x => x.classList.toggle("selected", x === b));
        send.disabled = false; send.textContent = "Submit " + n + "/10";
        err.textContent = "";
      };
      btns.appendChild(b);
    }
    send.onclick = () => { if (chosen) submitRating(name, day, chosen, box, err); };
    box.append(q, btns, send, err);
  }
  function thanks(box, name, rating) {
    box.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = name && rating ? "You rated " + name + " " + rating + "/10. Thanks!" : "You've already rated today's character. Thanks!";
    const b = document.createElement("button"); b.className = "alt"; b.textContent = "See popularity";
    b.onclick = showPop;
    box.append(p, b);
  }
  async function submitRating(name, day, rating, box, err) {
    const controls = box.querySelectorAll("button");
    controls.forEach(b => (b.disabled = true));
    err.textContent = "";
    try {
      const res = await fetch(cfg.url + "/rest/v1/ratings", {
        method: "POST",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify({ day, player_id: playerId(), character_name: name, rating }),
      });
      if (!res.ok && res.status !== 409) throw new Error("HTTP " + res.status);   // 409 = already rated today
      save(RATED_KEY, { day, character: name, rating: res.ok ? rating : null });
      stale = true;
      thanks(box, res.ok ? name : null, res.ok ? rating : null);
    } catch (e) {
      console.warn("Rating failed:", e);
      err.textContent = "Couldn't save your rating. Try again.";
      controls.forEach(b => (b.disabled = false));
    }
  }
  function onFinish(e) {
    save(UNLOCK_KEY, e.detail.day);
    refreshLock();
    const banner = $("banner"), h = banner && banner.querySelector("h2");
    if (h) renderRating(banner, h.textContent, e.detail.day);
  }
  document.addEventListener("hunterdle:solved", onFinish);
  document.addEventListener("hunterdle:gaveup", onFinish);

  // ---------- popularity tab ----------
  const main = document.querySelector("main"), modes = document.querySelector(".modes");
  const popBtn = document.createElement("button");
  popBtn.id = "pop-btn"; popBtn.textContent = "Popularity";
  modes.insertBefore(popBtn, $("help-btn"));

  const sec = document.createElement("section");
  sec.id = "popularity";
  sec.innerHTML = '<button id="pop-back" type="button">← Back to game</button>' +
    "<h2>Character Popularity</h2>" +
    '<p class="sub">Average rating (1–10) from players who finished the daily puzzle.</p>' +
    '<p id="pop-locked">🔒 Locked until you finish today\'s puzzle. Solve it or give up to unlock the popularity list.</p>' +
    '<div id="pop-status"></div><ol id="pop-list"></ol>';
  main.appendChild(sec);

  let prevActive = [], stale = true, chars = null;
  function showPop() {
    if (!main.classList.contains("pop-view")) {
      prevActive = [...modes.querySelectorAll("button.active")].filter(b => b !== popBtn).map(b => b.id);
      prevActive.forEach(id => $(id).classList.remove("active"));
    }
    main.classList.add("pop-view"); popBtn.classList.add("active");
    window.scrollTo(0, 0);
    const open = isUnlocked();
    sec.classList.toggle("locked", !open);
    if (open && stale) loadList();
  }
  function refreshLock() { popBtn.textContent = isUnlocked() ? "Popularity" : "Popularity 🔒"; }
  refreshLock();
  function backToGame() {
    main.classList.remove("pop-view"); popBtn.classList.remove("active");
    prevActive.forEach(id => $(id).classList.add("active"));
    prevActive = [];
  }
  popBtn.onclick = showPop;
  $("pop-back").onclick = backToGame;
  // Daily / Practice buttons leave the tab (app.js then sets their active state itself)
  ["mode-daily", "mode-practice"].forEach(id => $(id).addEventListener("click", () => {
    main.classList.remove("pop-view"); popBtn.classList.remove("active"); prevActive = [];
  }));

  async function loadList() {
    $("pop-status").textContent = "Loading…"; $("pop-list").replaceChildren();
    try {
      if (!chars) {
        const r = await fetch("characters.json");
        chars = new Map((await r.json()).map(c => [c.name, c]));
      }
      const url = cfg.url + "/rest/v1/character_popularity?select=character_name,avg_rating,votes" +
                  "&order=avg_rating.desc,votes.desc&limit=1000";
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = (await res.json()).filter(r => chars.has(r.character_name));   // ignore junk names
      $("pop-status").textContent = rows.length ? "" : "No ratings yet. Finish the daily puzzle and be the first to rate!";
      let rank = 0, prev = null;
      const items = rows.map((r, i) => {
        const key = r.avg_rating + "|" + r.votes;
        if (key !== prev) rank = i + 1;
        prev = key;
        const c = chars.get(r.character_name);
        const li = document.createElement("li");
        const rk = document.createElement("span"); rk.className = "rank"; rk.textContent = ["🥇", "🥈", "🥉"][rank - 1] || rank;
        const img = document.createElement("img"); img.className = "thumb"; img.alt = ""; img.loading = "lazy";
        img.src = IMG_DIR + encodeURIComponent(c.image_file);
        img.onerror = () => { img.style.visibility = "hidden"; };
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = c.name;
        const small = document.createElement("small"); small.textContent = r.votes + (Number(r.votes) === 1 ? " vote" : " votes");
        nm.appendChild(small);
        const avg = document.createElement("span"); avg.className = "avg"; avg.textContent = Number(r.avg_rating).toFixed(2);
        li.append(rk, img, nm, avg);
        return li;
      });
      $("pop-list").replaceChildren(...items);
      stale = false;
    } catch (e) {
      console.warn("Popularity load failed:", e);
      $("pop-status").textContent = "Couldn't load the popularity list. Try again later.";
    }
  }
})();