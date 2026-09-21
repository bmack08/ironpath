/* ============================================================
   IRONPATH — app logic
   State lives in progress.json via the local Python server.
   ============================================================ */

'use strict';

/* ---------------- helpers ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const chainById = id => CHAINS.find(c => c.id === id);
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function fmtTarget(scheme, target) {
  switch (scheme.type) {
    case 'reps': return `${scheme.sets}×${target}`;
    case 'reps-side': return `${scheme.sets}×${target}/side`;
    case 'hold': return `${scheme.sets}×${target}s`;
    case 'neg': return `${scheme.sets}×${target} neg`;
    default: return `${scheme.sets}×${target}`;
  }
}
function fmtPill(scheme, target) {
  switch (scheme.type) {
    case 'hold': return `${target}s`;
    case 'neg': return `${target}×5s`;
    case 'reps-side': return `${target}/s`;
    default: return `${target}`;
  }
}
function deloadActive() { return !!(state && state.deload && state.deload.active); }
function setsFor(scheme) { return deloadActive() ? Math.max(1, Math.ceil(scheme.sets / 2)) : scheme.sets; }
function dayTarget(scheme, target, dayKey) {
  if (deloadActive()) return Math.max(1, Math.round(target * 0.7));
  if (dayKey === 'B') return Math.max(1, Math.round(target * 0.8));
  return target;
}
function stepFor(scheme) { return scheme.type === 'hold' ? 5 : 1; }

/* ---------------- state ---------------- */

let state = null;
let saveTimer = null;

function defaultState() {
  const chains = {};
  for (const c of CHAINS) {
    chains[c.id] = { level: 0, target: c.levels[0].scheme.start, ready: false, passedAt: {} };
  }
  return {
    startDate: todayStr(),
    chains,
    sessions: {},          // date -> { day }
    sessionCount: 0,
    activeSession: null,   // { day, date, log: {chainId: [n|null,...]}, amrap: {chainId:n} }
    view: 'today',
  };
}

/* Storage: localStorage is the source of truth on every device (phone-safe,
   offline-safe). When the desktop Python server is reachable, progress.json is
   kept in sync too — newer copy wins on load, so desktop and phone can both
   be used against the same file when served over LAN. */

const LS_KEY = 'ironpath-state';

function save() {
  state.updatedAt = Date.now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  mirrorMeta();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/state', { method: 'POST', body: JSON.stringify(state) }).catch(() => {});
  }, 250);
}

/* the service worker can't read localStorage — mirror what reminders need
   into a cache entry it CAN read (preserving its own lastNotified stamp) */
async function mirrorMeta() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('ironpath-meta');
    const prev = await cache.match('meta');
    const old = prev ? await prev.json() : {};
    const nd = nextDayKey();
    await cache.put('meta', new Response(JSON.stringify({
      remindersOn: !!state.remindersOn,
      last: state.lastSessionAt || null,
      nextDay: nd,
      nextName: DAYS[nd].name,
      lastNotified: old.lastNotified || null,
    })));
  } catch { /* cache unavailable — reminders just won't fire */ }
}

/* ---------- reminders ---------- */

async function enableReminders() {
  if (!('Notification' in window)) { toast('This browser does not support notifications.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are blocked — allow them in your browser settings, then try again.');
    return;
  }
  state.remindersOn = true;
  let bg = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      await reg.periodicSync.register('ironpath-reminder', { minInterval: 12 * 60 * 60 * 1000 });
      bg = true;
    }
  } catch { /* periodic sync denied — in-app nudges still work */ }
  state.remindersBg = bg;
  save();
  toast(bg ? '🔔 Reminders on — you\'ll get a nudge when the 48h window closes.'
           : '🔔 Reminders on — this browser only allows nudges while the app is open.');
  render();
}

async function disableReminders() {
  state.remindersOn = false;
  save();
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.unregister('ironpath-reminder');
  } catch { /* fine */ }
  toast('Reminders off.');
  render();
}

function dismissReminders() {
  state.remindersDismissed = true;
  save();
  render();
}

async function load() {
  let local = null;
  try { local = JSON.parse(localStorage.getItem(LS_KEY)); } catch { /* corrupt/blocked */ }

  let remote = null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch('/api/state', { signal: ctl.signal });
    clearTimeout(t);
    remote = await res.json();
  } catch { /* no server here (phone / file://) — localStorage carries it */ }

  const newer = (a, b) => ((a?.updatedAt || 0) >= (b?.updatedAt || 0) ? a : b);
  state = (local && remote) ? newer(local, remote) : (local || remote || defaultState());

  // merge in any chains added after the user's save was created
  for (const c of CHAINS) {
    if (!state.chains[c.id]) {
      state.chains[c.id] = { level: 0, target: c.levels[0].scheme.start, ready: false, passedAt: {} };
    }
  }
}

/* ---------------- derived ---------------- */

function nextDayKey() {
  return ['A', 'B', 'C'][state.sessionCount % 3];
}
function escapedBeginner(chainId) {
  const c = chainById(chainId);
  const cur = c.levels[Math.min(state.chains[chainId].level, c.levels.length - 1)];
  return state.chains[chainId].level >= c.levels.length || cur.band !== 'beg';
}
function chainPct(chainId) {
  const c = chainById(chainId);
  return Math.min(1, state.chains[chainId].level / c.levels.length);
}
function currentLevel(chainId) {
  const c = chainById(chainId);
  const idx = Math.min(state.chains[chainId].level, c.levels.length - 1);
  return { level: c.levels[idx], idx, complete: state.chains[chainId].level >= c.levels.length };
}
function streak() {
  const dates = Object.keys(state.sessions).sort();
  if (!dates.length) return 0;
  let s = 1;
  for (let i = dates.length - 1; i > 0; i--) {
    if (daysBetween(dates[i - 1], dates[i]) <= 3) s++;
    else break;
  }
  // streak dies if last session was more than 3 days ago
  if (daysBetween(dates[dates.length - 1], todayStr()) > 3) return 0;
  return s;
}
function missionDay() {
  return Math.min(MISSION_DAYS, daysBetween(state.startDate, todayStr()) + 1);
}
function phaseStatus(phase) {
  const met = phase.reqs.map(r => {
    const c = chainById(r.chain);
    const idx = c.levels.findIndex(l => l.name === r.level);
    return { ...r, met: state.chains[r.chain].level > idx, name: r.level };
  });
  const n = met.filter(m => m.met).length;
  return { met, n, total: met.length, pct: n / met.length };
}

/* ---------------- rendering ---------------- */

const stage = $('#stage');
let activeView = 'today';
let ladderChain = 'row';

function setView(v) {
  const apply = () => {
    activeView = v;
    state.view = v;
    $$('.rail-link').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  // smooth cross-fade between tabs where the browser supports it
  if (document.startViewTransition && v !== activeView) document.startViewTransition(apply);
  else apply();
  save();
}

function render() {
  $('#streakNum').textContent = streak();
  switch (activeView) {
    case 'today': renderToday(); break;
    case 'train': renderTrain(); break;
    case 'ladders': renderLadders(); break;
    case 'roadmap': renderRoadmap(); break;
    case 'recover': renderRecover(); break;
  }
}

function rv(i) { return `class="reveal" style="animation-delay:${i * 60}ms"`; }

/* ---------- TODAY ---------- */

function renderToday() {
  const dayKey = nextDayKey();
  const day = DAYS[dayKey];
  const d = new Date();
  const dateLine = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const escaped = CHAINS.filter(c => escapedBeginner(c.id)).length;
  const mDay = missionDay();
  const readyCount = CHAINS.filter(c => state.chains[c.id].ready && !currentLevel(c.id).complete).length;
  const trainedToday = !!state.sessions[todayStr()];

  const expressToday = trainedToday && state.sessions[todayStr()].express;

  const heroInner = trainedToday
    ? `<div class="hero-date">${dateLine}</div>
       <h1 class="hero-title">SESSION<br><span class="accent">BANKED.</span></h1>
       <p class="hero-tag">${expressToday
          ? `Engine session in the log — ${state.sessions[todayStr()].engine.rounds} rounds — and the streak holds. Targets did not move, so Session ${dayKey} · ${day.name} is still sitting there for the day you have the full hour.`
          : `Today's work is done. Protein, water, walk, sleep — the adaptation is happening right now. Next up: Session ${nextDayKey()} · ${DAYS[nextDayKey()].name} in ~48h.`}</p>
       <div class="hero-actions">
         ${expressToday ? `<button class="btn ghost" onclick="startFocus()">DO THE FULL SESSION ▸</button>` : ''}
         <button class="btn ghost" onclick="setView('recover')">RECOVERY PROTOCOL</button>
         <button class="btn ghost" onclick="shareStats()">📸 SHARE CARD</button>
       </div>`
    : deloadActive()
    ? `<div class="hero-date">${dateLine}</div>
       <h1 class="hero-title">DELOAD —<br><span class="accent">ON PURPOSE</span></h1>
       <p class="hero-tag">${state.deload.remaining} easy session${state.deload.remaining > 1 ? 's' : ''} left: half sets, ~70% targets, nothing near failure. This is where six weeks of work turns into strength.</p>
       <div class="hero-actions"><button class="btn primary" onclick="startFocus()">START DELOAD SESSION ▸</button></div>`
    : `<div class="hero-date">${dateLine}</div>
       <h1 class="hero-title">SESSION ${dayKey} —<br><span class="accent">${day.name}</span></h1>
       <p class="hero-tag">${day.tagline}</p>
       <div class="hero-actions">
         <button class="btn primary" onclick="startFocus()">START SESSION ▸</button>
         <button class="btn ghost" onclick="openEngine()">⏱ SHORT ON TIME</button>
         ${readyCount ? `<button class="btn ghost" onclick="setView('ladders')">⚡ ${readyCount} TEST-OUT${readyCount > 1 ? 'S' : ''} READY</button>` : ''}
         ${state.sessionCount > 0 ? `<button class="btn ghost" onclick="shareStats()">📸 SHARE CARD</button>` : ''}
       </div>`;

  const rx = deloadCheck();
  const totalLevels = CHAINS.reduce((s, c) => s + state.chains[c.id].level, 0);
  const showPlacement = !state.placementDone && !state.placementDismissed && totalLevels === 0 && state.sessionCount === 0;
  const hrsSince = state.lastSessionAt ? (Date.now() - state.lastSessionAt) / 3600000 : null;
  const overdue = !trainedToday && hrsSince !== null && hrsSince >= 48;
  const showRemindCard = !state.remindersOn && !state.remindersDismissed && state.sessionCount >= 1;

  stage.innerHTML = `
    <div class="hero reveal">${heroInner}
      ${overdue ? `<div class="overdue mono">⏱ ${Math.round(hrsSince)}h since your last session — the window is open. Tonight counts double for the streak.</div>` : ''}
      <div class="hero-meta">
        <div class="hm"><b>${state.sessionCount}</b><span>Sessions</span></div>
        <div class="hm"><b>${CHAINS.reduce((s, c) => s + state.chains[c.id].level, 0)}</b><span>Levels passed</span></div>
        <div class="hm"><b>${streak()}</b><span>Streak</span></div>
      </div>
    </div>

    ${showRemindCard ? `<div class="remind-card reveal" style="animation-delay:60ms">
      <div class="rx-text">
        <b>⏰ NEVER MISS THE WINDOW</b>
        <p>Get a nudge when 48h passes since your last session, and a streak-saver alert at 68h. Consistency is the whole 30-day mission.</p>
      </div>
      <div class="rx-actions">
        <button class="btn primary small" onclick="enableReminders()">TURN ON REMINDERS</button>
        <button class="btn ghost small" onclick="dismissReminders()">NO THANKS</button>
      </div>
    </div>` : ''}

    ${showPlacement ? `<div class="remind-card reveal" style="animation-delay:60ms" id="placementCard">
      <div class="rx-text">
        <b style="color:var(--ember)">🎯 NEW HERE? FIND YOUR REAL STARTING LEVEL</b>
        <p>Ten quick tests, about ten minutes. Every chain starts exactly where you are — no grinding through levels you've already outgrown.</p>
      </div>
      <div class="rx-actions">
        <button class="btn primary small" onclick="startPlacement()">TAKE THE PLACEMENT</button>
        <button class="btn ghost small" onclick="state.placementDismissed=true;save();render()">START FROM ZERO</button>
      </div>
    </div>` : ''}

    ${rx ? `<div class="deload-rx reveal" style="animation-delay:70ms">
      <div class="rx-text">
        <b>DELOAD PRESCRIBED</b>
        <p>${rx.why} One easy week now beats three stuck weeks later: half sets, 70% targets, progression pauses and resumes stronger.</p>
      </div>
      <div class="rx-actions">
        <button class="btn primary small" onclick="startDeload()">START DELOAD WEEK</button>
        <button class="btn ghost small" onclick="snoozeDeload()">NOT NOW</button>
      </div>
    </div>` : ''}

    <div class="mission reveal" style="animation-delay:80ms">
      <div class="mission-day">${String(mDay).padStart(2, '0')}<small>OF ${MISSION_DAYS} DAYS</small></div>
      <div class="mission-info">
        <h3>MISSION: ESCAPE BEGINNER</h3>
        <p>Clear the beginner band in all 10 chains inside 30 days. Rows, squats and planks fall fast — pull ups and dips are the boss fights.</p>
        <div class="mission-track"><div class="mission-fill" style="width:${(escaped / CHAINS.length) * 100}%"></div></div>
      </div>
      <div class="mission-score"><b>${escaped}/10</b><span>chains escaped</span></div>
    </div>

    <div class="section-label reveal" style="animation-delay:140ms">
      <h2>The Ten Chains</h2><div class="rule"></div>
      <span class="hint">click a chain to open its ladder</span>
    </div>
    <div class="rings-grid">
      ${CHAINS.map((c, i) => {
        const { level, complete } = currentLevel(c.id);
        const pct = chainPct(c.id);
        const circ = 2 * Math.PI * 40;
        const color = complete ? 'var(--pass)' : BANDS[level.band].color;
        const ready = state.chains[c.id].ready && !complete;
        const stalled = !ready && !complete && (state.chains[c.id].missStreak || 0) >= 2;
        return `
        <div class="ring-card reveal" style="animation-delay:${160 + i * 45}ms" onclick="openLadder('${c.id}')">
          ${ready ? '<div class="ready-flag">TEST READY</div>' : ''}
          ${stalled ? '<div class="ready-flag stalled">STALLED</div>' : ''}
          <div class="ring-wrap">
            <svg viewBox="0 0 92 92">
              <circle class="track" cx="46" cy="46" r="40"/>
              <circle class="prog" cx="46" cy="46" r="40" stroke="${color}"
                stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct)}"/>
            </svg>
            <div class="ring-pct">${Math.round(pct * 100)}%</div>
          </div>
          <h4>${c.short}</h4>
          <div class="lvl">${complete ? '✦ CHAIN COMPLETE' : level.name}</div>
          <span class="band-chip band-${complete ? 'elite' : level.band}">${complete ? 'MASTERED' : BANDS[level.band].label}</span>
        </div>`;
      }).join('')}
    </div>

    ${renderLog()}`;
}

/* ---------- TRAINING LOG (history) ---------- */

function renderLog() {
  const entries = Object.entries(state.sessions).sort((a, b) => a[0] < b[0] ? 1 : -1);
  if (!entries.length) return '';

  // 4-week calendar strip, oldest → newest
  let cal = '';
  const today = new Date();
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const s = state.sessions[key];
    const cls = s ? (s.deload ? 'deload' : `day${s.day}`) : 'empty';
    cal += `<div class="cal-cell ${cls} ${i === 0 ? 'today' : ''}" title="${key}${s ? ` · Day ${s.day}${s.engine ? ` · ${s.engine.rounds} rounds` : ''}` : ''}"></div>`;
  }

  const rows = entries.slice(0, 6).map(([date, s]) => {
    const d = new Date(date + 'T12:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div class="log-row">
      <span class="log-date">${label}</span>
      <span class="log-day ${s.deload ? 'deload' : ''}">${s.deload ? 'DELOAD' : `DAY ${s.day} · ${DAYS[s.day] ? DAYS[s.day].name : ''}`}</span>
      <span class="log-vol mono">${s.sets ?? '—'} sets · ${s.reps ?? 0} reps · ${s.holds ?? 0}s</span>
      <span class="log-adv">${s.engine ? `▲ ${s.engine.rounds}${s.engine.extra ? '+' : ''} rounds in ${s.engine.mins} min` : ''}${(s.adv || []).length ? `${s.engine ? ' · ' : ''}▲ ${s.adv.length} hit` : ''}${(s.part || []).length ? ` · ${s.part.length} held` : ''}</span>
    </div>`;
  }).join('');

  return `
    <div class="section-label reveal" style="animation-delay:200ms">
      <h2>Training Log</h2><div class="rule"></div>
      <span class="hint">last 4 weeks</span>
    </div>
    <div class="log-card reveal" style="animation-delay:230ms">
      <div class="cal-strip">${cal}</div>
      <div class="log-rows">${rows}</div>
    </div>`;
}

