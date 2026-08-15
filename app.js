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
function dayTarget(scheme, target, dayKey) {
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/state', { method: 'POST', body: JSON.stringify(state) }).catch(() => {});
  }, 250);
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
  activeView = v;
  state.view = v;
  $$('.rail-link').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
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

  const heroInner = trainedToday
    ? `<div class="hero-date">${dateLine}</div>
       <h1 class="hero-title">SESSION<br><span class="accent">BANKED.</span></h1>
       <p class="hero-tag">Today's work is done. Protein, water, walk, sleep — the adaptation is happening right now. Next up: Session ${nextDayKey()} · ${DAYS[nextDayKey()].name} in ~48h.</p>
       <div class="hero-actions"><button class="btn ghost" onclick="setView('recover')">RECOVERY PROTOCOL</button></div>`
    : `<div class="hero-date">${dateLine}</div>
       <h1 class="hero-title">SESSION ${dayKey} —<br><span class="accent">${day.name}</span></h1>
       <p class="hero-tag">${day.tagline}</p>
       <div class="hero-actions">
         <button class="btn primary" onclick="setView('train')">START SESSION ▸</button>
         ${readyCount ? `<button class="btn ghost" onclick="setView('ladders')">⚡ ${readyCount} TEST-OUT${readyCount > 1 ? 'S' : ''} READY</button>` : ''}
       </div>`;

  stage.innerHTML = `
    <div class="hero reveal">${heroInner}
      <div class="hero-meta">
        <div class="hm"><b>${state.sessionCount}</b><span>Sessions</span></div>
        <div class="hm"><b>${CHAINS.reduce((s, c) => s + state.chains[c.id].level, 0)}</b><span>Levels passed</span></div>
        <div class="hm"><b>${streak()}</b><span>Streak</span></div>
      </div>
    </div>

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
        return `
        <div class="ring-card reveal" style="animation-delay:${160 + i * 45}ms" onclick="openLadder('${c.id}')">
          ${ready ? '<div class="ready-flag">TEST READY</div>' : ''}
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
    </div>`;
}

/* ---------- TRAIN ---------- */

let trainDay = null;

function renderTrain() {
  if (!trainDay) trainDay = state.activeSession ? state.activeSession.day : nextDayKey();
  const day = DAYS[trainDay];
  // (re)build session log if needed
  if (!state.activeSession || state.activeSession.day !== trainDay) {
    state.activeSession = {
      day: trainDay, date: todayStr(),
      log: Object.fromEntries(CHAINS.map(c => {
        const { level } = currentLevel(c.id);
        return [c.id, new Array(level.scheme.sets).fill(null)];
      })),
      amrap: {},
      mods: {},
    };
    save();
  }
  const ses = state.activeSession;
  if (!ses.mods) ses.mods = {};   // sessions saved before v3
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

    <p class="set-hint reveal" style="animation-delay:100ms">
      TAP a set when done at target · TAP AGAIN to subtract and log what you actually got ·
      ⇄ MOD swaps in an equipment-free equivalent · Short on time? Superset the pairs
      (pull set → rest → legs set), drop to 2 sets before you skip an exercise, and cut core first — never the pairs.
    </p>

    <div class="session-bar reveal" style="animation-delay:120ms">
      <span class="mono" style="font-size:11px;letter-spacing:2px;color:var(--faint)">SESSION</span>
      <div class="track"><div class="fill" style="width:${pct * 100}%"></div></div>
      <span class="pct">${Math.round(pct * 100)}%</span>
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

  const pills = log.map((val, si) => {
    const isAmrap = isTest && si === log.length - 1 && block.id !== 'skill';
    if (isAmrap) {
      const cur = ses.amrap[cid] ?? tgt;
      return `<span class="amrap-ctrl">
        <button class="amrap-btn" onclick="bumpAmrap('${cid}',-1)">−</button>
        <button class="set-pill amrap-pill ${val !== null ? 'logged' : ''}"
          onclick="logSet('${cid}',${si},${restSec},true)"
          title="AMRAP — as many clean reps as possible">${val !== null ? val : cur}·AMRAP</button>
        <button class="amrap-btn" onclick="bumpAmrap('${cid}',1)">+</button>
      </span>`;
    }
    const partial = val !== null && val < tgt;
    return `<button class="set-pill ${val !== null ? 'logged' : ''} ${partial ? 'partial' : ''}"
      onclick="logSet('${cid}',${si},${restSec},false)"
      title="Tap = done at target · tap again = −1 to log what you actually got">${val !== null ? (partial ? '' : '✓ ') + fmtPill(level.scheme, val) : fmtPill(level.scheme, tgt)}</button>`;
  }).join('');

  return `
  <div class="ex-card ${allDone ? 'done' : ''}">
    <div class="ex-top">
      <div>
        <div class="ex-chain">${c.short} · LV ${st.level + 1}/${c.levels.length}${sub ? ' · <span class="mod-flag">MOD</span>' : ''}</div>
        <div class="ex-name">${sub ? sub.name : level.name}</div>
      </div>
      <div class="ex-target">${fmtTarget(level.scheme, tgt)}${st.ready ? ' ⚡' : ''}</div>
    </div>
    <p class="ex-cue">${sub ? sub.cue : level.cue}</p>
    <div class="set-row">
      ${pills}
      ${subs.length ? `<button class="mod-btn ${sub ? 'on' : ''}" onclick="cycleMod('${cid}')"
        title="No equipment? Swap in an equivalent — sets still count, the test-out gate stays on the real exercise">⇄ MOD</button>` : ''}
    </div>
  </div>`;
}

function switchDay(k) {
  // set counts are identical across day types (only targets differ),
  // so logged sets survive a day-type switch untouched
  if (state.activeSession) state.activeSession.day = k;
  trainDay = k;
  renderTrain();
  save();
}

function logSet(cid, si, restSec, isAmrap) {
  const ses = state.activeSession;
  const st = state.chains[cid];
  const { level } = currentLevel(cid);
  const tgt = dayTarget(level.scheme, st.target, trainDay);
  const cur = ses.log[cid][si];
  if (isAmrap) {                             // AMRAP has its own +/- — tap just toggles
    ses.log[cid][si] = cur !== null ? null : (ses.amrap[cid] ?? tgt);
    if (ses.log[cid][si] !== null) startRest(restSec);
  } else if (cur === null) {                 // first tap: done at target
    ses.log[cid][si] = tgt;
    startRest(restSec);
  } else {                                   // further taps: −1 each, down to un-logged
    const step = stepFor(level.scheme);
    const nv = cur - step;
    ses.log[cid][si] = nv >= step ? nv : null;
  }
  save();
  renderTrain();
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
  renderTrain();
}

function bumpAmrap(cid, d) {
  const ses = state.activeSession;
  const { level } = currentLevel(cid);
  const st = state.chains[cid];
  const base = ses.amrap[cid] ?? dayTarget(level.scheme, st.target, trainDay);
  ses.amrap[cid] = Math.max(0, base + d * stepFor(level.scheme));
  // if the amrap set is already logged, update its value live
  const li = ses.log[cid].length - 1;
  if (ses.log[cid][li] !== null) ses.log[cid][li] = ses.amrap[cid];
  save();
  renderTrain();
}

function finishSession() {
  const ses = state.activeSession;
  if (!ses) return;
  const doneSets = Object.values(ses.log).reduce((s, a) => s + a.filter(x => x !== null).length, 0);
  if (!doneSets) { toast('Log at least one set before banking the session.'); return; }

  const newlyReady = [];
  for (const c of CHAINS) {
    const st = state.chains[c.id];
    const { level, complete } = currentLevel(c.id);
    if (complete) continue;
    const log = ses.log[c.id];
    const tgt = dayTarget(level.scheme, st.target, ses.day);
    // advance only when every set was logged AT OR ABOVE target —
    // partial sets bank the work but the target waits for you
    const allHit = log.length && log.every(x => x !== null && x >= tgt);
    if (!allHit) continue;
    // overload engine: heavy/test days move the target
    if (ses.day !== 'B') {
      if (st.target < level.scheme.cap) {
        st.target = Math.min(level.scheme.cap, st.target + stepFor(level.scheme));
      } else if (!st.ready) {
        st.ready = true;
        newlyReady.push(c);
      }
      // AMRAP smashing the cap unlocks the gate immediately
      const amrapVal = ses.log[c.id][log.length - 1];
      if (ses.day === 'C' && amrapVal >= level.scheme.cap && st.target >= level.scheme.cap && !st.ready) {
        st.ready = true;
        newlyReady.push(c);
      }
    }
  }

  state.sessions[ses.date] = { day: ses.day };
  state.sessionCount++;
  state.activeSession = null;
  trainDay = null;
  save();

  if (newlyReady.length) {
    celebrate('GATE UNLOCKED', newlyReady.map(c => c.short).join(' + '),
      `Test-out now available in <b>${newlyReady.map(c => c.title).join(', ')}</b> — hit the Ladders tab.`);
  } else {
    toast(`Session ${ses.day} banked. ${doneSets} sets logged — recovery starts now. 🔩`);
  }
  setView('today');
}

/* ---------- LADDERS ---------- */

function openLadder(cid) { ladderChain = cid; setView('ladders'); }

function renderLadders() {
  const c = chainById(ladderChain);
  const st = state.chains[c.id];
  const { complete } = currentLevel(c.id);

  stage.innerHTML = `
    <div class="reveal">
      <div class="kicker">BWF PROGRESSIONS V2 · TEST-OUT GATES</div>
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
  st.passedAt[st.level] = todayStr();
  st.level++;
  st.ready = false;
  const done = st.level >= c.levels.length;
  if (!done) st.target = c.levels[st.level].scheme.start;
  // clear any active-session log row for this chain (set count may differ)
  if (state.activeSession && !done) {
    state.activeSession.log[cid] = new Array(c.levels[st.level].scheme.sets).fill(null);
  }
  save();
  $('#testOverlay').hidden = true;

  if (done) {
    celebrate('CHAIN COMPLETE', c.title.toUpperCase(), 'Every level passed. That is mastery. ✦');
  } else {
    const next = c.levels[st.level];
    celebrate('LEVEL CLEARED', passedName, `Next up: <b>${next.name}</b> · ${fmtTarget(next.scheme, next.scheme.start)} → gate at ${next.test.label}`);
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
    </div>`;
}

/* ---------- CELEBRATION + CONFETTI ---------- */

function celebrate(kicker, name, nextHtml) {
  $('#celebrateKicker').textContent = kicker;
  $('#celebrateName').textContent = name;
  $('#celebrateNext').innerHTML = nextHtml;
  $('#celebrateOverlay').hidden = false;
  confetti();
  beep([880, 1174.7, 1568], 0.12);
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
      beep([880, 1318.5], 0.12);
      toast('Rest over — next set. ⚒️');
      return;
    }
    draw();
  }, 1000);
}

/* ---------- audio + toast ---------- */

let audioCtx = null;
function beep(freqs, dur) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.001, audioCtx.currentTime + i * dur);
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + i * dur + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (i + 1) * dur + 0.05);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * dur);
      o.stop(audioCtx.currentTime + (i + 1) * dur + 0.1);
    });
  } catch { /* audio blocked until first interaction — fine */ }
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

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
  $('#restSkip').addEventListener('click', () => { clearInterval(restInterval); $('#restDock').hidden = true; });
  activeView = ['today', 'train', 'ladders', 'roadmap', 'recover'].includes(state.view) ? state.view : 'today';
  $$('.rail-link').forEach(b => b.classList.toggle('active', b.dataset.view === activeView));
  render();
  save();
})();
