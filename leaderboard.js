// Daily leaderboard backed by Supabase (free tier). Self-contained: injects its own UI.
(() => {
  // ================= CONFIG =================
  const SUPABASE_URL = "https://gwqmwycinberfnpqlxtw.supabase.co";   // e.g. "https://abcdxyz.supabase.co"
  const SUPABASE_KEY = "sb_publishable_HadyDhievznO7qpu3NX2SQ_BKlJ-Rfd";   // the publishable (or legacy anon) key — safe to put in public code
  const TOP_N = 25;
  // ==========================================

  if (!SUPABASE_URL || !SUPABASE_KEY) return;   // leaderboard stays off until configured

  const $ = id => document.getElementById(id);
  const NAME_KEY = "hunterdle-name", PID_KEY = "hunterdle-pid", SUBMITTED_KEY = "hunterdle-submitted";

  const load = (k, fb = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const todayNumber = () => {
    const d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (c === "x" ? r : (r & 3) | 8).toString(16);
      }));
  const playerId = () => { let id = load(PID_KEY); if (!id) { id = uuid(); save(PID_KEY, id); } return id; };
  const getName = () => load(NAME_KEY);

  const headers = () => {
    const h = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
    if (SUPABASE_KEY.startsWith("eyJ")) h.Authorization = "Bearer " + SUPABASE_KEY;   // legacy JWT-style keys
    return h;
  };

  // ---------- UI ----------
  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="name-dialog">
      <form id="name-form">
        <h2>Choose your hunter name</h2>
        <p>Shown on the daily leaderboard. You'll only be asked once on this device.</p>
        <input id="name-input" maxlength="16" autocomplete="off" placeholder="2–16 characters">
        <div id="name-error"></div>
        <button class="lb-btn" type="submit">Save name</button>
        <button class="lb-btn alt" type="button" id="name-cancel" hidden>Cancel</button>
      </form>
    </dialog>
    <dialog id="lb-dialog">
      <h2>Today's Leaderboard</h2>
      <p>Fewest guesses wins. Ties go to whoever solved first. Players who gave up are listed at the bottom.</p>
      <div id="lb-status"></div>
      <ol id="lb-list"></ol>
      <div id="lb-foot">
        <span>Playing as <b id="lb-me"></b> · <button class="link" id="lb-rename" type="button">change</button></span>
        <button class="lb-btn alt" id="lb-close" type="button">Close</button>
      </div>
    </dialog>`);

  const lbBtn = document.createElement("button");
  lbBtn.id = "lb-btn"; lbBtn.textContent = "Leaderboard";
  const modes = document.querySelector(".modes");
  modes.insertBefore(lbBtn, $("help-btn"));

  // ---------- name entry ----------
  const nameDlg = $("name-dialog");
  nameDlg.addEventListener("cancel", e => { if (!getName()) e.preventDefault(); });   // required on first visit
  $("name-cancel").onclick = () => nameDlg.close();

  function askName() {
    $("name-input").value = getName() || "";
    $("name-error").textContent = "";
    $("name-cancel").hidden = !getName();
    if (!nameDlg.open) nameDlg.showModal();
    $("name-input").focus();
  }
  $("name-form").addEventListener("submit", e => {
    e.preventDefault();
    const name = $("name-input").value.replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 16) { $("name-error").textContent = "Use 2–16 characters."; return; }
    save(NAME_KEY, name);
    nameDlg.close();
    $("lb-me").textContent = name;
    if (pending) submit(pending.day, pending.guesses, pending.gaveUp);
  });

  // ---------- leaderboard ----------
  const lbDlg = $("lb-dialog");
  $("lb-close").onclick = () => lbDlg.close();
  $("lb-rename").onclick = () => { lbDlg.close(); askName(); };
  lbBtn.onclick = openLeaderboard;

  let lbToken = 0;
  async function openLeaderboard() {
    const token = ++lbToken;                      // only the newest call is allowed to draw
    const day = todayNumber();
    $("lb-me").textContent = getName() || "—";
    $("lb-list").replaceChildren();
    $("lb-status").textContent = "Loading…";
    if (!lbDlg.open) lbDlg.showModal();
    try {
      const url = `${SUPABASE_URL}/rest/v1/scores?select=name,guesses,gave_up&day=eq.${day}` +
                  `&order=gave_up.asc,guesses.asc,created_at.asc&limit=${TOP_N}`;
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      if (token !== lbToken) return;              // a newer open superseded this one
      $("lb-status").textContent = rows.length ? "" : "No scores yet today — be the first!";
      const mine = load(SUBMITTED_KEY);
      let place = 0, rank = 0, prevScore = null;
      const items = rows.map(r => {
        const li = document.createElement("li");
        const isMine = mine && mine.day === day && r.name === getName() &&
                       !!r.gave_up === !!mine.gaveUp && (r.gave_up || r.guesses === mine.guesses);
        li.className = (isMine ? "me " : "") + (r.gave_up ? "gaveup" : "");
        const rk = document.createElement("span"); rk.className = "rank";
        const sc = document.createElement("span"); sc.className = "sc";
        if (r.gave_up) {
          rk.textContent = "—";
          sc.textContent = "Gave up";
        } else {
          place++;
          if (r.guesses !== prevScore) rank = place;
          prevScore = r.guesses;
          rk.textContent = ["🥇", "🥈", "🥉"][rank - 1] || rank;
          sc.textContent = r.guesses;
        }
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = r.name;
        li.append(rk, nm, sc);
        return li;
      });
      $("lb-list").replaceChildren(...items);
    } catch (e) {
      console.warn("Leaderboard load failed:", e);
      if (token === lbToken) $("lb-status").textContent = "Couldn't load the leaderboard. Try again later.";
    }
  }

  // ---------- submitting a score ----------
  let pending = null, submitting = false;
  async function submit(day, guesses, gaveUp = false) {
    const name = getName();
    if (!name) { pending = { day, guesses, gaveUp }; return; }
    const done = load(SUBMITTED_KEY);
    if (done && done.day === day) return;            // already submitted today
    if (submitting) return;                          // a submit is already in flight
    submitting = true;
    pending = null;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/scores?on_conflict=day,player_id`, {
        method: "POST",
        headers: { ...headers(), Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ day, player_id: playerId(), name, guesses, gave_up: gaveUp }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      save(SUBMITTED_KEY, { day, guesses, gaveUp });
      openLeaderboard();
    } catch (e) {
      console.warn("Score submit failed (will retry next visit):", e);
    } finally {
      submitting = false;
    }
  }

  // app.js fires these when the daily puzzle ends (also when reloading an already-finished day)
  document.addEventListener("hunterdle:solved", e => submit(e.detail.day, e.detail.guesses, false));
  document.addEventListener("hunterdle:gaveup", e => submit(e.detail.day, e.detail.guesses, true));

  if (!getName()) askName();
})();