/* ---------- TRAIN ---------- */

let trainDay = null;

function ensureSession() {
  if (!trainDay) trainDay = state.activeSession ? state.activeSession.day : nextDayKey();
  if (!state.activeSession || state.activeSession.day !== trainDay) {
    state.activeSession = {
      day: trainDay, date: todayStr(),
      log: Object.fromEntries(CHAINS.map(c => {
        const { level } = currentLevel(c.id);
        return [c.id, new Array(setsFor(level.scheme)).fill(null)];
      })),
      amrap: {},
      mods: {},
    };
    save();
  }
  if (!state.activeSession.mods) state.activeSession.mods = {};   // sessions saved before v3
  return state.activeSession;
}

function renderTrain() {
  if (trainDay === 'E') return renderEngine();   // express AMRAP — its own screen
  const ses = ensureSession();
  const day = DAYS[trainDay];
  const totalSets = Object.values(ses.log).reduce((s, a) => s + a.length, 0);
  const doneSets = Object.values(ses.log).reduce((s, a) => s + a.filter(x => x !== null).length, 0);
  const pct = totalSets ? doneSets / totalSets : 0;

  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">3-DAY FULL BODY · PROGRESSIVE OVERLOAD</div>
      <h1 class="page-title">Train</h1>
      <p class="page-sub">Same chains every session — the day type changes the stimulus. Complete every set at target and the target rises next session. Hit the cap and the test-out gate unlocks.</p>
    </div>

    <div class="day-tabs reveal" style="animation-delay:60ms">
      ${Object.values(DAYS).map(d => `
        <button class="day-tab ${d.key === trainDay ? 'active' : ''}" onclick="switchDay('${d.key}')">
          <b>DAY ${d.key} · ${d.name}</b><span>${d.tagline}</span>
        </button>`).join('')}
    </div>
    <p class="day-desc reveal" style="animation-delay:90ms">${day.desc}</p>

    ${deloadActive() ? `<div class="deload-banner reveal" style="animation-delay:95ms">
      <b>DELOAD WEEK · ${state.deload.remaining} session${state.deload.remaining > 1 ? 's' : ''} left</b>
      Half the sets, ~70% targets, nothing to failure, no AMRAP. You are banking recovery —
      targets and progression freeze until the deload ends, then you come back stronger.
    </div>` : ''}

    <p class="set-hint reveal" style="animation-delay:100ms">
      TYPE what you actually got into each set box — the goal is printed on the card; at or above
      goal counts toward progression, below it banks the work and holds the target · a mid-set pause
      over ~10s ends the set: log the unbroken number, extra reps after are bonus · ⇄ MOD swaps in a
      home / no-equipment version (every exercise has one) · Short on time? Superset the pairs, drop
      to 2 sets before you skip an exercise, and cut core first — never the pairs.
    </p>

    <div class="session-bar reveal" style="animation-delay:120ms">
      <button class="btn primary small" onclick="enterFocus()">▶ FOCUS</button>
      <span class="mono" style="font-size:11px;letter-spacing:2px;color:var(--faint)">SESSION</span>
      <div class="track"><div class="fill" id="sesFill" style="width:${pct * 100}%"></div></div>
      <span class="pct" id="sesPct">${Math.round(pct * 100)}%</span>
    </div>

    <div class="warmup-box reveal" style="animation-delay:150ms">
      <h3>WARM-UP — EVERY SESSION, NO EXCEPTIONS</h3>
      <ul>${WARMUP.map(w => `<li>${w}</li>`).join('')}</ul>
    </div>

    ${SESSION_BLOCKS.map((block, bi) => `
      <div class="block reveal" style="animation-delay:${180 + bi * 60}ms">
        <div class="block-head"><h3>${block.title}</h3><span>${block.note}</span></div>
        <div class="ex-grid">
          ${block.chains.map(cid => exCard(cid, block)).join('')}
        </div>
      </div>`).join('')}

    <div class="finish-wrap reveal" style="animation-delay:400ms">
      <button class="btn primary" style="padding:18px 44px;font-size:15px" onclick="finishSession()">FINISH SESSION — BANK IT</button>
    </div>`;
}

function exCard(cid, block) {
  const c = chainById(cid);
  const { level, complete } = currentLevel(cid);
  const st = state.chains[cid];
  const ses = state.activeSession;
  const tgt = dayTarget(level.scheme, st.target, trainDay);
  const log = ses.log[cid];
  const allDone = log.every(x => x !== null);
  const isTest = trainDay === 'C';
  const restSec = block.id === 'core' ? DAYS[trainDay].restCore : DAYS[trainDay].restPair;

  if (complete) {
    return `<div class="ex-card done"><div class="ex-chain">${c.short}</div>
      <div class="ex-name">CHAIN COMPLETE ✦</div>
      <p class="ex-cue">You've passed every level on this chart. Maintain with 2 hard sets, or chase the elite variations.</p></div>`;
  }

  const subs = subsFor(cid, level.name);
  const modIdx = ses.mods ? ses.mods[cid] : undefined;
  const sub = (modIdx !== undefined && subs[modIdx]) ? subs[modIdx] : null;

  const suffix = level.scheme.type === 'hold' ? 's' :
                 level.scheme.type === 'reps-side' ? '/s' :
                 level.scheme.type === 'neg' ? 'neg' : '';
  const inputs = log.map((val, si) => {
    const isAmrap = isTest && si === log.length - 1 && block.id !== 'skill' && !deloadActive();
    const partial = val !== null && val < tgt && !isAmrap;
    return `<label class="set-in ${val !== null ? (partial ? 'partial' : 'logged') : ''} ${isAmrap ? 'amrap' : ''}" id="setin-${cid}-${si}">
      <input type="number" inputmode="numeric" min="0" max="999"
        placeholder="${isAmrap ? 'max' : tgt}" value="${val !== null ? val : ''}"
        onchange="commitSet('${cid}',${si},this,${restSec},${isAmrap})"
        onkeydown="if(event.key==='Enter')this.blur()"
        aria-label="Set ${si + 1} result">
      <span>${isAmrap ? 'AMRAP' : suffix}</span>
    </label>`;
  }).join('');

  const totalGoal = tgt * log.length;
  const goalWord = level.scheme.type === 'hold' ? 'seconds' :
                   level.scheme.type === 'neg' ? 'slow negatives' :
                   level.scheme.type === 'reps-side' ? 'reps per side' : 'reps';

  return `
  <div class="ex-card ${allDone ? 'done' : ''}" id="ex-${cid}" data-block="${block.id}">
    <div class="ex-top">
      <div>
        <div class="ex-chain">${c.short} · LV ${st.level + 1}/${c.levels.length}${sub ? ' · <span class="mod-flag">MOD</span>' : ''}</div>
        <div class="ex-name">${sub ? sub.name : level.name}</div>
      </div>
      <div class="ex-target">${fmtTarget(level.scheme, tgt)}${st.ready ? ' ⚡' : ''}</div>
    </div>
    <p class="ex-cue">${sub ? sub.cue : level.cue}</p>
    <div class="ex-goal mono">GOAL: ${tgt} ${goalWord} × ${log.length} sets = ${totalGoal}${level.scheme.type === 'hold' ? 's' : ''} total — type what you got</div>
    <div class="set-row">
      ${inputs}
      ${subs.length ? `<button class="mod-btn ${sub ? 'on' : ''}" onclick="cycleMod('${cid}')"
        title="Swap in a home / no-equipment version — sets still count, the test-out gate stays on the real exercise">⇄ MOD</button>` : ''}
    </div>
  </div>`;
}

function switchDay(k) {
  // set counts are identical across day types (only targets differ),
  // so logged sets survive a day-type switch untouched.
  // Day E is a different animal: it never touches a logged A/B/C session.
  if (k !== 'E' && state.activeSession) state.activeSession.day = k;
  trainDay = k;
  renderTrain();
  save();
}

/* typed set entry: commit on blur/Enter — the value IS what you got */
function commitSet(cid, si, el, restSec, isAmrap) {
  const ses = state.activeSession;
  const prev = ses.log[cid][si];
  const v = parseInt(el.value, 10);
  const val = Number.isFinite(v) && v > 0 ? Math.min(999, v) : null;
  ses.log[cid][si] = val;
  if (val === null) el.value = '';
  if (isAmrap && val !== null) ses.amrap[cid] = val;
  if (prev === null && val !== null) { startRest(restSec); buzz(30); }
  save();
  refreshSetDom(cid, si);   // targeted update — no full re-render, no animation replay
}

/* surgically refresh one set box + its card + the session bar */
function refreshSetDom(cid, si) {
  const wrap = document.getElementById(`setin-${cid}-${si}`);
  const ses = state.activeSession;
  if (!wrap || !ses) { renderTrain(); return; }
  const st = state.chains[cid];
  const { level } = currentLevel(cid);
  const tgt = dayTarget(level.scheme, st.target, trainDay);
  const val = ses.log[cid][si];
  const isAmrap = wrap.classList.contains('amrap');
  wrap.classList.toggle('logged', val !== null && (isAmrap || val >= tgt));
  wrap.classList.toggle('partial', val !== null && !isAmrap && val < tgt);
  const card = document.getElementById(`ex-${cid}`);
  if (card) card.classList.toggle('done', ses.log[cid].every(x => x !== null));
  const totalSets = Object.values(ses.log).reduce((s, a) => s + a.length, 0);
  const doneSets = Object.values(ses.log).reduce((s, a) => s + a.filter(x => x !== null).length, 0);
  const fill = document.getElementById('sesFill');
  const pctEl = document.getElementById('sesPct');
  if (fill) fill.style.width = `${totalSets ? (doneSets / totalSets) * 100 : 0}%`;
  if (pctEl) pctEl.textContent = `${totalSets ? Math.round((doneSets / totalSets) * 100) : 0}%`;
}

function cycleMod(cid) {
  const ses = state.activeSession;
  const { level } = currentLevel(cid);
  const subs = subsFor(cid, level.name);
  if (!subs.length) return;
  const cur = ses.mods[cid];
  const next = cur === undefined ? 0 : (cur + 1 < subs.length ? cur + 1 : undefined);
  if (next === undefined) {
    delete ses.mods[cid];
    toast(`Back to the real thing: ${level.name}.`);
  } else {
    ses.mods[cid] = next;
    toast(`MOD: ${subs[next].name} — counts toward the chain, but the gate is still ${level.name}.`);
  }
  save();
  // re-render just this card (name/cue/badge change)
  const card = document.getElementById(`ex-${cid}`);
  const block = SESSION_BLOCKS.find(b => b.id === card?.dataset.block);
  if (card && block) card.outerHTML = exCard(cid, block);
  else renderTrain();
  if (focusOn) focusRender();
}

function finishSession() {
  const ses = state.activeSession;
  if (!ses) return;
  const doneSets = Object.values(ses.log).reduce((s, a) => s + a.filter(x => x !== null).length, 0);
  if (!doneSets) { toast('Log at least one set before banking the session.'); return; }
  if (focusOn) exitFocus();
  releaseWakeLock();

  const wasDeload = deloadActive();
  const newlyReady = [];
  const adv = [], part = [], skip = [];
  let repVol = 0, holdVol = 0;

  for (const c of CHAINS) {
    const st = state.chains[c.id];
    const { level, complete } = currentLevel(c.id);
    if (complete) continue;
    const log = ses.log[c.id];
    for (const v of log) {
      if (v !== null) { if (level.scheme.type === 'hold') holdVol += v; else repVol += v; }
    }
    const logged = log.filter(x => x !== null).length;
    if (!logged) { skip.push(c.id); continue; }

    const tgt = dayTarget(level.scheme, st.target, ses.day);
    // advance only when every set was logged AT OR ABOVE target —
    // partial sets bank the work but the target waits for you
    const allHit = log.length && log.every(x => x !== null && x >= tgt);
    if (!allHit) {
      part.push(c.id);
      // stall tracking: only full-effort days count against you
      if (ses.day !== 'B' && !wasDeload) st.missStreak = (st.missStreak || 0) + 1;
      continue;
    }
    adv.push(c.id);
    st.missStreak = 0;
    // overload engine: heavy/test days move the target (frozen during deload)
    if (ses.day !== 'B' && !wasDeload) {
      if (st.target < level.scheme.cap) {
        st.target = Math.min(level.scheme.cap, st.target + stepFor(level.scheme));
      } else if (!st.ready) {
        st.ready = true;
        newlyReady.push(c);
      }
      const amrapVal = ses.log[c.id][log.length - 1];
      if (ses.day === 'C' && amrapVal >= level.scheme.cap && st.target >= level.scheme.cap && !st.ready) {
        st.ready = true;
        newlyReady.push(c);
      }
    }
  }

  // an Engine session may already be logged today — keep its volume and its rounds
  const already = state.sessions[ses.date];
  const fold = already && already.express ? already : null;
  state.sessions[ses.date] = {
    day: ses.day,
    sets: doneSets + (fold ? fold.sets || 0 : 0),
    reps: repVol + (fold ? fold.reps || 0 : 0),
    holds: holdVol + (fold ? fold.holds || 0 : 0),
    adv, part, skip: skip.length, deload: wasDeload,
    ...(fold && fold.engine ? { engine: fold.engine } : {}),
  };
  state.sessionCount++;
  state.lastSessionAt = Date.now();

  let deloadDone = false;
  if (wasDeload) {
    state.deload.remaining--;
    if (state.deload.remaining <= 0) {
      state.deload = null;
      state.lastDeloadAt = state.sessionCount;
      deloadDone = true;
    }
  }

  state.activeSession = null;
  trainDay = null;
  save();
  showReport(ses.day, { doneSets, repVol, holdVol, adv, part, skip, newlyReady, wasDeload, deloadDone });
  setView('today');
}

/* ---------- SESSION REPORT (the workout evaluation) ---------- */

function showReport(dayKey, r) {
  const day = DAYS[dayKey];
  $('#reportTitle').textContent = `Day ${dayKey} · ${day.name}${r.wasDeload ? ' · DELOAD' : ''}`;
  $('#reportStats').innerHTML = `
    <div class="rstat"><b>${r.doneSets}</b><span>sets</span></div>
    <div class="rstat"><b>${r.repVol}</b><span>reps</span></div>
    <div class="rstat"><b>${r.holdVol}s</b><span>holds</span></div>`;
  const chip = (id, cls) => `<span class="rchip ${cls}">${chainById(id).short}</span>`;
  $('#reportLists').innerHTML = `
    ${r.adv.length ? `<div class="rrow"><span class="rlabel pass">TARGET HIT</span><div>${r.adv.map(id => chip(id, 'pass')).join('')}</div></div>` : ''}
    ${r.part.length ? `<div class="rrow"><span class="rlabel hold">HELD BACK</span><div>${r.part.map(id => chip(id, 'hold')).join('')}</div></div>` : ''}
    ${r.skip.length ? `<div class="rrow"><span class="rlabel skip">NOT TRAINED</span><div><span class="rchip skip">${r.skip.length} chain${r.skip.length > 1 ? 's' : ''}</span></div></div>` : ''}`;
  let note;
  if (r.deloadDone) note = 'Deload complete — targets unfreeze next session. You will feel the difference.';
  else if (r.wasDeload) note = `Deload session banked. ${state.deload.remaining} to go — stay easy, that's the assignment.`;
  else if (r.newlyReady.length) note = `⚡ GATE UNLOCKED: ${r.newlyReady.map(c => c.title).join(', ')} — test out from the Ladders tab, fresh, at your next session.`;
  else if (r.part.length) note = 'Held-back chains keep the same target next time — hit every set at the number and they climb again.';
  else note = 'Clean sweep. Targets rise next session — protein, water, walk, sleep.';
  $('#reportNote').textContent = note;
  $('#reportOverlay').hidden = false;
  if (r.newlyReady.length && !r.wasDeload) { confetti(); beep([880, 1174.7, 1568], 0.12); }
}

/* ---------- DELOAD INTELLIGENCE ---------- */

function deloadCheck() {
  if (deloadActive() || !state.sessionCount) return null;
  if (state.deloadSnooze && state.sessionCount < state.deloadSnooze) return null;
  const stalled = CHAINS.filter(c => (state.chains[c.id].missStreak || 0) >= 2);
  if (stalled.length >= 3) {
    return { why: `${stalled.length} chains have missed their targets two full-effort sessions running — that's fatigue, not weakness.` };
  }
  const since = state.sessionCount - (state.lastDeloadAt || 0);
  if (since >= 18) {
    return { why: `${since} hard sessions since your last reset — the 6-week rule says bank the adaptation before it banks you.` };
  }
  return null;
}

function startDeload() {
  state.deload = { active: true, remaining: 3 };
  state.deloadSnooze = null;
  state.activeSession = null;
  save();
  toast('Deload week started — 3 easy sessions, then back to full throttle.');
  setView('train');
}

function snoozeDeload() {
  state.deloadSnooze = state.sessionCount + 3;
  save();
  toast('Deload snoozed for 3 sessions. If the stall continues, take it.');
  render();
}

/* ---------- FOCUS MODE — one exercise at a time ---------- */

let focusOn = false;
let focusVal = null;          // rep/second value armed on the big button
let focusResting = null;      // {left, total, next} while the inline rest runs
let focusRestTimer = null;

function buildSteps() {
  const ses = state.activeSession;
  const steps = [];
  for (const block of SESSION_BLOCKS) {
    const chains = block.chains.filter(cid => !currentLevel(cid).complete);
    const maxSets = Math.max(0, ...chains.map(cid => ses.log[cid].length));
    for (let s = 0; s < maxSets; s++) {
      for (const cid of chains) {
        if (s < ses.log[cid].length) steps.push({ cid, si: s, block });
      }
    }
  }
  return steps;
}

function startFocus() {
  setView('train');
  enterFocus();
}

function enterFocus() {
  ensureSession();
  const ses = state.activeSession;
  const steps = buildSteps();
  let idx = Math.min(ses.focusIdx ?? 0, steps.length);
  while (idx < steps.length && ses.log[steps[idx].cid][steps[idx].si] !== null) idx++;
  ses.focusIdx = idx;
  focusOn = true;
  focusVal = null;
  focusResting = null;
  $('#focusOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  acquireWakeLock();
  focusRender();
  save();
}

function exitFocus() {
  focusOn = false;
  clearInterval(focusRestTimer);
  focusResting = null;
  $('#focusOverlay').hidden = true;
  document.body.style.overflow = '';
  releaseWakeLock();
  if (activeView === 'train') renderTrain();   // sync the list view
}

function focusRender() {
  const ses = state.activeSession;
  if (!ses) { exitFocus(); return; }
  const steps = buildSteps();
  const idx = ses.focusIdx ?? 0;
  const day = DAYS[ses.day];
  const inner = $('#focusInner');
  const doneSets = Object.values(ses.log).reduce((s, a) => s + a.filter(x => x !== null).length, 0);
  const totalSets = Object.values(ses.log).reduce((s, a) => s + a.length, 0);

  const header = `
    <div class="focus-head">
      <button class="focus-x" onclick="exitFocus()" title="Back to list view">✕</button>
      <div class="focus-title mono">DAY ${ses.day} · ${day.name}${deloadActive() ? ' · DELOAD' : ''}</div>
      <div class="focus-count mono">${Math.min(idx + 1, steps.length)}/${steps.length}</div>
    </div>
    <div class="focus-track"><div class="focus-fill" style="width:${totalSets ? (doneSets / totalSets) * 100 : 0}%"></div></div>`;

  /* --- resting screen --- */
  if (focusResting) {
    const r = focusResting;
    const circ = 2 * Math.PI * 90;
    inner.innerHTML = `${header}
      <div class="focus-stage focus-rest-stage">
        <div class="focus-block-label">REST</div>
        <div class="focus-rest-ring">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="90" class="frr-track"/>
            <circle cx="100" cy="100" r="90" class="frr-fill" id="frrFill"
              stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - r.left / r.total)}"/>
          </svg>
          <div class="focus-rest-num mono" id="frrNum">${r.left}</div>
        </div>
        ${r.next ? `<div class="focus-next">NEXT UP<b>${r.next}</b></div>` : ''}
        <button class="btn ghost" onclick="focusSkipRest()">SKIP REST ▸</button>
      </div>`;
    return;
  }

  /* --- session complete screen --- */
  if (idx >= steps.length) {
    inner.innerHTML = `${header}
      <div class="focus-stage">
        <div class="focus-block-label" style="color:var(--pass)">ALL SETS DONE</div>
        <div class="focus-exname" style="font-size:clamp(40px,10vw,64px)">SESSION<br>COMPLETE</div>
        <p class="focus-cue">${doneSets} sets in the bank. Finish to run the evaluation and start the recovery clock.</p>
        <button class="focus-done-btn" onclick="finishSession()">FINISH SESSION — BANK IT</button>
        <button class="btn ghost" style="margin-top:12px" onclick="exitFocus()">back to list view</button>
      </div>`;
    return;
  }

  /* --- exercise step screen --- */
  const { cid, si, block } = steps[idx];
  const c = chainById(cid);
  const st = state.chains[cid];
  const { level } = currentLevel(cid);
  const subs = subsFor(cid, level.name);
  const sub = (ses.mods[cid] !== undefined && subs[ses.mods[cid]]) ? subs[ses.mods[cid]] : null;
  const tgt = dayTarget(level.scheme, st.target, ses.day);
  const isAmrap = ses.day === 'C' && si === ses.log[cid].length - 1 && block.id !== 'skill' && !deloadActive();
  if (focusVal === null) focusVal = isAmrap ? (ses.amrap[cid] ?? tgt) : tgt;
  const unit = level.scheme.type === 'hold' ? 'SECONDS' :
               level.scheme.type === 'neg' ? 'NEGATIVES' :
               level.scheme.type === 'reps-side' ? 'REPS / SIDE' : 'REPS';

  const dots = ses.log[cid].map((v, i) =>
    `<span class="fdot ${v !== null ? 'on' : ''} ${i === si ? 'cur' : ''}"></span>`).join('');

  inner.innerHTML = `${header}
    <div class="focus-stage">
      <div class="focus-block-label">${block.title.toUpperCase()}${block.id.startsWith('pair') ? ' · SUPERSET' : ''}${isAmrap ? ' · <span style="color:var(--ember-hi)">AMRAP</span>' : ''}</div>
      <div class="focus-chain mono">${c.short} · LV ${st.level + 1}/${c.levels.length} · SET ${si + 1} OF ${ses.log[cid].length}</div>
      <div class="focus-exname">${sub ? sub.name : level.name}${sub ? ' <span class="mod-flag">MOD</span>' : ''}</div>
      <p class="focus-cue">${sub ? sub.cue : level.cue}</p>
      <div class="focus-dots">${dots}</div>
      <div class="focus-target">
        <button class="focus-adj" onclick="focusAdj(-1)">−</button>
        <div class="focus-num">
          <b class="mono" id="focusNum">${focusVal}</b>
          <span>${unit}${isAmrap ? ' · GO TO CLEAN MAX' : ''}</span>
        </div>
        <button class="focus-adj" onclick="focusAdj(1)">+</button>
      </div>
      <button class="focus-done-btn" onclick="focusLog()">✓ SET DONE</button>
      <div class="focus-tools">
        ${subs.length ? `<button class="btn ghost small" onclick="cycleMod('${cid}')">⇄ MOD</button>` : ''}
        <button class="btn ghost small" onclick="focusSkip()">SKIP SET ▸</button>
      </div>
    </div>`;
}

function focusAdj(d) {
  const ses = state.activeSession;
  const steps = buildSteps();
  const { cid } = steps[ses.focusIdx];
  const { level } = currentLevel(cid);
  focusVal = Math.max(stepFor(level.scheme), Math.min(999, focusVal + d * stepFor(level.scheme)));
  const el = document.getElementById('focusNum');
  if (el) el.textContent = focusVal;
}

function focusLog() {
  const ses = state.activeSession;
  const steps = buildSteps();
  const idx = ses.focusIdx;
  const { cid, si, block } = steps[idx];
  const isAmrap = ses.day === 'C' && si === ses.log[cid].length - 1 && block.id !== 'skill' && !deloadActive();
  ses.log[cid][si] = focusVal;
  if (isAmrap) ses.amrap[cid] = focusVal;
  buzz(30);
  ses.focusIdx = idx + 1;
  focusVal = null;
  save();
  if (ses.focusIdx >= steps.length) { focusRender(); return; }   // straight to the finish screen
  const next = steps[ses.focusIdx];
  const restSec = block.id === 'core' ? DAYS[ses.day].restCore : DAYS[ses.day].restPair;
  const nc = chainById(next.cid);
  const nlvl = currentLevel(next.cid).level;
  const nsub = subsFor(next.cid, nlvl.name)[ses.mods[next.cid]];
  focusRestStart(restSec, `${nsub ? nsub.name : nlvl.name} · set ${next.si + 1}`);
}

function focusSkip() {
  const ses = state.activeSession;
  ses.focusIdx = (ses.focusIdx ?? 0) + 1;
  focusVal = null;
  save();
  focusRender();
}

function focusRestStart(seconds, nextLabel) {
  clearInterval(focusRestTimer);
  focusResting = { left: seconds, total: seconds, next: nextLabel };
  focusRender();
  focusRestTimer = setInterval(() => {
    if (!focusResting) { clearInterval(focusRestTimer); return; }
    focusResting.left--;
    const r = focusResting;
    if (r.left <= 3 && r.left > 0) beep([660], 0.07);
    if (r.left <= 0) {
      clearInterval(focusRestTimer);
      focusResting = null;
      beep([880, 1318.5], 0.12, 0.28);   // same chime, a touch louder
      buzz([80, 60, 80]);
      focusRender();
      return;
    }
    const num = document.getElementById('frrNum');
    const fill = document.getElementById('frrFill');
    if (num) num.textContent = r.left;
    if (fill) {
      const circ = 2 * Math.PI * 90;
      fill.style.strokeDashoffset = circ * (1 - r.left / r.total);
      fill.style.stroke = r.left <= 5 ? 'var(--pass)' : 'var(--ember)';
    }
  }, 1000);
}

function focusSkipRest() {
  clearInterval(focusRestTimer);
  focusResting = null;
  focusRender();
}

/* ---------- PLACEMENT ASSESSMENT ---------- */

let placeIdx = 0;
let placeChoices = {};   // chainId -> level name

function startPlacement() {
  placeIdx = 0;
  placeChoices = {};
  $('#placeOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
  placeRender();
}

function closePlacement() {
  $('#placeOverlay').hidden = true;
  document.body.style.overflow = '';
}

function placeRender() {
  const inner = $('#placeInner');
  const total = PLACEMENT.length;

  /* summary screen */
  if (placeIdx >= total) {
    const rows = PLACEMENT.map(p => {
      const c = chainById(p.chain);
      const name = placeChoices[p.chain] ?? c.levels[0].name;
      const idx = Math.max(0, c.levels.findIndex(l => l.name === name));
      const band = c.levels[idx].band;
      return `<div class="place-row">
        <b class="mono">${c.short}</b>
        <span>${name}</span>
        <span class="band-chip band-${band}">${BANDS[band].label}</span>
      </div>`;
    }).join('');
    inner.innerHTML = `
      <div class="focus-head">
        <button class="focus-x" onclick="placeBack()">‹</button>
        <div class="focus-title mono">PLACEMENT · YOUR STARTING MAP</div>
        <button class="focus-x" onclick="closePlacement()">✕</button>
      </div>
      <div class="focus-stage" style="justify-content:flex-start;padding-top:30px">
        <div class="focus-exname" style="font-size:clamp(30px,8vw,44px)">THE MAP<br>IS DRAWN</div>
        <p class="focus-cue">Every chain starts exactly where you are. Levels below your placement count as cleared — the ladders open up from here. This overwrites current chain levels.</p>
        <div class="place-list">${rows}</div>
        <button class="focus-done-btn" onclick="placeApply()">LOCK IT IN — START TRAINING</button>
      </div>`;
    return;
  }

  /* one chain's test */
  const p = PLACEMENT[placeIdx];
  const c = chainById(p.chain);
  inner.innerHTML = `
    <div class="focus-head">
      ${placeIdx > 0 ? `<button class="focus-x" onclick="placeBack()">‹</button>` : `<button class="focus-x" onclick="closePlacement()">✕</button>`}
      <div class="focus-title mono">PLACEMENT TEST · ${placeIdx + 1}/${total}</div>
      <div class="focus-count mono">${c.short}</div>
    </div>
    <div class="focus-track"><div class="focus-fill" style="width:${(placeIdx / total) * 100}%"></div></div>
    <div class="focus-stage" style="justify-content:flex-start;padding-top:34px">
      <div class="focus-block-label">${p.title.toUpperCase()}</div>
      <div class="focus-exname" style="font-size:clamp(26px,7vw,38px)">WHERE ARE YOU?</div>
      <p class="focus-cue">${p.instruct}</p>
      <div class="place-opts">
        ${p.options.map((o, i) => {
          const idx = c.levels.findIndex(l => l.name === o.level);
          const band = idx >= 0 ? c.levels[idx].band : 'beg';
          return `<button class="place-opt ${placeChoices[p.chain] === o.level ? 'picked' : ''}" onclick="placePick('${o.level.replace(/'/g, "\\'")}')">
            <span>${o.label}</span>
            <small class="mono">START AT: ${o.level} · <i class="band-${band}" style="font-style:normal">${BANDS[band].label}</i></small>
          </button>`;
        }).join('')}
      </div>
      <button class="btn ghost small" onclick="placePick(null)">NOT SURE — START AT THE BEGINNING</button>
    </div>`;
}

function placePick(levelName) {
  const p = PLACEMENT[placeIdx];
  const c = chainById(p.chain);
  placeChoices[p.chain] = levelName || c.levels[0].name;
  placeIdx++;
  placeRender();
}

function placeBack() {
  placeIdx = Math.max(0, placeIdx - 1);
  placeRender();
}

function placeApply() {
  for (const p of PLACEMENT) {
    const c = chainById(p.chain);
    const name = placeChoices[p.chain] ?? c.levels[0].name;
    const idx = Math.max(0, c.levels.findIndex(l => l.name === name));
    const st = state.chains[p.chain];
    st.level = idx;
    st.target = c.levels[idx].scheme.start;
    st.ready = false;
    st.missStreak = 0;
  }
  state.placementDone = todayStr();
  state.activeSession = null;   // session scaffolds rebuild at the new levels
  trainDay = null;
  save();
  closePlacement();
  const placed = CHAINS.reduce((s, c) => s + state.chains[c.id].level, 0);
  celebrate('PLACEMENT SET', 'THE CLIMB BEGINS',
    `${placed} levels credited across your ten chains. Session A is built around your real starting points — go take it.`);
  render();
}

/* ---------- LADDERS ---------- */

function openLadder(cid) { ladderChain = cid; setView('ladders'); }

function renderLadders() {
  const c = chainById(ladderChain);
  const st = state.chains[c.id];
  const { complete } = currentLevel(c.id);

  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">THE IRONPATH METHOD · TEST-OUT GATES</div>
      <h1 class="page-title">Ladders</h1>
      <p class="page-sub">Every level has a hardcoded gate. Pass the test — honestly, fresh, after a warm-up — and the next level unlocks. You can attempt your current gate any time: if you're beyond beginner already, test out fast and find your true level.</p>
    </div>

    <div class="chain-tabs reveal" style="animation-delay:60ms">
      ${CHAINS.map(ch => `<button class="chain-tab ${ch.id === ladderChain ? 'active' : ''}"
        onclick="openLadder('${ch.id}')">${ch.short}</button>`).join('')}
    </div>

    <div class="ladder-head reveal" style="animation-delay:90ms">
      <h2>${c.title}</h2>
      <span class="prog-note">${st.level}/${c.levels.length} levels passed · training target ${complete ? '—' : fmtTarget(c.levels[st.level].scheme, st.target)}</span>
    </div>

    <div class="ladder">
      ${c.levels.map((lv, i) => {
        const passed = i < st.level;
        const cur = i === st.level;
        const cls = passed ? 'passed' : cur ? 'current' : 'locked';
        const status = passed
          ? `✓ PASSED ${st.passedAt[i] ? '· ' + st.passedAt[i] : ''}`
          : cur ? (st.ready ? '⚡ TEST READY' : '▸ CURRENT LEVEL') : '🔒 LOCKED';
        return `
        <div class="rung ${cls} reveal" style="animation-delay:${120 + i * 45}ms">
          <div class="rung-top">
            <span class="rung-name">${lv.name}</span>
            <span class="band-chip band-${lv.band}">${BANDS[lv.band].label}</span>
            <span class="rung-status">${status}</span>
          </div>
          <p class="rung-cue">${lv.cue}</p>
          <div class="rung-test">
            <span class="req">${lv.test.label}</span>
            ${cur ? `<button class="btn small ${st.ready ? 'primary' : ''}" style="margin-left:auto"
              onclick="openTest('${c.id}')">TEST OUT ▸</button>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${complete ? `<div class="rung passed reveal"><div class="rung-top">
        <span class="rung-name" style="color:var(--pass)">CHAIN COMPLETE ✦</span></div>
        <p class="rung-cue">Every level on this chain is passed. Elite variations beyond the chart await.</p></div>` : ''}
    </div>`;
}

/* ---------- TEST-OUT MODAL ---------- */

let testChain = null;

function openTest(cid) {
  testChain = cid;
  const { level } = currentLevel(cid);
  $('#testName').textContent = level.name;
  $('#testReq').textContent = level.test.label;
  $('#testChecks').innerHTML = level.test.checks.map((ck, i) => `
    <div class="check-item" data-i="${i}" onclick="toggleCheck(this)">
      <span class="box">✓</span><span>${ck}</span>
    </div>`).join('');
  $('#testPass').disabled = true;
  $('#testOverlay').hidden = false;
}

function toggleCheck(el) {
  el.classList.toggle('on');
  $('#testPass').disabled = !$$('#testChecks .check-item').every(x => x.classList.contains('on'));
}

function passTest() {
  const cid = testChain;
  const c = chainById(cid);
  const st = state.chains[cid];
  const passedName = c.levels[st.level].name;
  const passedShare = { kind: 'level', chain: cid, name: passedName, band: c.levels[st.level].band, levelNum: st.level + 1 };
  st.passedAt[st.level] = todayStr();
  st.level++;
  st.ready = false;
  const done = st.level >= c.levels.length;
  if (!done) st.target = c.levels[st.level].scheme.start;
  // clear any active-session log row for this chain (set count may differ)
  if (state.activeSession && !done) {
    state.activeSession.log[cid] = new Array(setsFor(c.levels[st.level].scheme)).fill(null);
  }
  save();
  $('#testOverlay').hidden = true;

  if (done) {
    celebrate('CHAIN COMPLETE', c.title.toUpperCase(), 'Every level passed. That is mastery. ✦', passedShare);
  } else {
    const next = c.levels[st.level];
    celebrate('LEVEL CLEARED', passedName, `Next up: <b>${next.name}</b> · ${fmtTarget(next.scheme, next.scheme.start)} → gate at ${next.test.label}`, passedShare);
  }
  render();
}

/* ---------- ROADMAP ---------- */

function renderRoadmap() {
  let activeFound = false;
  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">30 DAYS TO ESCAPE · 9 MONTHS TO MASTERY</div>
      <h1 class="page-title">Roadmap</h1>
      <p class="page-sub">Four hardcoded phases. Each gate auto-checks itself off as you pass levels in the Ladders — no honor system needed here, the app already knows. Elite skills (planche, one-arm work, front lever) stay beyond Phase 4 as the horizon.</p>
    </div>
    <div class="phase-list">
      ${PHASES.map((p, i) => {
        const s = phaseStatus(p);
        const complete = s.n === s.total;
        const active = !complete && !activeFound;
        if (active) activeFound = true;
        return `
        <div class="phase ${complete ? 'complete' : active ? 'active' : ''} reveal" style="animation-delay:${i * 90}ms">
          ${complete ? '<div class="phase-badge">CLEARED</div>' : ''}
          <div class="phase-top">
            <span class="phase-num">${p.num}</span>
            <span class="phase-name">${p.name}</span>
            <span class="phase-window">${p.window}</span>
            <span class="phase-pct">${Math.round(s.pct * 100)}%</span>
          </div>
          <p class="phase-story">${p.story}</p>
          <div class="phase-track"><div class="phase-fill" style="width:${s.pct * 100}%"></div></div>
          <div class="req-grid">
            ${s.met.map(r => {
              const ch = chainById(r.chain);
              return `<div class="req ${r.met ? 'met' : ''}">
                <span class="tick">${r.met ? '✓' : ''}</span>
                <span><b>${ch.short}</b>${r.name}</span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

/* ---------- RECOVER ---------- */

function renderRecover() {
  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">THE OTHER HALF OF THE PROGRAM</div>
      <h1 class="page-title">Recover</h1>
      <p class="page-sub">Training is the stimulus; recovery is where strength is actually built. Nine rules — sleep and protein carry more of your results than any exercise selection ever will.</p>
    </div>
    <div class="rec-grid">
      ${RECOVERY.map((r, i) => `
        <div class="rec-card reveal" style="animation-delay:${i * 60}ms">
          <div class="rec-top">
            <span class="rec-icon">${r.icon}</span>
            <h3>${r.title}</h3>
            <span class="rec-tag">${r.tag}</span>
          </div>
          <p>${r.body}</p>
        </div>`).join('')}
    </div>

    <div class="section-label reveal" style="animation-delay:560ms">
      <h2>Your Data</h2><div class="rule"></div>
    </div>
    <div class="data-card reveal" style="animation-delay:590ms">
      <p>Progress lives on <b>this device only</b> — nothing is uploaded anywhere. Export a backup after big milestones; import it to restore after a phone swap or wipe.</p>
      <div class="data-actions">
        <button class="btn small" onclick="exportData()">⬇ EXPORT BACKUP</button>
        <button class="btn small ${pendingImport ? 'primary' : ''}" id="importBtn"
          onclick="${pendingImport ? 'confirmImport()' : "document.getElementById('importFile').click()"}">
          ${pendingImport ? '⚠ CONFIRM RESTORE — OVERWRITES CURRENT' : '⬆ IMPORT BACKUP'}</button>
      </div>
      <p class="data-meta mono">${state.lastBackup ? `last backup: ${state.lastBackup}` : 'no backup yet'}${pendingImport ? ` · restoring file from ${pendingImport.updatedAt ? new Date(pendingImport.updatedAt).toLocaleDateString() : 'unknown date'}` : ''}</p>
      <div class="remind-row">
        <span>🔔 Training reminders: <b>${state.remindersOn ? (state.remindersBg ? 'ON — background nudges' : 'ON — in-app only') : 'OFF'}</b></span>
        <button class="btn small ${state.remindersOn ? 'ghost' : ''}" onclick="${state.remindersOn ? 'disableReminders()' : 'enableReminders()'}">
          ${state.remindersOn ? 'TURN OFF' : 'TURN ON'}</button>
      </div>
      <div class="remind-row">
        <span>🎯 Placement test${state.placementDone ? `: <b>done ${state.placementDone}</b>` : ' — set every chain to your real level'}</span>
        <button class="btn small ghost" onclick="startPlacement()">${state.placementDone ? 'RETAKE' : 'TAKE IT'}</button>
      </div>
      <p class="legal-line">IRONPATH is general fitness information, not medical advice. Consult a physician before training; stop on sharp or joint pain. You train at your own risk.</p>
    </div>`;
}

/* ---------- BACKUP / RESTORE ---------- */

let pendingImport = null;

async function exportData() {
  state.lastBackup = todayStr();
  save();
  const json = JSON.stringify(state, null, 2);
  const filename = `ironpath-backup-${todayStr()}.json`;

  // claude.ai artifact viewer: downloads must go through the runtime capability
  if (window.claude && window.claude.use) {
    try {
      const dl = await window.claude.use('downloads');
      if (dl) {
        await dl.save({ filename, data: json });
        toast('Backup saved — stash it in your cloud drive.');
        render();
        return;
      }
    } catch (e) {
      if (e && e.code === 'declined') { render(); return; }
      // any other failure: fall through to the normal download path
    }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup downloaded — stash it in your cloud drive.');
  render();
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.chains || !data.startDate) {
        toast('⚠ That file is not an IRONPATH backup.');
        return;
      }
      pendingImport = data;
      toast('Backup looks valid — tap CONFIRM RESTORE to apply it.');
      render();
    } catch {
      toast('⚠ Could not read that file — is it the exported .json?');
    }
  };
  reader.readAsText(file);
}

function confirmImport() {
  if (!pendingImport) return;
  state = pendingImport;
  pendingImport = null;
  for (const c of CHAINS) {
    if (!state.chains[c.id]) {
      state.chains[c.id] = { level: 0, target: c.levels[0].scheme.start, ready: false, passedAt: {} };
    }
  }
  save();
  toast('Backup restored. Welcome back.');
  setView('today');
}

/* ---------- CELEBRATION + CONFETTI ---------- */

let shareInfo = null;   // what the celebrate-overlay share button will render

function celebrate(kicker, name, nextHtml, share = null) {
  $('#celebrateKicker').textContent = kicker;
  $('#celebrateName').textContent = name;
  $('#celebrateNext').innerHTML = nextHtml;
  shareInfo = share;
  $('#celebrateShare').hidden = !share;
  $('#celebrateOverlay').hidden = false;
  confetti();
  beep([880, 1174.7, 1568], 0.12);
  buzz([50, 40, 50, 40, 120]);
}

/* ---------- SHARE CARDS (canvas, brand-drawn) ---------- */

const CARD_W = 1080, CARD_H = 1350;

function cardBase(ctx) {
  ctx.fillStyle = '#0b0c0e';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // faint radial ember glow top-right
  const g = ctx.createRadialGradient(CARD_W * 0.85, -100, 50, CARD_W * 0.85, -100, 900);
  g.addColorStop(0, 'rgba(255,92,31,0.18)');
  g.addColorStop(1, 'rgba(255,92,31,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // hazard stripe top
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, CARD_W, 26); ctx.clip();
  ctx.fillStyle = '#ff5c1f';
  for (let x = -60; x < CARD_W + 60; x += 52) {
    ctx.save(); ctx.translate(x, 0); ctx.rotate(-Math.PI / 4);
    ctx.fillRect(0, -30, 26, 90); ctx.restore();
  }
  ctx.restore();
  // brand
  ctx.fillStyle = '#ff5c1f';
  roundRect(ctx, 64, 78, 74, 74, 16); ctx.fill();
  ctx.fillStyle = '#0b0c0e';
  ctx.font = '38px Anton, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('IP', 101, 118);
  ctx.fillStyle = '#ecede8';
  ctx.font = '34px Anton, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('IRONPATH', 160, 108);
  ctx.fillStyle = '#8b9099';
  ctx.font = '600 17px "IBM Plex Mono", monospace';
  ctx.fillText('B O D Y W E I G H T   M A S T E R Y', 161, 142);
  // date top right
  ctx.textAlign = 'right';
  ctx.fillStyle = '#565b63';
  ctx.fillText(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(), CARD_W - 64, 118);
  ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cardFooter(ctx) {
  ctx.fillStyle = '#565b63';
  ctx.font = '600 20px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FORGED ON THE IRONPATH', CARD_W / 2, CARD_H - 70);
  ctx.textAlign = 'left';
}

function statLine(ctx, y) {
  const stats = [
    [String(state.sessionCount), 'SESSIONS'],
    [String(CHAINS.reduce((s, c) => s + state.chains[c.id].level, 0)), 'LEVELS'],
    [String(streak()), 'STREAK'],
  ];
  const w = 250;
  const x0 = (CARD_W - w * stats.length) / 2;
  stats.forEach(([v, l], i) => {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ecede8';
    ctx.font = '64px Anton, sans-serif';
    ctx.fillText(v, x0 + w * i + w / 2, y);
    ctx.fillStyle = '#565b63';
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.fillText(l, x0 + w * i + w / 2, y + 36);
  });
  ctx.textAlign = 'left';
}

async function drawLevelCard(info) {
  await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext('2d');
  cardBase(ctx);

  ctx.fillStyle = '#ff5c1f';
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.fillText('L E V E L   C L E A R E D', 64, 320);

  // exercise name, up to 2 lines
  ctx.fillStyle = '#ecede8';
  let size = 120;
  ctx.font = `${size}px Anton, sans-serif`;
  const words = info.name.toUpperCase().split(' ');
  let lines = [''];
  for (const w of words) {
    const t = (lines[lines.length - 1] + ' ' + w).trim();
    if (ctx.measureText(t).width > CARD_W - 128 && lines[lines.length - 1]) lines.push(w);
    else lines[lines.length - 1] = t;
  }
  if (lines.length > 2) { size = 88; ctx.font = `${size}px Anton, sans-serif`; }
  lines.forEach((l, i) => ctx.fillText(l, 64, 320 + 130 + i * (size + 14)));
  let y = 320 + 130 + (lines.length - 1) * (size + 14) + 70;

  const c = chainById(info.chain);
  ctx.fillStyle = '#8b9099';
  ctx.font = '600 28px "IBM Plex Mono", monospace';
  ctx.fillText(`${c.title.toUpperCase()}  ·  LEVEL ${info.levelNum}/${c.levels.length} PASSED`, 64, y);
  y += 64;

  // band chip
  const bandColors = { beg: '#6fa8dc', int: '#ffc24b', adv: '#ff5c1f', elite: '#e9e9f2' };
  const bc = bandColors[info.band] || '#6fa8dc';
  ctx.strokeStyle = bc; ctx.lineWidth = 3;
  const label = BANDS[info.band].label;
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  const lw = ctx.measureText(label).width;
  roundRect(ctx, 64, y - 34, lw + 66, 56, 12); ctx.stroke();
  ctx.fillStyle = bc;
  ctx.beginPath(); ctx.arc(64 + 30, y - 6, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillText(label, 64 + 50, y + 3);

  statLine(ctx, CARD_H - 240);
  cardFooter(ctx);
  return cv;
}

async function drawStatsCard() {
  await document.fonts.ready;
  const cv = document.createElement('canvas');
  cv.width = CARD_W; cv.height = CARD_H;
  const ctx = cv.getContext('2d');
  cardBase(ctx);

  ctx.fillStyle = '#ff5c1f';
  ctx.font = '600 26px "IBM Plex Mono", monospace';
  ctx.fillText('P R O G R E S S   R E P O R T', 64, 300);
  ctx.fillStyle = '#ecede8';
  ctx.font = '96px Anton, sans-serif';
  const escaped = CHAINS.filter(c => escapedBeginner(c.id)).length;
  ctx.fillText(`DAY ${String(missionDay()).padStart(2, '0')} · ${escaped}/10 OUT`, 64, 410);

  // ten-chain radar
  const cx = CARD_W / 2, cy = 790, R = 250;
  const n = CHAINS.length;
  ctx.strokeStyle = 'rgba(236,237,232,0.10)'; ctx.lineWidth = 2;
  for (const frac of [0.33, 0.66, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * R * frac, yy = cy + Math.sin(a) * R * frac;
      i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  CHAINS.forEach((c, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const frac = Math.max(0.06, chainPct(c.id));
    const x = cx + Math.cos(a) * R * frac, yy = cy + Math.sin(a) * R * frac;
    i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
  });
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,92,31,0.28)'; ctx.fill();
  ctx.strokeStyle = '#ff5c1f'; ctx.lineWidth = 4; ctx.stroke();
  // labels
  ctx.font = '600 19px "IBM Plex Mono", monospace';
  ctx.fillStyle = '#8b9099';
  ctx.textAlign = 'center';
  CHAINS.forEach((c, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(c.short, cx + Math.cos(a) * (R + 52), cy + Math.sin(a) * (R + 52) + 7);
  });
  ctx.textAlign = 'left';

  statLine(ctx, CARD_H - 200);
  cardFooter(ctx);
  return cv;
}

async function shareCanvas(cv, filename) {
  cv.toBlob(async (blob) => {
    if (!blob) { toast('Could not build the card.'); return; }
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* else fall through */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Card saved — post it anywhere. 📸');
  }, 'image/png');
}

async function shareStats() {
  shareCanvas(await drawStatsCard(), `ironpath-progress-${todayStr()}.png`);
}

async function shareFromCelebrate() {
  if (!shareInfo) return;
  if (shareInfo.kind === 'level') {
    shareCanvas(await drawLevelCard(shareInfo), `ironpath-${shareInfo.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
  } else {
    shareStats();
  }
}

function confetti() {
  const cv = $('#confettiCanvas');
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#ecede8', '#ff5c1f', '#ffc24b', '#b8e62d', '#6fa8dc'];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 300,
    y: innerHeight * 0.45,
    vx: (Math.random() - 0.5) * 16,
    vy: -6 - Math.random() * 13,
    w: 4 + Math.random() * 6,
    h: 6 + Math.random() * 8,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function tick(t) {
    const dt = (t - t0) / 1000;
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - dt / 2.6);
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (dt < 2.8 && !$('#celebrateOverlay').hidden) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

/* ---------- REST TIMER ---------- */

let restInterval = null;

function startRest(seconds) {
  clearInterval(restInterval);
  const dock = $('#restDock');
  const fill = $('#restRingFill');
  const timeEl = $('#restTime');
  const circ = 2 * Math.PI * 44;
  fill.style.strokeDasharray = circ;
  let left = seconds;
  dock.hidden = false;
  const draw = () => {
    timeEl.textContent = left;
    fill.style.strokeDashoffset = circ * (1 - left / seconds);
    fill.style.stroke = left <= 5 ? 'var(--pass)' : 'var(--ember)';
  };
  draw();
  restInterval = setInterval(() => {
    left--;
    if (left <= 3 && left > 0) beep([660], 0.07);
    if (left <= 0) {
      clearInterval(restInterval);
      dock.hidden = true;
      beep([880, 1318.5], 0.12, 0.28);   // same chime, a touch louder
      buzz([80, 60, 80]);
      toast('Rest over — next set. ⚒️');
      return;
    }
    draw();
  }, 1000);
}

/* ---------- audio + toast ---------- */

let audioCtx = null;
function beep(freqs, dur, vol = 0.12) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.001, audioCtx.currentTime + i * dur);
      g.gain.exponentialRampToValueAtTime(vol, audioCtx.currentTime + i * dur + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (i + 1) * dur + 0.05);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * dur);
      o.stop(audioCtx.currentTime + (i + 1) * dur + 0.1);
    });
  } catch { /* audio blocked until first interaction — fine */ }
}

/* haptics — no-op where unsupported (iOS, desktop) */
function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* fine */ }
}

/* keep the screen awake mid-session (auto-released when tab hides) */
let wakeLock = null;
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* denied — fine */ }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* fine */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && focusOn) acquireWakeLock();
});

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ============================================================
   DAY E · ENGINE — the Cindy idea, run on your ladders
   A fixed clock, endless rounds, and a rotation of 2–4 different
   rounds so the same three movements never grind you into the floor.
   Everything is filtered by the gear you actually have — floor only,
   a doorway bar, a park bar, household props, real rings — so every
   movement it hands you is one you can start right now.
   It banks into the training log and holds the streak, but it never
   moves a target: the overload engine answers to Day A/B/C only.
   ============================================================ */

const ENG_LEAD = 10, ENG_SET = 5, ENG_SWITCH = 3;
const ENG_MINS = [10, 12, 20];

const ENG_CORE = {
  hollow: { name: 'Hollow Hold', cue: 'Lower back glued to the floor. Tuck the knees if it peels up.' },
  side:   { name: 'Side Plank',  cue: 'Hips high — one straight line from head to heels.' },
  plank:  { name: 'Plank',       cue: 'Squeeze the glutes, pull the ribs down, keep breathing.' },
  max:    { name: 'Max Hollow Hold', cue: 'Hold until your lower back lifts off — then stop the clock.' },
};

/* gear tiers — what a movement needs before you can start it
   floor    : you, the floor, a wall, a doorframe
   bar      : a doorway pull-up bar (knees bent at the bottom, no swinging)
   highbar  : a park / rig bar — full dead hang, straight legs, room to swing
   props    : a chair, table, counter, stairs, couch, backpack
   rings    : rings, parallettes, an ab wheel                                */
const ENG_GEAR_LABEL = {
  floor: 'floor', bar: 'doorway bar', highbar: 'high bar', props: 'chair / table', rings: 'rings / wheel',
};

/* every ladder level, tagged with what it needs */
const ENG_GEAR = {
  'row:Vertical Row': 'floor', 'row:Incline Row': 'props', 'row:Horizontal Row': 'props',
  'row:Wide Row': 'props', 'row:Archer Row': 'props', 'row:Tuck Front Lever Row': 'props',
  'row:Adv Tuck FL Row': 'props', 'row:Straddle FL Row': 'props', 'row:Front Lever Row': 'props',

  'pullup:Scapular Shrug': 'bar', 'pullup:Arch Hang': 'bar', 'pullup:Pull Up Negative': 'bar',
  'pullup:Pull Up': 'bar', 'pullup:L-Pull Up': 'highbar', 'pullup:Chest to Bar PU': 'bar',
  'pullup:Archer Pull Up': 'highbar', 'pullup:OA Pull Up Negative': 'bar',
  'pullup:Muscle Up': 'highbar', 'pullup:One Arm Pull Up': 'bar',

  'pushup:Incline Push Up': 'floor', 'pushup:Push Up': 'floor', 'pushup:Diamond Push Up': 'floor',
  'pushup:Pseudo Planche PU': 'floor', 'pushup:Archer Push Up': 'floor', 'pushup:RTO Push Up': 'rings',
  'pushup:One Arm Push Up': 'floor', 'pushup:Tuck Planche PU': 'floor',

  'dip:PB Support Hold': 'props', 'dip:Dip Negative': 'props', 'dip:Dip': 'props',
  'dip:L-Dip': 'props', 'dip:Bulgarian Dip': 'props', 'dip:Ring Dip Negative': 'rings',
  'dip:Ring Dip': 'rings', 'dip:RTO Dip': 'rings', 'dip:Ring L-Dip': 'rings',

  'hs:Wall Plank': 'floor', 'hs:Pike Push Up': 'floor', 'hs:Decline Pike PU': 'props',
  'hs:Wall Handstand': 'floor', 'hs:Freestanding HS': 'floor', 'hs:Wall HSPU Negative': 'floor',
  'hs:Wall HSPU': 'floor', 'hs:Freestanding HSPU': 'floor',

  'squat:Assisted Squat': 'floor', 'squat:Parallel Squat': 'floor', 'squat:Full Squat': 'floor',
  'squat:Split Squat': 'floor', 'squat:Bulgarian Split Squat': 'props', 'squat:Beg Shrimp Squat': 'floor',
  'squat:Assisted Pistol Squat': 'floor', 'squat:Pistol Squat': 'floor',
  'squat:Shrimp Squat': 'floor', 'squat:Elevated Shrimp Squat': 'props',

  'hinge:Reverse Hyperextension': 'props', 'hinge:One Leg Deadlift': 'floor',
  'hinge:90° Hip Nordic Curl': 'props', 'hinge:45° Hip Nordic Curl': 'props',
  'hinge:Nordic Curl Negative': 'props', 'hinge:Nordic Curl': 'props',

  'lsit:Foot Supported L-Sit': 'floor', 'lsit:One Leg L-Sit': 'floor', 'lsit:Tuck L-Sit': 'floor',
  'lsit:One Leg Bent L-Sit': 'floor', 'lsit:L-Sit': 'floor', 'lsit:Straddle L-Sit': 'floor',
  'lsit:45° V-Sit': 'floor', 'lsit:V-Sit → Manna': 'floor',

  'hang:Hanging Knees to Chest': 'bar', 'hang:Hanging Bent Leg Raise': 'bar',
  'hang:Hanging Leg Raise': 'highbar', 'hang:Toes to Bar': 'highbar', 'hang:Ankle Weight T2B': 'highbar',

  'antiext:Plank': 'floor', 'antiext:One Arm Plank': 'floor', 'antiext:Knees Ab Wheel': 'rings',
  'antiext:Ab Wheel Negative': 'rings', 'antiext:Standing Ab Wheel': 'rings', 'antiext:Dragon Flag': 'props',
};

/* which ladders feed which slot */
const ENG_FAM = {
  pull:  { tag: 'PULL',  label: 'Pull',  chains: ['pullup', 'row'] },
  push:  { tag: 'PUSH',  label: 'Push',  chains: ['pushup', 'dip', 'hs'] },
  legs:  { tag: 'LEGS',  label: 'Legs',  chains: ['squat', 'hinge'] },
  core:  { tag: 'CORE',  label: 'Core',  chains: ['antiext', 'lsit', 'hang'] },
};
const ENG_FAM_KEYS = ['pull', 'push', 'legs', 'core'];

/* per-round dose as a fraction of a ladder level's test-out cap.
   At the classic levels this lands near 5 pull ups / 8 push ups / 15 squats. */
const ENG_DOSE = { pull: 0.6, push: 0.8, legs: 1.0, core: 0.7 };

/* Engine-only variants — not ladder levels, no gate, no progression.
   They exist so round 2 never looks like round 1. tier: 1 beginner,
   2 intermediate, 3 advanced. base = a round-sized dose. */
const ENG_EXTRA = [
  // ---- push
  { id: 'x-wallpu', fam: 'push', gear: 'floor', tier: 1, type: 'reps', base: 15, name: 'Wall Push Up', cue: 'Hands on the wall, body straight, chest to the wall and press away.' },
  { id: 'x-kneepu', fam: 'push', gear: 'floor', tier: 1, type: 'reps', base: 12, name: 'Knee Push Up', cue: 'Knees down, hips straight — no piking. Chest to the floor every rep.' },
  { id: 'x-widepu', fam: 'push', gear: 'floor', tier: 2, type: 'reps', base: 12, name: 'Wide Push Up', cue: 'Hands well outside the shoulders. Chest leads, elbows at 60°.' },
  { id: 'x-tempopu', fam: 'push', gear: 'floor', tier: 2, type: 'reps', base: 8, name: 'Tempo Push Up', cue: 'Three seconds down, pause an inch off the floor, drive up fast.' },
  { id: 'x-hrpu', fam: 'push', gear: 'floor', tier: 2, type: 'reps', base: 10, name: 'Hands-Release Push Up', cue: 'Chest to the floor, lift both hands off, reset, press. No momentum.' },
  { id: 'x-taptpu', fam: 'push', gear: 'floor', tier: 2, type: 'reps-side', base: 6, name: 'Shoulder-Tap Push Up', cue: 'Push up, then tap the opposite shoulder. Hips dead still.' },
  { id: 'x-stagpu', fam: 'push', gear: 'floor', tier: 2, type: 'reps-side', base: 6, name: 'Staggered Push Up', cue: 'One hand forward, one back. Uneven load — swap hands each set.' },
  { id: 'x-negpu', fam: 'push', gear: 'floor', tier: 2, type: 'reps', base: 6, name: 'Slow Negative Push Up', cue: 'Five seconds down, drop to the knees, reset. Tendon work.' },
  { id: 'x-declpu', fam: 'push', gear: 'props', tier: 2, type: 'reps', base: 10, name: 'Decline Push Up', cue: 'Feet on a chair. The higher the feet, the more shoulder.' },
  { id: 'x-benchdip', fam: 'push', gear: 'props', tier: 1, type: 'reps', base: 12, name: 'Bench Dip', cue: 'Hands on the chair behind you, elbows straight back, full depth.' },
  { id: 'x-clappu', fam: 'push', gear: 'floor', tier: 3, type: 'reps', base: 8, name: 'Explosive Push Up', cue: 'Drive hard enough to leave the floor. Land soft, absorb, repeat.' },
  { id: 'x-defpu', fam: 'push', gear: 'floor', tier: 3, type: 'reps', base: 8, name: 'Deficit Push Up', cue: 'Hands on books, chest drops below the hands. Full stretch.' },
  // ---- pull
  { id: 'x-towelrow', fam: 'pull', gear: 'floor', tier: 1, type: 'reps', base: 12, name: 'Towel Doorframe Row', cue: 'Towel over a door handle, lean back, row chest to hands, squeeze.' },
  { id: 'x-doorscap', fam: 'pull', gear: 'floor', tier: 1, type: 'reps', base: 12, name: 'Doorframe Scap Pull', cue: 'Hold the frame, arms straight, pull the shoulder blades down and hold 2s.' },
  { id: 'x-packrow', fam: 'pull', gear: 'props', tier: 1, type: 'reps', base: 12, name: 'Backpack Row', cue: 'Loaded pack, flat back, row to the hip. 2s squeeze at the top.' },
  { id: 'x-tablerow', fam: 'pull', gear: 'props', tier: 2, type: 'reps', base: 10, name: 'Table Row', cue: 'Under a sturdy table, grab the edge, chest to the lip.' },
  { id: 'x-tablerowfeet', fam: 'pull', gear: 'props', tier: 2, type: 'reps', base: 8, name: 'Table Row, Feet Up', cue: 'Feet on a chair so the body is horizontal. Much harder.' },
  { id: 'x-deadhang', fam: 'pull', gear: 'bar', tier: 1, type: 'hold', base: 20, name: 'Dead Hang', cue: 'Knees bent if the bar is low. Shoulders active, not slumped in the sockets.' },
  { id: 'x-chinup', fam: 'pull', gear: 'bar', tier: 2, type: 'reps', base: 6, name: 'Chin Up', cue: 'Palms toward you. Chest to the bar, no kip.' },
  { id: 'x-mixgrip', fam: 'pull', gear: 'bar', tier: 2, type: 'reps-side', base: 3, name: 'Mixed-Grip Pull Up', cue: 'One palm forward, one back. Swap grips halfway.' },
  { id: 'x-tempochin', fam: 'pull', gear: 'bar', tier: 2, type: 'reps', base: 5, name: 'Tempo Chin Up', cue: 'Up in one, three seconds down, dead stop at the bottom.' },
  { id: 'x-negpull', fam: 'pull', gear: 'bar', tier: 2, type: 'reps', base: 4, name: 'Slow Negative Pull Up', cue: 'Jump or step to the top, five seconds down, chest proud.' },
  { id: 'x-towelhang', fam: 'pull', gear: 'bar', tier: 2, type: 'hold', base: 20, name: 'Towel Grip Hang', cue: 'Two towels over the bar. Grip work that saves your pull ups later.' },
  { id: 'x-widepull', fam: 'pull', gear: 'highbar', tier: 3, type: 'reps', base: 5, name: 'Wide Pull Up', cue: 'Hands well outside the shoulders, pull the elbows to the ribs.' },
  // ---- legs
  { id: 'x-revlunge', fam: 'legs', gear: 'floor', tier: 1, type: 'reps-side', base: 8, name: 'Reverse Lunge', cue: 'Long stride back, rear knee kisses the floor, stand through the front heel.' },
  { id: 'x-walklunge', fam: 'legs', gear: 'floor', tier: 2, type: 'reps-side', base: 8, name: 'Walking Lunge', cue: 'Travel forward, torso upright, no crashing the back knee.' },
  { id: 'x-jumpsquat', fam: 'legs', gear: 'floor', tier: 2, type: 'reps', base: 12, name: 'Jump Squat', cue: 'Full depth, explode, land quiet and sink straight into the next one.' },
  { id: 'x-pulse', fam: 'legs', gear: 'floor', tier: 1, type: 'reps', base: 15, name: 'Squat Pulse', cue: 'Live in the bottom third. Small, fast, relentless.' },
  { id: 'x-wallsit', fam: 'legs', gear: 'floor', tier: 1, type: 'hold', base: 45, name: 'Wall Sit', cue: 'Thighs parallel, back flat on the wall, hands off the legs.' },
  { id: 'x-squathold', fam: 'legs', gear: 'floor', tier: 1, type: 'hold', base: 45, name: 'Deep Squat Hold', cue: 'Sit in the hole, chest up, elbows pushing the knees out.' },
  { id: 'x-cossack', fam: 'legs', gear: 'floor', tier: 2, type: 'reps-side', base: 6, name: 'Cossack Squat', cue: 'Wide stance, sink to one side, other leg straight with the toe up.' },
  { id: 'x-bridge', fam: 'legs', gear: 'floor', tier: 1, type: 'reps', base: 20, name: 'Glute Bridge', cue: 'Heels close, ribs down, squeeze the glutes hard at the top for a second.' },
  { id: 'x-slbridge', fam: 'legs', gear: 'floor', tier: 2, type: 'reps-side', base: 10, name: 'Single-Leg Glute Bridge', cue: 'One foot down, hips level the whole way — do not let one side drop.' },
  { id: 'x-calf', fam: 'legs', gear: 'floor', tier: 1, type: 'reps', base: 20, name: 'Calf Raise', cue: 'All the way up onto the toes, two-second squeeze, all the way down.' },
  { id: 'x-slcalf', fam: 'legs', gear: 'floor', tier: 2, type: 'reps-side', base: 12, name: 'Single-Leg Calf Raise', cue: 'Fingertips on a wall for balance only. Full range.' },
  { id: 'x-goodmorning', fam: 'legs', gear: 'floor', tier: 1, type: 'reps', base: 15, name: 'Good Morning', cue: 'Hands behind the head, soft knees, hinge at the hips with a flat back.' },
  { id: 'x-stepup', fam: 'legs', gear: 'props', tier: 1, type: 'reps-side', base: 10, name: 'Step Up', cue: 'Chair or stairs. Drive through the heel, no pushing off the back foot.' },
  { id: 'x-skater', fam: 'legs', gear: 'floor', tier: 3, type: 'reps-side', base: 6, name: 'Skater Squat', cue: 'One leg, rear knee reaches for the floor behind, torso leans forward.' },
  { id: 'x-sissy', fam: 'legs', gear: 'floor', tier: 3, type: 'reps', base: 10, name: 'Sissy Squat', cue: 'Knees travel forward, hips stay extended, lean back. Quads only.' },
  // ---- core
  { id: 'x-hollow', fam: 'core', gear: 'floor', tier: 1, type: 'hold', base: 30, name: 'Hollow Hold', cue: 'Lower back glued down. Tuck the knees if it peels up.' },
  { id: 'x-hollowrock', fam: 'core', gear: 'floor', tier: 2, type: 'reps', base: 20, name: 'Hollow Rock', cue: 'Hold the hollow shape and rock from the shoulders — the shape never breaks.' },
  { id: 'x-sideplank', fam: 'core', gear: 'floor', tier: 1, type: 'hold', base: 20, name: 'Side Plank, each side', cue: 'Hips high, straight line head to heels. Half the time per side.' },
  { id: 'x-situp', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 20, name: 'Sit Up', cue: 'Feet down, roll up one vertebra at a time, reach past the toes.' },
  { id: 'x-vup', fam: 'core', gear: 'floor', tier: 2, type: 'reps', base: 15, name: 'V-Up', cue: 'Straight legs and arms meet over the hips. Slow down, no flopping.' },
  { id: 'x-flutter', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 30, name: 'Flutter Kick', cue: 'Hands under the hips, legs straight, low back pinned. Count each kick.' },
  { id: 'x-deadbug', fam: 'core', gear: 'floor', tier: 1, type: 'reps-side', base: 10, name: 'Dead Bug', cue: 'Opposite arm and leg reach out slow, ribs down, back flat.' },
  { id: 'x-bicycle', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 30, name: 'Bicycle Crunch', cue: 'Elbow to the opposite knee, other leg long. Count each side.' },
  { id: 'x-mtnclimb', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 30, name: 'Mountain Climber', cue: 'Plank position, drive the knees, hips stay low and level.' },
  { id: 'x-twist', fam: 'core', gear: 'floor', tier: 2, type: 'reps', base: 20, name: 'Russian Twist', cue: 'Feet off the floor, chest tall, rotate from the ribs not the arms.' },
  { id: 'x-legraise', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 15, name: 'Lying Leg Raise', cue: 'Hands under the hips, legs straight up and lower to a hover — never rest.' },
  { id: 'x-revcrunch', fam: 'core', gear: 'floor', tier: 1, type: 'reps', base: 15, name: 'Reverse Crunch', cue: 'Knees to the chest and lift the hips off the floor. No swinging.' },
  { id: 'x-superman', fam: 'core', gear: 'floor', tier: 1, type: 'hold', base: 30, name: 'Superman Hold', cue: 'Face down, arms and legs off the floor, glutes on. The other side of the core.' },
  { id: 'x-birddog', fam: 'core', gear: 'floor', tier: 1, type: 'reps-side', base: 10, name: 'Bird Dog', cue: 'Opposite arm and leg long, hips square, pause a second at the end.' },
  { id: 'x-planktap', fam: 'core', gear: 'floor', tier: 2, type: 'reps-side', base: 10, name: 'Plank Shoulder Tap', cue: 'Plank, tap the opposite shoulder, hips refuse to rotate.' },
  { id: 'x-bearhold', fam: 'core', gear: 'floor', tier: 2, type: 'hold', base: 30, name: 'Bear Crawl Hold', cue: 'Knees an inch off the floor, back flat enough to balance a glass on.' },
  { id: 'x-kneeraise', fam: 'core', gear: 'bar', tier: 2, type: 'reps', base: 10, name: 'Hanging Knee Raise', cue: 'Hang, knees to the chest, no swing. Lower them with control.' },
];

/* ---------- config ---------- */

function engineCfg() {
  if (!state.engine || typeof state.engine !== 'object') state.engine = {};
  if (!Array.isArray(state.engine.scores)) state.engine.scores = [];
  if (!state.engine.cfg || typeof state.engine.cfg !== 'object') state.engine.cfg = {};
  // patched in place — callers hold on to this object
  const c = state.engine.cfg;
  const d = { mins: 20, breaks: 5, holdLen: 30, finisher: true, sound: true, voice: false, rotate: 3, core: 'auto' };
  for (const k in d) if (c[k] === undefined || c[k] === null) c[k] = d[k];
  if (!c.gear || typeof c.gear !== 'object') c.gear = { bar: true };
  c.gear.floor = true;                                   // you always have the floor
  for (const g of ['bar', 'highbar', 'props', 'rings']) c.gear[g] = !!c.gear[g];
  if (!c.adj || typeof c.adj !== 'object') c.adj = {};
  for (const f of ENG_FAM_KEYS) c.adj[f] = Math.max(-4, Math.min(6, Number(c.adj[f]) || 0));
  if (!ENG_MINS.includes(c.mins)) c.mins = 20;
  if (![0, 4, 5].includes(c.breaks)) c.breaks = 5;
  if (![30, 40, 45].includes(c.holdLen)) c.holdLen = 30;
  if (![0, 1, 2, 3, 4].includes(c.rotate)) c.rotate = 3;
  if (!['auto', 'on', 'off'].includes(c.core)) c.core = 'auto';
  return c;
}
function engineCoreOn() {
  const c = engineCfg();
  return c.core === 'on' || (c.core === 'auto' && !c.breaks);
}
function engineSlotKeys() {
  return engineCoreOn() ? ['pull', 'push', 'legs', 'core'] : ['pull', 'push', 'legs'];
}
function engineGearOk(g) { return !!engineCfg().gear[g || 'floor']; }

/* ---------- the movement pool ---------- */

function engineTier(fam) {
  // where you sit in this family right now → which variants belong in the mix
  const bands = { beg: 1, int: 2, adv: 3, elite: 3 };
  let t = 1;
  for (const cid of ENG_FAM[fam].chains) {
    const c = chainById(cid);
    const lv = c.levels[Math.min(state.chains[cid].level, c.levels.length - 1)];
    t = Math.max(t, bands[lv.band] || 1);
  }
  return t;
}

function engineDoseFor(type, raw, fam) {
  const step = type === 'hold' ? 5 : 1;
  const adj = (engineCfg().adj[fam] || 0) * step;
  const floorV = type === 'hold' ? 5 : 1;
  return Math.min(type === 'hold' ? 180 : 60, Math.max(floorV, Math.round(raw) + adj));
}
function engineUnit(type, dose) {
  return type === 'hold' ? `${dose}s` : type === 'reps-side' ? `${dose}/side` : `${dose}`;
}
function engineMove(base) {
  const dose = engineDoseFor(base.type, base.raw, base.fam);
  const unit = engineUnit(base.type, dose);
  return {
    ...base, dose, unit,
    reps: base.type === 'hold' ? 0 : (base.type === 'reps-side' ? dose * 2 : dose),
    secs: base.type === 'hold' ? dose : 0,
    short: `${unit} ${base.name}`,
  };
}

/* your own ladder levels, at and just below where you are now */
function engineChainMoves(fam) {
  const out = [];
  for (const cid of ENG_FAM[fam].chains) {
    const c = chainById(cid);
    const cur = Math.min(state.chains[cid].level, c.levels.length - 1);
    for (let i = Math.max(0, cur - 1); i <= cur; i++) {
      const lv = c.levels[i];
      const gear = ENG_GEAR[`${cid}:${lv.name}`] || 'floor';
      if (!engineGearOk(gear)) continue;
      const sch = lv.scheme;
      const type = sch.type === 'neg' ? 'reps' : sch.type;
      const r = ENG_DOSE[fam];
      let raw;
      if (type === 'hold') raw = Math.max(10, Math.round(sch.cap * r * 0.6 / 5) * 5);
      else if (type === 'reps-side') raw = Math.max(2, Math.round(sch.cap * r * 0.5));
      else raw = Math.max(2, Math.round(sch.cap * r));
      out.push(engineMove({
        id: `${cid}:${lv.name}`, fam, gear, type, raw,
        name: lv.name, cue: lv.cue, ladder: chainById(cid).short, isLevel: i === cur,
      }));
    }
  }
  return out;
}

/* the variant pool, filtered to your gear and near your tier */
function engineExtraMoves(fam) {
  const t = engineTier(fam);
  const lo = t >= 3 ? 2 : 1;
  return ENG_EXTRA
    .filter(m => m.fam === fam && engineGearOk(m.gear) && m.tier >= lo && m.tier <= t)
    .map(m => engineMove({ ...m, raw: m.base }));
}

function enginePool(fam) {
  const pool = [...engineChainMoves(fam), ...engineExtraMoves(fam)];
  if (pool.length) return pool;
  // nothing passed the gear filter — fall back to anything floor-based in this family
  const any = ENG_EXTRA.filter(m => m.fam === fam && m.gear === 'floor');
  return any.map(m => engineMove({ ...m, raw: m.base }));
}

/* ---------- rotation ---------- */

function engineMakeRotation(n, avoid) {
  const slots = engineSlotKeys();
  const pools = {};
  for (const f of slots) pools[f] = enginePool(f);
  const rounds = [];
  const used = {};
  // `avoid` carries the previous round's movements so nothing repeats back to back
  for (const f of slots) used[f] = (avoid && avoid[f]) ? avoid[f].slice() : [];
  const count = Math.max(1, n || 1);
  for (let r = 0; r < count; r++) {
    const round = [];
    for (const f of slots) {
      const pool = pools[f];
      // prefer something this rotation has not used yet; your real level goes first
      let choices = pool.filter(m => !used[f].includes(m.id));
      if (!choices.length) { used[f] = []; choices = pool.slice(); }
      if (r === 0) {
        const own = choices.filter(m => m.isLevel);
        if (own.length) choices = own;
      }
      const pick = choices[Math.floor(Math.random() * choices.length)];
      used[f].push(pick.id);
      round.push(pick);
    }
    rounds.push(round);
  }
  return rounds;
}

function engineRotation(force) {
  const cfg = engineCfg();
  const n = cfg.rotate === 0 ? 1 : cfg.rotate;
  const slots = engineSlotKeys();
  const lvSig = CHAINS.map(c => state.chains[c.id].level).join('.');
  let rot = state.engine.rotation;
  const stale = force || !Array.isArray(rot) || rot.length !== n ||
    state.engine.rotSlots !== slots.join(',') ||
    state.engine.rotGear !== JSON.stringify(cfg.gear) ||
    state.engine.rotLv !== lvSig ||
    rot.some(ids => !Array.isArray(ids) || ids.length !== slots.length ||
      ids.some(id => !engineMoveById(id)));
  if (stale) {
    state.engine.rotation = engineMakeRotation(n).map(r => r.map(m => m.id));
    state.engine.rotSlots = slots.join(',');
    state.engine.rotGear = JSON.stringify(cfg.gear);
    state.engine.rotLv = lvSig;
  }
  // rebuild live move objects from the stored ids so dose edits apply straight away
  return state.engine.rotation.map(ids => ids.map(id => engineMoveById(id)).filter(Boolean));
}

function engineMoveById(id) {
  const x = ENG_EXTRA.find(m => m.id === id);
  if (x) return engineMove({ ...x, raw: x.base });
  const [cid, ...rest] = id.split(':');
  const name = rest.join(':');
  const c = chainById(cid);
  if (!c) return null;
  const lv = c.levels.find(l => l.name === name);
  if (!lv) return null;
  const fam = ENG_FAM_KEYS.find(f => ENG_FAM[f].chains.includes(cid)) || 'core';
  const sch = lv.scheme;
  const type = sch.type === 'neg' ? 'reps' : sch.type;
  const r = ENG_DOSE[fam];
  let raw;
  if (type === 'hold') raw = Math.max(10, Math.round(sch.cap * r * 0.6 / 5) * 5);
  else if (type === 'reps-side') raw = Math.max(2, Math.round(sch.cap * r * 0.5));
  else raw = Math.max(2, Math.round(sch.cap * r));
  return engineMove({ id, fam, gear: ENG_GEAR[id] || 'floor', type, raw, name: lv.name, cue: lv.cue, ladder: c.short });
}

function engineRoundStats(round) {
  return {
    reps: round.reduce((n, m) => n + m.reps, 0),
    secs: round.reduce((n, m) => n + m.secs, 0),
  };
}
function engineSig(cfg, rotation) {
  return `${cfg.mins}|${cfg.rotate}|${rotation.map(r => r.map(m => `${m.id}:${m.dose}`).join('+')).join('/')}`;
}
function engineBest(sig) {
  return (state.engine.scores || [])
    .filter(s => s.sig === sig)
    .reduce((b, s) => (!b || s.rounds > b.rounds || (s.rounds === b.rounds && s.extra > b.extra)) ? s : b, null);
}

function openEngine() { trainDay = 'E'; setView('train'); }

/* ---------- setup screen ---------- */

function renderEngine() {
  const cfg = engineCfg();
  const rotation = engineRotation(false);
  const best = engineBest(engineSig(cfg, rotation));
  const scores = (state.engine.scores || []).slice(0, 5);
  const gearOn = Object.keys(ENG_GEAR_LABEL).filter(g => cfg.gear[g]);
  const poolCount = engineSlotKeys().reduce((n, f) => n + enginePool(f).length, 0);
  const chip = (on, onclick, label, sub) =>
    `<button class="chip ${on ? 'on' : ''}" onclick="${onclick}">${label}${sub ? `<small>${sub}</small>` : ''}</button>`;

  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">DAY E · ENGINE · SHORT ON TIME</div>
      <h1 class="page-title">Train</h1>
      <p class="page-sub">One clock, endless rounds, and a rotation so no two rounds in a row hit the same way.
        Built for the days the full session is not happening — twenty minutes beats a skipped week, and ten beats nothing at all.</p>
    </div>

    <div class="day-tabs reveal" style="animation-delay:60ms">
      ${Object.values(DAYS).map(d => `
        <button class="day-tab ${d.key === 'E' ? 'active' : ''}" onclick="switchDay('${d.key}')">
          <b>DAY ${d.key} · ${d.name}</b><span>${d.tagline}</span>
        </button>`).join('')}
    </div>
    <p class="day-desc reveal" style="animation-delay:90ms">${DAYS.E.desc}</p>

    ${deloadActive() ? `<div class="deload-banner reveal" style="animation-delay:95ms">
      <b>DELOAD WEEK · ${state.deload.remaining} session${state.deload.remaining > 1 ? 's' : ''} left</b>
      An all-out AMRAP is the opposite of a deload. If you run this now, keep it to 10 minutes,
      stay three reps away from failure every round, and skip the finisher.
    </div>` : ''}

    <div class="eng-setup">
      <div class="eng-card reveal" style="animation-delay:110ms">
        <h3>WHAT YOU HAVE<small>everything below is filtered to this</small></h3>
        <div class="chips">
          <button class="chip on" disabled style="opacity:.8;cursor:default">FLOOR<small>always</small></button>
          ${chip(cfg.gear.bar, "engineGear('bar')", 'DOORWAY BAR', 'knees bent, no swing')}
          ${chip(cfg.gear.highbar, "engineGear('highbar')", 'HIGH BAR', 'park / rig, full hang')}
          ${chip(cfg.gear.props, "engineGear('props')", 'CHAIR / TABLE', 'couch, stairs, backpack')}
          ${chip(cfg.gear.rings, "engineGear('rings')", 'RINGS / WHEEL', 'parallettes too')}
        </div>
        <p class="eng-note">
          ${poolCount} movements available with <b>${gearOn.map(g => ENG_GEAR_LABEL[g]).join(' + ')}</b> —
          your own ladder levels plus Engine variants near them. A doorway bar rules out anything that needs a
          full dead hang or a wide grip; turn on <b>high bar</b> when you are at the park and those come back.
        </p>
      </div>

      <div class="eng-card reveal" style="animation-delay:140ms">
        <h3>THE ROTATION<small>rounds cycle in this order, then start over</small></h3>
        <div class="chips" style="margin-bottom:14px">
          ${[1, 2, 3, 4].map(n => chip(cfg.rotate === n, `engineSet('rotate',${n})`, n === 1 ? 'SAME ROUND' : `${n} ROUNDS`)).join('')}
          ${chip(cfg.rotate === 0, "engineSet('rotate',0)", 'FRESH EVERY ROUND', 'nothing repeats')}
        </div>
        ${cfg.rotate === 0
          ? `<p class="eng-note" style="margin-top:0">Every single round is drawn fresh from the ${poolCount} movements above —
             you find out what is next when you finish the one you are on. Below is a sample.</p>` : ''}
        ${rotation.map((round, i) => {
          const st = engineRoundStats(round);
          return `
          <div class="eng-rnd">
            <div class="eng-rnd-head">
              <b>${cfg.rotate === 0 ? 'SAMPLE ROUND' : `ROUND ${i + 1}`}</b>
              <span class="mono">${st.reps ? `${st.reps} reps` : ''}${st.reps && st.secs ? ' · ' : ''}${st.secs ? `${st.secs}s` : ''}</span>
            </div>
            ${round.map(m => `
              <div class="eng-mv">
                <span class="dose mono">${m.unit}</span>
                <span class="mv-name">${m.name}<small>${m.cue}</small></span>
                <span class="mv-tag mono">${m.ladder ? m.ladder : ENG_GEAR_LABEL[m.gear].toUpperCase()}</span>
              </div>`).join('')}
          </div>`;
        }).join('')}
        <div class="eng-start" style="margin-top:14px">
          <button class="btn ghost small" onclick="engineReshuffle()">⟳ RESHUFFLE THE ROTATION</button>
        </div>
        <div class="eng-opt-row" style="margin-top:16px">
          <div>
            <h4>INTENSITY BY SLOT<small style="letter-spacing:0">— nudge a whole slot up or down</small></h4>
            <div class="eng-round">
              ${engineSlotKeys().map(f => `
                <div class="eng-slot">
                  <span class="tag">${ENG_FAM[f].tag}</span>
                  <span class="name"><b>${ENG_FAM[f].label}</b><span>${enginePool(f).length} movements in the mix</span></span>
                  <span class="eng-dose">
                    <button class="eng-step" onclick="engineAdj('${f}',-1)" aria-label="Fewer">−</button>
                    <b>${cfg.adj[f] > 0 ? '+' : ''}${cfg.adj[f] || 0}</b>
                    <button class="eng-step" onclick="engineAdj('${f}',1)" aria-label="More">+</button>
                  </span>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="eng-card reveal" style="animation-delay:170ms">
        <h3>THE CLOCK</h3>
        <div class="eng-opt-row">
          <div>
            <h4>TIME CAP</h4>
            <div class="chips">
              ${ENG_MINS.map(m => chip(cfg.mins === m, `engineSet('mins',${m})`, `${m} MIN`,
                m === 20 ? 'the benchmark' : m === 12 ? 'lunch break' : 'bare minimum')).join('')}
            </div>
          </div>
          <div>
            <h4>CORE BREAKS</h4>
            <div class="chips">
              ${chip(cfg.breaks === 5, "engineSet('breaks',5)", 'EVERY 5 MIN')}
              ${chip(cfg.breaks === 4, "engineSet('breaks',4)", 'EVERY 4 MIN')}
              ${chip(cfg.breaks === 0, "engineSet('breaks',0)", 'NONE', 'core moves into the rounds')}
            </div>
          </div>
          ${cfg.breaks ? `<div>
            <h4>HOLD LENGTH</h4>
            <div class="chips">
              ${[30, 40, 45].map(h => chip(cfg.holdLen === h, `engineSet('holdLen',${h})`, `${h}s`)).join('')}
            </div>
          </div>` : ''}
          <div>
            <h4>CORE IN THE ROUNDS</h4>
            <div class="chips">
              ${chip(cfg.core === 'auto', "engineSet('core','auto')", 'AUTO', cfg.breaks ? 'off — breaks cover it' : 'on — no breaks')}
              ${chip(cfg.core === 'on', "engineSet('core','on')", 'ALWAYS')}
              ${chip(cfg.core === 'off', "engineSet('core','off')", 'NEVER')}
            </div>
          </div>
          <div>
            <h4>FINISHER &amp; CUES</h4>
            <div class="chips">
              ${chip(cfg.finisher, "engineSet('finisher',!engineCfg().finisher)", 'MAX HOLLOW HOLD', 'after the bell')}
              ${chip(cfg.sound, "engineSet('sound',!engineCfg().sound)", 'BEEPS')}
              ${chip(cfg.voice, "engineSet('voice',!engineCfg().voice)", 'SPOKEN CUES')}
            </div>
          </div>
        </div>
        <p class="eng-note">
          When the timer calls a break, stop wherever you are, do the hold, then pick up on the exact rep you
          left — <b>the clock never stops</b>. Warm up first: one easy round at half speed, then start.
          Turn the volume up; on an iPhone, take it off silent or the beeps stay muted.
        </p>
      </div>

      ${scores.length ? `<div class="eng-card reveal" style="animation-delay:200ms">
        <h3>SCORES<small>same rotation, same clock = a fair fight</small></h3>
        <div class="eng-scores">
          ${scores.map(s => {
            const isPr = best && s.d === best.d;
            return `<div class="eng-score ${isPr ? 'pr' : ''}">
              <span class="when">${new Date(s.d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span class="res">${s.rounds} round${s.rounds === 1 ? '' : 's'}${s.extra ? ` + ${s.extra}` : ''}</span>
              <span class="det">${s.mins} min · ${s.reps} reps${s.hold ? ` · finisher ${s.hold}s` : ''}${s.moves ? ` · ${s.moves}` : ''}</span>
              ${isPr ? '<span class="eng-pr-tag">BEST</span>' : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}
    </div>

    <div class="eng-start reveal" style="animation-delay:240ms">
      <button class="btn primary" style="padding:18px 44px;font-size:15px" onclick="engineStart()">START THE CLOCK ▸</button>
      ${best ? `<span class="eng-pr mono">TO BEAT: ${best.rounds} ROUND${best.rounds === 1 ? '' : 'S'}${best.extra ? ` + ${best.extra}` : ''}</span>` : ''}
    </div>`;
}

function engineSet(k, v) {
  const cfg = engineCfg();
  cfg[k] = v;
  if (k === 'sound' && v) beep([660], 0.07);
  if (k === 'voice' && v) engineSay('Spoken cues on');
  if (k === 'rotate' || k === 'core' || k === 'breaks') engineRotation(true);
  save();
  renderEngine();
}
function engineGear(g) {
  const cfg = engineCfg();
  cfg.gear[g] = !cfg.gear[g];
  engineRotation(true);
  save();
  renderEngine();
}
function engineAdj(fam, dir) {
  const cfg = engineCfg();
  cfg.adj[fam] = Math.max(-4, Math.min(6, (cfg.adj[fam] || 0) + dir));
  save();
  renderEngine();
}
function engineReshuffle() {
  engineRotation(true);
  save();
  renderEngine();
  toast('New rotation drawn.');
}

/* ---------- the plan ---------- */

function engineBuildPlan() {
  const cfg = engineCfg();
  const rotation = engineRotation(false);
  const TOTAL = cfg.mins * 60;
  const order = ['hollow', 'side', 'plank'];
  const maxBreak = ENG_SET + cfg.holdLen * 2 + ENG_SWITCH + 15;
  const marks = [];
  if (cfg.breaks) {
    // a break has to leave at least a minute of work behind it, or it is just an ending
    for (let m = cfg.breaks * 60; m + maxBreak + 60 <= TOTAL; m += cfg.breaks * 60) marks.push(m);
  }

  const segs = [{ kind: 'lead', start: -ENG_LEAD, end: 0, title: 'GET READY', cue: 'Round 1 is on the screen the second this hits zero.' }];
  const breaks = [];
  let cursor = 0, coreSecs = 0;

  marks.forEach((m, i) => {
    const key = order[i % order.length], mv = ENG_CORE[key];
    segs.push({
      kind: 'work', start: cursor, end: m, title: 'WORK',
      cue: i === 0 ? '' : 'Pick up exactly where you left off.',
      say: i === 0 ? 'Go' : 'Back to work', next: mv.name,
    });
    let t = m;
    segs.push({
      kind: 'set', start: t, end: t + ENG_SET,
      title: `GET INTO ${mv.name.toUpperCase()}${key === 'side' ? ' — LEFT' : ''}`,
      cue: 'Stop where you are. The hold starts when this hits zero.',
      say: `${mv.name}. Get set.`,
    });
    t += ENG_SET;
    if (key === 'side') {
      segs.push({ kind: 'hold', start: t, end: t + cfg.holdLen, title: 'SIDE PLANK — LEFT', cue: mv.cue, say: 'Hold' });
      t += cfg.holdLen;
      segs.push({ kind: 'switch', start: t, end: t + ENG_SWITCH, title: 'SWITCH SIDES', cue: 'Roll over to the other side.', say: 'Switch sides' });
      t += ENG_SWITCH;
      segs.push({ kind: 'hold', start: t, end: t + cfg.holdLen, title: 'SIDE PLANK — RIGHT', cue: mv.cue, say: 'Hold' });
      t += cfg.holdLen;
      coreSecs += cfg.holdLen * 2;
      breaks.push({ at: m, end: t, text: `Side plank · ${cfg.holdLen}s each side` });
    } else {
      const len = key === 'plank' ? cfg.holdLen + 15 : cfg.holdLen;
      segs.push({ kind: 'hold', start: t, end: t + len, title: mv.name.toUpperCase(), cue: mv.cue, say: 'Hold' });
      t += len;
      coreSecs += len;
      breaks.push({ at: m, end: t, text: `${mv.name} · ${len}s` });
    }
    cursor = t;
  });

  segs.push({
    kind: 'work', start: cursor, end: TOTAL, title: 'WORK',
    cue: marks.length ? 'Pick up exactly where you left off.' : '',
    say: marks.length ? 'Back to work' : 'Go',
    next: cfg.finisher ? ENG_CORE.max.name : 'Time',
  });
  if (cfg.finisher) {
    segs.push({
      kind: 'set', start: TOTAL, end: TOTAL + ENG_SET, title: 'TIME — GET INTO A HOLLOW HOLD',
      cue: 'Remember the reps from your last part-round, then get down for the finisher.',
      say: 'Time. Max hollow hold. Get set.',
    });
    segs.push({ kind: 'max', start: TOTAL + ENG_SET, end: Infinity, title: 'MAX HOLLOW HOLD', cue: ENG_CORE.max.cue, say: 'Hold' });
  } else {
    segs.push({ kind: 'end', start: TOTAL, end: Infinity, title: 'TIME', cue: '', say: 'Time' });
  }

  const cues = [];
  segs.forEach(s => {
    if (s.kind === 'lead') cues.push({ t: s.start, tone: 'tick' });
    else if (s.kind === 'set' || s.kind === 'switch') cues.push({ t: s.start, tone: 'alarm', say: s.say });
    else cues.push({ t: s.start, tone: 'go', say: s.say });
    if (s.kind !== 'switch' && s.kind !== 'max' && s.kind !== 'end') {
      for (let k = 3; k >= 1; k--) if (s.end - k > s.start) cues.push({ t: s.end - k, tone: 'tick' });
    }
  });
  cues.sort((a, b) => a.t - b.t);

  return { segs, cues, breaks, total: TOTAL, coreSecs, rotation, fresh: cfg.rotate === 0, cfg: JSON.parse(JSON.stringify(cfg)) };
}

/* ---------- run ---------- */

let eng = null;
let engTicker = null;
let engResult = null;
let engLastClock = '';
let engEndArmed = null;

function engineElapsed() {
  const now = eng.pausedAt != null ? eng.pausedAt : Date.now();
  return (now - eng.t0 - eng.pausedTotal) / 1000 - ENG_LEAD;
}
function engineSay(text) {
  if (!engineCfg().voice || !text) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    synth.speak(u);
  } catch { /* no voice here — beeps still work */ }
}
function engTone(kind) {
  if (!engineCfg().sound) return;
  if (kind === 'tick') beep([660], 0.07);
  else if (kind === 'go') { beep([880, 1318.5], 0.12, 0.3); buzz(60); }
  else if (kind === 'alarm') { beep([988, 988, 988], 0.1, 0.3); buzz([180, 90, 180]); }
}

/* the round you are on right now */
function engineCurRound() {
  if (!eng) return [];
  if (eng.plan.fresh) {
    while (eng.rounds.length <= eng.done.length) {
      const prev = eng.rounds[eng.rounds.length - 1];
      const avoid = {};
      if (prev) for (const m of prev) (avoid[m.fam] = avoid[m.fam] || []).push(m.id);
      eng.rounds.push(engineMakeRotation(1, avoid)[0]);
    }
    return eng.rounds[eng.done.length];
  }
  return eng.plan.rotation[eng.done.length % eng.plan.rotation.length];
}

function engineStart() {
  const plan = engineBuildPlan();
  eng = {
    plan, t0: Date.now(), pausedAt: null, pausedTotal: 0,
    segIdx: 0, seg: null, cueIdx: 0, done: [], rounds: [], cues: false,
  };
  if (plan.fresh) eng.rounds = [engineMakeRotation(1)[0]];
  engResult = null;
  engLastClock = '';
  engEndArmed = null;
  const ov = $('#engineOverlay');
  ov.hidden = false;
  ov.removeAttribute('data-paused');
  ov.dataset.phase = 'lead';
  document.body.style.overflow = 'hidden';
  acquireWakeLock();
  beep([660], 0.07);            // unlocks audio on the tap that started it
  engineSay('Get ready');
  engineRunShell();
  engineTick();
  clearInterval(engTicker);
  engTicker = setInterval(engineTick, 100);
}

function engineRunShell() {
  const cfg = eng.plan.cfg;
  const segsHtml = eng.plan.breaks.map(b =>
    `<div class="seg" style="left:${(b.at / eng.plan.total) * 100}%;width:${((b.end - b.at) / eng.plan.total) * 100}%"></div>`).join('');
  const marks = eng.plan.breaks.map(b =>
    `<span style="left:${(b.at / eng.plan.total) * 100}%">${fmtClock(b.at)}</span>`).join('') +
    `<span class="end" style="left:100%">${fmtClock(eng.plan.total)}</span>`;

  $('#engineInner').innerHTML = `
    <div class="focus-head">
      <button class="focus-x" onclick="engineQuit()" aria-label="End">✕</button>
      <div class="focus-title mono">DAY E · ENGINE · ${cfg.mins} MIN</div>
      <div class="focus-count mono" id="engElapsed">0:00</div>
    </div>
    <div class="eng-stage">
      <div class="eng-kicker mono" id="engKicker">GET READY</div>
      <div class="eng-phase" id="engPhase">GET READY</div>
      <p class="eng-cue" id="engCue"></p>
      <div class="eng-card-live" id="engRoundCard" hidden></div>
      <div class="eng-clock" id="engClock">10</div>
      <div class="eng-next mono" id="engNext"></div>
    </div>
    <div class="eng-track">
      <div class="fill" id="engFill"></div>${segsHtml}
    </div>
    <div class="eng-marks">${marks}</div>
    <div class="eng-bottom">
      <div class="eng-rounds" id="engRoundsRow">
        <button class="eng-round-btn" onclick="engineRound()">
          <span class="count" id="engRounds">0</span>
          <span class="lbl">ROUND DONE<small>tap when the whole list is finished</small></span>
        </button>
        <button class="eng-undo" onclick="engineUndo()">UNDO</button>
      </div>
      <button class="eng-stop" id="engStopHold" hidden onclick="engineStopHold()">STOP THE HOLD</button>
      <div class="eng-controls">
        <button class="btn ghost small" id="engPause" onclick="enginePause()">PAUSE</button>
        <button class="btn ghost small" id="engCues" onclick="engineToggleCues()">CUES</button>
        <button class="btn ghost small" id="engMute" onclick="engineMute()">${(engineCfg().sound || engineCfg().voice) ? 'MUTE' : 'UNMUTE'}</button>
        <button class="btn ghost small" id="engEnd" onclick="engineQuit()">END</button>
      </div>
    </div>`;
  engineDrawRound();
}

function fmtClock(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function engineDrawRound() {
  const card = $('#engRoundCard');
  if (!card || !eng) return;
  const round = engineCurRound();
  const n = eng.done.length + 1;
  const tag = eng.plan.fresh
    ? 'DRAWN FRESH'
    : eng.plan.rotation.length > 1
      ? `${(eng.done.length % eng.plan.rotation.length) + 1} OF ${eng.plan.rotation.length} IN THE ROTATION`
      : 'EVERY ROUND';
  card.innerHTML = `
    <div class="ecl-head mono"><b>ROUND ${n}</b><span>${tag}</span></div>
    ${round.map(m => `
      <div class="ecl-mv">
        <span class="dose mono">${m.unit}</span>
        <span class="nm">${m.name}${eng.cues ? `<small>${m.cue}</small>` : ''}</span>
      </div>`).join('')}`;
}

function engineEnterSeg(seg) {
  const ov = $('#engineOverlay');
  ov.dataset.phase = seg.kind;
  $('#engPhase').textContent = seg.title;
  $('#engCue').textContent = seg.cue || '';
  $('#engKicker').textContent =
    seg.kind === 'work' ? 'ON THE CLOCK' :
    seg.kind === 'lead' ? 'STARTING' :
    seg.kind === 'max' ? 'FINISHER' : 'CORE BREAK';
  const work = seg.kind === 'work';
  const finisher = seg.kind === 'max';
  $('#engRoundCard').hidden = !work;
  $('#engPhase').hidden = work;              // the round list is the headline while you work
  $('#engRoundsRow').hidden = finisher;
  $('#engStopHold').hidden = !finisher;
  if (work) engineDrawRound();
}

function engineTick() {
  if (!eng || eng.pausedAt != null) return;
  const e = engineElapsed();
  const segs = eng.plan.segs;
  while (eng.segIdx < segs.length - 1 && e >= segs[eng.segIdx].end) eng.segIdx++;
  const seg = segs[eng.segIdx];
  if (seg !== eng.seg) {
    eng.seg = seg;
    engineEnterSeg(seg);
    if (seg.kind === 'end') { engTone('alarm'); engineSay('Time'); engineDone(0); return; }
  }

  const cues = eng.plan.cues;
  while (eng.cueIdx < cues.length && cues[eng.cueIdx].t <= e) {
    const c = cues[eng.cueIdx++];
    if (e - c.t < 1.2) { engTone(c.tone); engineSay(c.say); }
  }

  let clock, next;
  if (seg.kind === 'lead') {
    clock = String(Math.max(1, Math.ceil(-e)));
    next = 'THE CLOCK STARTS AT ZERO';
  } else if (seg.kind === 'work') {
    clock = fmtClock(e);
    next = `${seg.next.toUpperCase()} IN <b>${fmtClock(Math.ceil(seg.end - e))}</b>`;
  } else if (seg.kind === 'max') {
    clock = fmtClock(e - seg.start);
    next = 'HOLD UNTIL FORM BREAKS — THEN STOP THE CLOCK';
  } else {
    clock = String(Math.max(1, Math.ceil(seg.end - e)));
    next = `WORKOUT CLOCK <b>${fmtClock(Math.min(e, eng.plan.total))}</b>`;
  }
  if (clock !== engLastClock) { $('#engClock').textContent = clock; engLastClock = clock; }
  $('#engNext').innerHTML = next;
  $('#engElapsed').textContent = fmtClock(Math.max(0, Math.min(e, eng.plan.total)));
  $('#engFill').style.width = `${Math.max(0, Math.min(100, (e / eng.plan.total) * 100))}%`;
}

function engineRound() {
  if (!eng) return;
  const round = engineCurRound();
  eng.done.push(round.map(m => m.id));
  eng.lastStats = engineRoundStats(round);
  $('#engRounds').textContent = eng.done.length;
  if (engineCfg().sound) beep([1046.5], 0.05, 0.22);
  buzz(25);
  engineDrawRound();
}
function engineUndo() {
  if (!eng || !eng.done.length) return;
  eng.done.pop();
  if (eng.plan.fresh) eng.rounds = eng.rounds.slice(0, eng.done.length + 1);
  $('#engRounds').textContent = eng.done.length;
  engineDrawRound();
}
function engineToggleCues() {
  if (!eng) return;
  eng.cues = !eng.cues;
  $('#engCues').textContent = eng.cues ? 'HIDE CUES' : 'CUES';
  engineDrawRound();
}
function enginePause() {
  if (!eng) return;
  const ov = $('#engineOverlay');
  if (eng.pausedAt == null) {
    eng.pausedAt = Date.now();
    ov.dataset.paused = '1';
    $('#engPause').textContent = 'RESUME';
    $('#engPhase').hidden = false;
    $('#engPhase').textContent = 'PAUSED';
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* fine */ }
  } else {
    eng.pausedTotal += Date.now() - eng.pausedAt;
    eng.pausedAt = null;
    ov.removeAttribute('data-paused');
    $('#engPause').textContent = 'PAUSE';
    if (eng.seg) engineEnterSeg(eng.seg);
    engineTick();
  }
}
function engineMute() {
  const cfg = engineCfg();
  const on = cfg.sound || cfg.voice;
  cfg.sound = !on; cfg.voice = !on;
  save();
  $('#engMute').textContent = on ? 'UNMUTE' : 'MUTE';
  if (!on) beep([660], 0.07);
  else { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* fine */ } }
}
function engineStopHold() {
  if (!eng || !eng.seg || eng.seg.kind !== 'max') return;
  engineDone(Math.max(0, Math.round(engineElapsed() - eng.seg.start)));
}
function engineQuit() {
  if (!eng) { engineExit(); return; }
  if (eng.done.length > 0) { engineDone(0); return; }
  const btn = $('#engEnd');
  if (engEndArmed) { clearTimeout(engEndArmed); engEndArmed = null; engineExit(); return; }
  if (btn) btn.textContent = 'TAP AGAIN';
  engEndArmed = setTimeout(() => { engEndArmed = null; if (btn) btn.textContent = 'END'; }, 3000);
}
function engineExit() {
  clearInterval(engTicker); engTicker = null;
  clearTimeout(engEndArmed); engEndArmed = null;
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* fine */ }
  releaseWakeLock();
  eng = null; engResult = null;
  const ov = $('#engineOverlay');
  ov.hidden = true;
  ov.removeAttribute('data-paused');
  document.body.style.overflow = '';
}

/* ---------- log the score ---------- */

function engineTotals(doneIds, extra) {
  let reps = extra || 0, secs = 0;
  for (const ids of doneIds) {
    for (const id of ids) {
      const m = engineMoveById(id);
      if (!m) continue;
      reps += m.reps; secs += m.secs;
    }
  }
  return { reps, secs };
}

function engineDone(holdSecs) {
  clearInterval(engTicker); engTicker = null;
  releaseWakeLock();
  if (engineCfg().sound) beep([880, 1174.7, 1568], 0.11, 0.3);
  buzz([200, 90, 200]);
  engResult = { done: eng.done.slice(), extra: 0, hold: holdSecs || 0, plan: eng.plan };
  $('#engineOverlay').dataset.phase = 'done';
  engineRenderDone();
}

function engineRenderDone() {
  const r = engResult;
  const rounds = r.done.length;
  const tot = engineTotals(r.done, r.extra);
  const best = engineBest(engineSig(r.plan.cfg, r.plan.rotation));
  const beat = best && (rounds > best.rounds || (rounds === best.rounds && r.extra > best.extra));
  const seen = [];
  for (const ids of r.done) for (const id of ids) if (!seen.includes(id)) seen.push(id);
  $('#engineInner').innerHTML = `
    <div class="focus-head">
      <div class="focus-title mono">DAY E · ENGINE · ${r.plan.cfg.mins} MIN</div>
    </div>
    <div class="eng-stage" style="justify-content:flex-start;padding-top:22px">
      <div class="eng-kicker mono">TIME</div>
      <div class="eng-phase" style="color:var(--pass)">${rounds} ROUND${rounds === 1 ? '' : 'S'}</div>
      <p class="eng-cue">${seen.length} different movement${seen.length === 1 ? '' : 's'} through the rotation.
        Fix the count if you missed a tap, then add the reps you got in the round you were part-way through.</p>
      <div class="eng-log">
        <div class="eng-log-row">
          <span class="name">Rounds<small>every movement on the list</small></span>
          <span class="eng-stepper">
            <button class="eng-step" onclick="engineResAdj('rounds',-1)">−</button>
            <output id="engResRounds">${rounds}</output>
            <button class="eng-step" onclick="engineResAdj('rounds',1)">+</button>
          </span>
        </div>
        <div class="eng-log-row">
          <span class="name">Extra reps<small>the part-round when time ran out</small></span>
          <span class="eng-stepper">
            <button class="eng-step" onclick="engineResAdj('extra',-1)">−</button>
            <output id="engResExtra">${r.extra}</output>
            <button class="eng-step" onclick="engineResAdj('extra',1)">+</button>
          </span>
        </div>
        ${r.plan.cfg.finisher ? `<div class="eng-log-row">
          <span class="name">Finisher hold<small>max hollow hold</small></span>
          <span class="eng-stepper"><output>${r.hold ? `${r.hold}s` : '—'}</output></span>
        </div>` : ''}
        <div class="eng-total mono" id="engResTotal">
          ${tot.reps} REPS BANKED${tot.secs || r.plan.coreSecs ? ` · ${tot.secs + r.plan.coreSecs + r.hold}s HELD` : ''}
        </div>
        ${beat ? `<div class="eng-pr mono" style="padding-top:6px">▲ NEW BEST — PREVIOUS ${best.rounds} ROUND${best.rounds === 1 ? '' : 'S'}${best.extra ? ` + ${best.extra}` : ''}</div>` : ''}
      </div>
    </div>
    <div class="eng-bottom">
      <button class="eng-stop" onclick="engineBank()">BANK IT</button>
      <div class="eng-controls" style="grid-template-columns:1fr">
        <button class="btn ghost small" onclick="engineExit()">DISCARD</button>
      </div>
    </div>`;
}

function engineResAdj(k, d) {
  if (!engResult) return;
  const r = engResult;
  if (k === 'extra') r.extra = Math.max(0, Math.min(60, r.extra + d));
  else {
    if (d < 0) r.done.pop();
    else {
      const rot = r.plan.rotation;
      const next = rot[r.done.length % rot.length] || rot[0];
      r.done.push(next.map(m => m.id));
    }
  }
  engineRenderDone();
}

function engineBank() {
  const r = engResult;
  if (!r) return;
  const rounds = r.done.length;
  const tot = engineTotals(r.done, r.extra);
  const reps = tot.reps;
  const holds = tot.secs + r.plan.coreSecs + r.hold;
  const sets = r.done.reduce((n, ids) => n + ids.length, 0);
  const date = todayStr();
  const sig = engineSig(r.plan.cfg, r.plan.rotation);
  const best = engineBest(sig);
  const beat = best && (rounds > best.rounds || (rounds === best.rounds && r.extra > best.extra));
  const names = [];
  for (const ids of r.done) for (const id of ids) {
    const m = engineMoveById(id);
    if (m && !names.includes(m.name)) names.push(m.name);
  }

  const prev = state.sessions[date];
  if (prev && !prev.express) {
    // already trained today — fold the express work into that entry
    prev.sets = (prev.sets || 0) + sets;
    prev.reps = (prev.reps || 0) + reps;
    prev.holds = (prev.holds || 0) + holds;
    prev.engine = { rounds, extra: r.extra, mins: r.plan.cfg.mins };
  } else {
    state.sessions[date] = {
      day: 'E', express: true, deload: deloadActive(),
      sets, reps, holds, adv: [], part: [], skip: 0,
      engine: { rounds, extra: r.extra, mins: r.plan.cfg.mins },
    };
  }
  state.expressCount = (state.expressCount || 0) + 1;
  state.lastSessionAt = Date.now();
  state.engine.scores.unshift({
    d: Date.now(), sig, mins: r.plan.cfg.mins, rounds, extra: r.extra,
    hold: r.hold, reps, moves: `${names.length} movements`,
  });
  state.engine.scores = state.engine.scores.slice(0, 30);
  save();

  engineExit();
  showEngineReport({ ...r, rounds, reps, holds, sets, names, beat, best });
  setView('today');
}

function showEngineReport(r) {
  $('#reportTitle').textContent = `Day E · ENGINE · ${r.plan.cfg.mins} min`;
  $('#reportStats').innerHTML = `
    <div class="rstat"><b>${r.rounds}${r.extra ? '+' : ''}</b><span>rounds</span></div>
    <div class="rstat"><b>${r.reps}</b><span>reps</span></div>
    <div class="rstat"><b>${r.holds}s</b><span>holds</span></div>`;
  $('#reportLists').innerHTML = `
    <div class="rrow"><span class="rlabel pass">MOVEMENTS</span><div>
      ${r.names.slice(0, 12).map(n => `<span class="rchip pass">${n}</span>`).join('')}
    </div></div>
    ${r.hold ? `<div class="rrow"><span class="rlabel hold">FINISHER</span><div>
      <span class="rchip hold">${r.hold}s hollow hold</span></div></div>` : ''}`;
  $('#reportNote').textContent = r.beat
    ? `New best on this rotation — ${r.best.rounds} rounds beaten. Same movements, same clock, more work: that is the only honest comparison there is.`
    : r.best
    ? `Your best on this rotation is ${r.best.rounds} round${r.best.rounds === 1 ? '' : 's'}${r.best.extra ? ` + ${r.best.extra}` : ''}. Streak intact — targets are untouched, so Day A picks up exactly where it left off.`
    : 'Banked. Your streak survives the week, and this is now the score to beat. Targets are untouched — Day A picks up exactly where it left off.';
  $('#reportOverlay').hidden = false;
  if (r.beat) { confetti(); beep([880, 1174.7, 1568], 0.12); }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && eng) acquireWakeLock();
});

/* ---------- boot ---------- */

function storageAvailable() {
  try {
    localStorage.setItem('__ironpath_probe', '1');
    localStorage.removeItem('__ironpath_probe');
    return true;
  } catch { return false; }
}

(async function boot() {
  await load();
  if (!storageAvailable()) {
    setTimeout(() => toast('⚠ This browser is blocking storage — progress will NOT survive closing this page.'), 800);
  }
  // ask the browser to exempt our data from storage-pressure eviction
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  $$('.rail-link').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#testCancel').addEventListener('click', () => { $('#testOverlay').hidden = true; });
  $('#testPass').addEventListener('click', passTest);
  $('#celebrateClose').addEventListener('click', () => { $('#celebrateOverlay').hidden = true; render(); });
  $('#celebrateShare').addEventListener('click', shareFromCelebrate);
  $('#restSkip').addEventListener('click', () => { clearInterval(restInterval); $('#restDock').hidden = true; });
  $('#reportClose').addEventListener('click', () => { $('#reportOverlay').hidden = true; render(); });
  $('#importFile').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImportFile(e.target.files[0]);
    e.target.value = '';
  });
  if (!state.disclaimerOk) $('#disclaimerOverlay').hidden = false;
  $('#disclaimerAccept').addEventListener('click', () => {
    state.disclaimerOk = todayStr();
    save();
    $('#disclaimerOverlay').hidden = true;
  });
  activeView = ['today', 'train', 'ladders', 'roadmap', 'recover'].includes(state.view) ? state.view : 'today';
  $$('.rail-link').forEach(b => b.classList.toggle('active', b.dataset.view === activeView));
  render();
  save();
})();
