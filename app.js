'use strict';
/* Diwali Quest. Same page, two roles:
   - default URL  -> player (phone)
   - URL + #host  -> presenter (shared screen), unlocked with a PIN
   All state lives in Supabase behind dq_* functions; the page polls them. */

const CFG = {
  url: 'https://wpgdkfdoecohoowwoywx.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwZ2RrZmRvZWNvaG9vd3dveXd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTgxMDYsImV4cCI6MjA5ODc3NDEwNn0.Q382UChw8J5zjXaTgNCvJN4_eh2-HmOQQBDlRjBxm2U',
  voteSecs: 60,
  predictSecs: 45,
};

const LEVELS = [
  { name: 'Gratitude', team: 'Grateful for', result: "We're most grateful for",
    q: "You're having a terrible day. Which one would you NOT want to live without?",
    opts: [['❤️', 'Family & friends'], ['💚', 'Health'], ['🤝', 'People who support me'], ['☕', 'The little comforts'], ['🌱', 'Opportunities to grow']] },
  { name: 'Kindness', team: 'Kind through', result: 'Our kindness superpower',
    q: 'You can give the entire team ONE unlimited superpower. Which one?',
    opts: [['🤝', 'Always ready to help'], ['😂', 'Make anyone laugh'], ['🧠', 'Share knowledge instantly'], ['💛', 'Infinite patience'], ['☕', 'Make meetings disappear']] },
  { name: 'Learning', team: 'Curious about', result: 'Our dream skill',
    q: 'You get a magic button that instantly teaches you ONE thing. What are you choosing?',
    opts: [['🤖', 'Master AI'], ['🗣️', 'Speak any language'], ['🎸', 'Play any instrument'], ['💰', 'Become a financial genius'], ['🍳', 'Become a professional chef'], ['✈️', 'Master something completely unexpected']] },
  { name: 'Joy', team: 'Finds joy in', result: 'Our emergency happiness booster',
    q: 'Emergency! The team needs an instant happiness boost. What are you sending?',
    opts: [['☕', 'Coffee & snacks'], ['🐶', 'Puppies'], ['🎵', 'Music'], ['😂', 'Memes'], ['✈️', 'Vacation tickets'], ['❌', 'A “Meeting Cancelled” notification']] },
  { name: 'New Beginnings', team: 'Looking forward to', result: "We're bringing more",
    q: "You can add ONE thing to the team's next chapter. What are you choosing?",
    opts: [['🧘', 'More peace', 'peace'], ['😂', 'More laughter', 'laughter'], ['✨', 'More growth', 'growth'], ['🌎', 'More adventures', 'adventures'], ['🤝', 'More connection', 'connection'], ['💚', 'More balance', 'balance']] },
];

// Presenter's side-lines, keyed "level-optionIndex". Shown only in the control bar.
const REACTIONS = {
  '3-0': 'Okay, apparently we\'re all preparing for the robot takeover.',
  '4-5': 'I knew it! Apparently we\'ve discovered the true source of team happiness.',
  '5-5': 'I don\'t think HR needs to investigate that answer...',
};

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

async function rpc(name, args = {}) {
  const r = await fetch(`${CFG.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) {
    let m = '';
    try { m = JSON.parse(text).message || ''; } catch (e) { /* not json */ }
    throw new Error(m || 'HTTP ' + r.status);
  }
  return text ? JSON.parse(text) : null;
}

const winnerIdx = (counts) => {
  let best = 0;
  counts.forEach((c, i) => { if (c > counts[best]) best = i; });
  return best;
};
const tiedWith = (counts, w) => counts.map((c, i) => (i !== w && c === counts[w] && c > 0 ? i : -1)).filter((i) => i >= 0);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const short = (lvl, i) => LEVELS[lvl - 1].opts[i][2] || LEVELS[lvl - 1].opts[i][1];

function diya(cls = 'lit', f) {
  const style = f === undefined ? '' : ` style="--f:${f}"`;
  return `<svg class="diya ${cls}"${style} viewBox="0 0 120 100" aria-hidden="true">
    <g class="flame"><path d="M60 4C49 22 44 36 52 46c3 4 13 4 16 0 8-10 3-24-8-42z" fill="#ff9f1c"/><path d="M60 24c-5 9-7 15-3 20 2 2 6 2 8 0 3-5 1-11-5-20z" fill="#fff3d6"/></g>
    <path d="M8 50c4 30 30 46 52 46s48-16 52-46c-18 8-34 10-52 10S26 58 8 50z" fill="#c9791a"/>
    <ellipse cx="60" cy="50" rx="52" ry="9" fill="#ffc65a"/><ellipse cx="60" cy="50" rx="40" ry="5" fill="#6b3309"/>
    <path d="M30 70c8 10 22 16 30 16" stroke="#ffe29a" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round"/></svg>`;
}

/* ---------- sparks and fireworks ---------- */
const fx = { cv: null, ctx: null, ps: [], run: false };
function fxInit() {
  if (fx.cv) return;
  fx.cv = document.createElement('canvas');
  fx.cv.id = 'fx';
  document.body.appendChild(fx.cv);
  fx.ctx = fx.cv.getContext('2d');
  const size = () => { fx.cv.width = innerWidth; fx.cv.height = innerHeight; };
  size();
  addEventListener('resize', size);
}
function fxEmit(x, y, n, o) {
  if (RM) return;
  fxInit();
  for (let i = 0; i < n; i++) {
    const a = o.up ? -Math.PI / 2 + (Math.random() - .5) * 1.1 : Math.random() * Math.PI * 2;
    const sp = (o.up ? 3 + Math.random() * 5 : 1.5 + Math.random() * 6.5);
    fx.ps.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 50 + Math.random() * 40, r: 1.5 + Math.random() * 2.5, c: o.colors[(Math.random() * o.colors.length) | 0] });
  }
  if (!fx.run) { fx.run = true; requestAnimationFrame(fxLoop); }
}
function fxLoop() {
  const { ctx, cv } = fx;
  ctx.clearRect(0, 0, cv.width, cv.height);
  fx.ps = fx.ps.filter((p) => p.life < p.max);
  for (const p of fx.ps) {
    p.life++; p.x += p.vx; p.y += p.vy; p.vy += .09; p.vx *= .99;
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.3); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (fx.ps.length) requestAnimationFrame(fxLoop); else fx.run = false;
}
const GOLD = ['#ffd166', '#ff9f1c', '#fff3d6'];
const FEST = ['#ffd166', '#ff9f1c', '#e8467c', '#fff3d6', '#7aa2ff'];
const spark = (x, y) => fxEmit(x, y, 12, { up: true, colors: GOLD });
const burst = (x, y) => fxEmit(x, y, 110, { colors: FEST });

/* =====================================================================
   PLAYER
   ===================================================================== */
function playerApp() {
  const app = $('#app');
  const ADJ = ['Bright', 'Golden', 'Sparkly', 'Cosmic', 'Merry', 'Glowing', 'Dazzling', 'Radiant', 'Cheerful', 'Festive', 'Lucky', 'Jolly'];
  const NOUN = ['Diya', 'Lantern', 'Sparkler', 'Marigold', 'Rangoli', 'Rocket', 'Jalebi', 'Laddu', 'Ember', 'Flame', 'Firefly', 'Chakri'];
  let pid = store.get('dq_pid');
  if (!pid) { pid = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })); store.set('dq_pid', pid); }
  let alias = store.get('dq_alias');
  if (!alias) { alias = `${ADJ[Math.random() * ADJ.length | 0]} ${NOUN[Math.random() * NOUN.length | 0]} ${10 + (Math.random() * 90 | 0)}`; store.set('dq_alias', alias); }

  let S = null, me = { votes: {}, preds: [], score: null }, key = '', offset = 0, total = CFG.voteSecs, draft = [null, null, null, null, null], online = true, joined = false, polls = 0;

  const left = () => (S && S.ends_at ? (Date.parse(S.ends_at) - (Date.now() + offset)) / 1000 : null);
  const head = (label) => `<div class="phead">${diya('lit')}<span>${esc(label)}</span><span class="who">${esc(alias)}</span></div>`;

  async function ensureJoined() {
    if (joined) return;
    await rpc('dq_join', { p_player: pid, p_alias: alias });
    joined = true;
  }
  async function refreshMe() {
    const m = await rpc('dq_me', { p_player: pid });
    if (m && m.known === false) { joined = false; await ensureJoined(); }
    else if (m) { me = { votes: m.votes || {}, preds: m.preds || [], score: m.score }; if (m.alias) alias = m.alias; }
    if (me.preds.length === 5) draft = me.preds.slice();
  }

  function view() {
    if (!S) return `<div class="wrap center"><div class="bigdiya">${diya('lit')}</div><p class="note">Connecting…</p></div>`;
    const { phase, level } = S;
    if (phase === 'lobby') {
      return `<div class="wrap center">${head('Diwali Quest')}
        <div class="bigdiya">${diya('lit')}</div>
        <h1 class="ptitle">You're in.</h1>
        <p class="pq">Welcome, <b id="myname">${esc(alias)}</b>. We're waiting for the first light. Keep this page open.</p>
        <form class="nameform stitch" id="nameform"><label for="nameinp">Want your name on the big screen?</label>
          <div class="nrow"><input id="nameinp" maxlength="24" autocomplete="off" autocapitalize="words" placeholder="Type your name" value="${store.get('dq_named') ? esc(alias) : ''}"><button class="go" type="submit">Save</button></div>
          <p class="note" id="namemsg">${store.get('dq_named') ? 'Saved. You can change it until we start.' : 'Optional. Otherwise you are a surprise diya.'}</p></form>
        <p class="note" id="players">${S.players} ${S.players === 1 ? 'diya' : 'diyas'} lit so far</p></div>`;
    }
    if (phase === 'voting' && level >= 1 && level <= 5) {
      const L = LEVELS[level - 1], mine = me.votes[String(level)];
      const r = left(), closed = r !== null && r <= -2;
      return `<div class="wrap">${head(`Light ${level} of 5`)}
        <h1 class="ptitle">${esc(L.name)}</h1><p class="pq">${esc(L.q)}</p>
        <div class="opts">${L.opts.map((o, i) => `<button class="opt ${mine === i ? 'sel' : ''}" data-act="vote" data-i="${i}" ${closed ? 'disabled' : ''}><span class="oe">${o[0]}</span><span>${esc(o[1])}</span></button>`).join('')}</div>
        <div class="timer" ${r === null ? 'hidden' : ''}><i id="tbar"></i></div>
        <p class="note ${mine !== undefined ? 'ok' : ''}" id="msg">${closed ? "Time's up. Eyes on the big screen." : mine !== undefined ? 'Locked in. You can change it until time runs out.' : 'Go with your first instinct.'}</p></div>`;
    }
    if (phase === 'predict') {
      const r = left(), closed = r !== null && r <= -2, ready = draft.every((d) => d !== null);
      return `<div class="wrap">${head('Mind reader round')}
        <h1 class="ptitle">What did the team pick?</h1><p class="pq">For each light, guess the answer that got the most votes.</p>
        ${LEVELS.map((L, li) => `<section class="pl stitch"><h3>${li + 1}. ${esc(L.name)}</h3><div class="chips">${L.opts.map((o, i) => `<button class="chip ${draft[li] === i ? 'sel' : ''}" data-act="pred" data-l="${li}" data-i="${i}" ${closed ? 'disabled' : ''}>${o[0]} ${esc(o[1])}</button>`).join('')}</div></section>`).join('')}
        <p class="note ${me.preds.length === 5 ? 'ok' : ''}" id="msg">${me.preds.length === 5 ? 'Predictions locked. Change them any time before the timer ends.' : 'Pick one answer for each light.'}</p>
        <div class="sticky"><button class="go" data-act="submit" id="submit" ${!ready || closed ? 'disabled' : ''}>${me.preds.length === 5 ? 'Update my predictions' : 'Lock in my predictions'}</button></div></div>`;
    }
    if (phase === 'reveal') {
      if (level >= 6) {
        return `<div class="wrap center">${head('Mind reader round')}<div class="bigdiya">${diya('lit')}</div>
          ${me.score === null || me.score === undefined || me.preds.length !== 5
            ? '<h1 class="ptitle">Eyes on the big screen</h1><p class="pq">You skipped the mind reader round this time. The team diya is coming.</p>'
            : `<p class="pq">You read the team's mind</p><div class="score">${me.score} / 5</div><p class="note">Look at the big screen for our team diya.</p>`}</div>`;
      }
      return `<div class="wrap center">${head('The big reveal')}<div class="bigdiya">${diya('lit')}</div><h1 class="ptitle">Eyes on the big screen</h1><p class="pq">The votes are in. Let's see what kind of team we are.</p></div>`;
    }
    return '<div class="wrap center"><p class="note">Waiting for the next step…</p></div>';
  }

  function paint() { app.innerHTML = view(); tickTimer(); }
  function tickTimer() {
    const r = left(), bar = $('#tbar');
    if (bar && r !== null) {
      bar.style.transform = `scaleX(${Math.max(0, Math.min(1, r / total))})`;
      if (r <= -2 && S.phase === 'voting') {
        document.querySelectorAll('.opt').forEach((b) => { b.disabled = true; });
        const m = $('#msg'); if (m) m.textContent = "Time's up. Eyes on the big screen.";
      }
    }
    if (S && S.phase === 'predict' && r !== null && r <= -2) {
      document.querySelectorAll('.chip').forEach((b) => { b.disabled = true; });
      const s = $('#submit'); if (s) s.disabled = true;
    }
  }
  const setMsg = (t, ok) => { const m = $('#msg'); if (m) { m.textContent = t; m.classList.toggle('ok', !!ok); } };

  app.addEventListener('submit', async (e) => {
    if (e.target.id !== 'nameform') return;
    e.preventDefault();
    const v = $('#nameinp').value.replace(/\s+/g, ' ').trim().slice(0, 24);
    const m = $('#namemsg');
    if (!v) { m.textContent = 'Type a name first.'; return; }
    try {
      await rpc('dq_rename', { p_player: pid, p_alias: v });
      alias = v; store.set('dq_alias', v); store.set('dq_named', '1'); joined = true;
      const n = $('#myname'); if (n) n.textContent = v;
      const w = document.querySelector('.phead .who'); if (w) w.textContent = v;
      m.textContent = 'Saved. You can change it until we start.';
    } catch (err) { m.textContent = "Couldn't save. Try again."; }
  });

  app.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled || !S) return;
    if (b.dataset.act === 'vote') {
      const lvl = S.level, i = +b.dataset.i, prev = me.votes[String(lvl)];
      me.votes[String(lvl)] = i;
      document.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', +x.dataset.i === i));
      setMsg('Locked in. You can change it until time runs out.', true);
      try {
        await ensureJoined();
        const ok = await rpc('dq_vote', { p_player: pid, p_level: lvl, p_choice: i });
        if (!ok) throw new Error('closed');
      } catch (err) {
        if (prev === undefined) delete me.votes[String(lvl)]; else me.votes[String(lvl)] = prev;
        document.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', me.votes[String(lvl)] === +x.dataset.i));
        setMsg(err.message === 'closed' ? 'Voting for this light just closed.' : "Couldn't send that. Tap again.", false);
      }
    } else if (b.dataset.act === 'pred') {
      draft[+b.dataset.l] = +b.dataset.i;
      document.querySelectorAll(`.chip[data-l="${b.dataset.l}"]`).forEach((x) => x.classList.toggle('sel', +x.dataset.i === draft[+b.dataset.l]));
      const s = $('#submit'); if (s) s.disabled = !draft.every((d) => d !== null);
    } else if (b.dataset.act === 'submit') {
      b.disabled = true;
      try {
        await ensureJoined();
        const ok = await rpc('dq_predict', { p_player: pid, p_preds: draft });
        if (!ok) throw new Error('closed');
        me.preds = draft.slice();
        b.textContent = 'Update my predictions';
        setMsg('Predictions locked. Change them any time before the timer ends.', true);
      } catch (err) {
        setMsg(err.message === 'closed' ? 'The mind reader round just closed.' : "Couldn't send that. Try again.", false);
      }
      b.disabled = !draft.every((d) => d !== null);
    }
  });

  const netBanner = (on) => {
    if (on === online) return;
    online = on;
    const n = $('#net');
    if (!on && !n) { const d = document.createElement('div'); d.id = 'net'; d.textContent = 'Reconnecting…'; document.body.appendChild(d); }
    if (on && n) n.remove();
  };

  async function poll() {
    try {
      await ensureJoined();
      const s = await rpc('dq_state');
      offset = Date.parse(s.now) - Date.now();
      const k = s.phase + ':' + s.level;
      const changed = k !== key;
      S = s;
      if (changed) {
        key = k;
        if (s.ends_at) total = Math.max(5, left() || CFG.voteSecs);
        await refreshMe();
        paint();
      } else {
        if (s.phase === 'lobby') { const p = $('#players'); if (p) p.textContent = `${s.players} ${s.players === 1 ? 'diya' : 'diyas'} lit so far`; }
        if (++polls % 6 === 0) await refreshMe();
      }
      netBanner(true);
    } catch (e) {
      netBanner(false);
    }
    setTimeout(poll, 1800 + Math.random() * 700);
  }
  setInterval(() => { if (S) tickTimer(); }, 500);
  paint();
  poll();
}

/* =====================================================================
   HOST
   ===================================================================== */
function hostApp() {
  const app = $('#app');
  const savedPin = store.get('dq_pin');

  function gate(msg) {
    app.innerHTML = `<form class="gate stitch" id="gate"><h1 class="ptitle">Presenter</h1><p class="note">Enter the presenter PIN.</p>
      <input id="pin" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Presenter PIN"><p class="err" id="err">${esc(msg || '')}</p>
      <button class="go" type="submit">Open the stage</button></form>`;
    $('#pin').focus();
    $('#gate').addEventListener('submit', async (e) => {
      e.preventDefault();
      const p = $('#pin').value.trim();
      try { if (await rpc('dq_check_pin', { p_pin: p })) { store.set('dq_pin', p); run(p); } else $('#err').textContent = 'That PIN is not right.'; }
      catch (err) { $('#err').textContent = "Can't reach the game. Check the connection."; }
    });
  }

  async function run(pin) {
    app.innerHTML = '<div id="stage"></div><div id="bar"><div id="hint"></div><div class="btns"><button class="btn" data-act="back">◀ Back</button><button class="btn primary" data-act="next" id="nextBtn">Start</button><button class="btn" data-act="sim" id="simBtn">+10 test</button><button class="btn" data-act="reset" id="resetBtn">Reset</button><button class="btn" data-act="hide">Hide (H)</button></div></div>';
    const stage = $('#stage');
    let S = null, key = '', offset = 0, res = null, lb = null, lastVotes = 0, lastPlayers = -1, resetArm = 0, busy = false, shownRes = null;

    const left = () => (S && S.ends_at ? Math.round((Date.parse(S.ends_at) - (Date.now() + offset)) / 1000) : null);
    const url = () => location.origin + location.pathname;
    const qrSvg = () => {
      try { const q = qrcode(0, 'M'); q.addData(url()); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); }
      catch (e) { return ''; }
    };

    const nextState = (s) => {
      if (s.phase === 'lobby') return ['voting', 1, CFG.voteSecs];
      if (s.phase === 'voting') return s.level < 5 ? ['voting', s.level + 1, CFG.voteSecs] : ['predict', 0, CFG.predictSecs];
      if (s.phase === 'predict') return ['reveal', 1, 0];
      if (s.phase === 'reveal') return s.level < 7 ? ['reveal', s.level + 1, 0] : null;
      return null;
    };
    const prevState = (s) => {
      if (s.phase === 'voting') return s.level > 1 ? ['voting', s.level - 1, 0] : ['lobby', 0, 0];
      if (s.phase === 'predict') return ['voting', 5, 0];
      if (s.phase === 'reveal') return s.level > 1 ? ['reveal', s.level - 1, 0] : ['predict', 0, 0];
      return null;
    };
    const nextLabel = (s) => {
      if (s.phase === 'lobby') return 'Start Light 1 ▶';
      if (s.phase === 'voting') return s.level < 5 ? `Next: Light ${s.level + 1} ▶` : 'Open predictions ▶';
      if (s.phase === 'predict') return 'Start the reveal ▶';
      if (s.phase === 'reveal') return s.level < 5 ? `Reveal Light ${s.level + 1} ▶` : s.level === 5 ? 'Mind reader results ▶' : s.level === 6 ? 'Our team diya ▶' : 'The end';
      return 'Next';
    };

    async function go(st) {
      if (!st || busy) return;
      busy = true;
      try { await rpc('dq_set_state', { p_pin: pin, p_phase: st[0], p_level: st[1], p_secs: st[2] }); await tick(); }
      catch (e) { flash('Could not change step: ' + e.message); }
      busy = false;
    }
    function flash(t) { const h = $('#hint'); if (h) h.innerHTML = `<b>${esc(t)}</b>`; }

    function hint(s) {
      let t = '';
      if (s.phase === 'lobby') t = '<b>Say:</b> "Ready, Set, Light! Since Diwali is about light, positivity and new beginnings, you have 60 seconds for 5 mini challenges. Don\'t overthink it. Pick your first instinct." Then show the QR.';
      else if (s.phase === 'voting') t = `<b>Light ${s.level}.</b> Read the question aloud. Voting is hidden on purpose, so the reveal stays a surprise.`;
      else if (s.phase === 'predict') t = '<b>Say:</b> "Before we open the results: what do you think we picked? Guess all five."';
      else if (s.phase === 'reveal' && s.level <= 5) {
        const c = res && res[String(s.level)];
        const w = c && sum(c) > 0 ? winnerIdx(c) : -1;
        t = '<b>Say:</b> "Okay... the votes are in." ' + (REACTIONS[`${s.level}-${w}`] ? `<b>Reaction:</b> "${esc(REACTIONS[`${s.level}-${w}`])}"` : 'React to the winner naturally.');
      } else if (s.level === 6) t = '<b>Say:</b> "Who read the room best?" Keep it light.';
      else if (s.level === 7) t = '<b>Close:</b> "This is officially our Team Light. Five anonymous answers turned into something that describes us. Light doesn\'t have to come from something big. Happy Diwali to everyone celebrating!"';
      $('#hint').innerHTML = t;
    }

    /* ----- views ----- */
    function viewLobby(s) {
      stage.innerHTML = `<div class="lobby"><div class="left"><p class="kick">Monthly meeting · Fun Time</p><h1 class="hero">Light Up Our Team</h1>
        <p class="sub">Five mini challenges. One team diya. Scan to join, no login.</p><p class="count"><b id="pc">${s.players}</b> <span id="pl">${s.players === 1 ? 'diya' : 'diyas'} lit</span></p></div>
        <div class="qrcard">${qrSvg()}<span>${esc(url().replace(/^https?:\/\//, ''))}</span></div></div><div class="pgrid" id="pgrid"></div>`;
      lastPlayers = -1;
      lobbyGrid(s);
    }
    function lobbyGrid(s) {
      if (s.players === lastPlayers) return;
      lastPlayers = s.players;
      const pc = $('#pc'); if (pc) { pc.textContent = s.players; $('#pl').textContent = s.players === 1 ? 'diya lit' : 'diyas lit'; }
      const g = $('#pgrid'); if (!g) return;
      g.innerHTML = Array.from({ length: Math.min(s.players, 80) }, () => diya('lit')).join('');
    }
    function viewVote(s) {
      const L = LEVELS[s.level - 1];
      stage.innerHTML = `<div class="vote"><div class="left"><p class="kick">Light ${s.level} of 5 · ${esc(L.name)}</p><p class="qtext">${esc(L.q)}</p>
        <div class="olist ${L.opts.length > 5 ? '' : 'one'} ">${L.opts.map((o) => `<div class="stitch"><span class="oe">${o[0]}</span><span>${esc(o[1])}</span></div>`).join('')}</div></div>
        <div class="right" id="vr">${diya('fill', 0)}<div class="cd" id="cd">--</div><p class="count"><b id="vc">0</b> <span id="vt">of ${s.players} voted</span></p></div></div>`;
      lastVotes = 0;
      updVote(s);
    }
    function updVote(s) {
      const denom = Math.max(s.players, s.level_votes, 1);
      const d = $('#vr .diya'); if (d) d.style.setProperty('--f', (s.level_votes / denom).toFixed(3));
      const vc = $('#vc'); if (vc) { vc.textContent = s.level_votes; $('#vt').textContent = `of ${s.players} voted`; }
      const r = left(), cd = $('#cd');
      if (cd) { cd.textContent = r === null ? '' : Math.max(0, r); cd.classList.toggle('low', r !== null && r <= 10); }
      if (s.level_votes > lastVotes && d) {
        const b = d.getBoundingClientRect();
        for (let i = 0; i < Math.min(s.level_votes - lastVotes, 6); i++) setTimeout(() => spark(b.left + b.width * (.35 + Math.random() * .3), b.top + b.height * .35), i * 120);
      }
      lastVotes = s.level_votes;
    }
    function viewPredict(s) {
      stage.innerHTML = `<div class="vote"><div class="left"><p class="kick">Mind reader round</p><h1 class="hero">What did we pick?</h1>
        <p class="sub">Guess the winning answer for all five lights. Results open soon.</p>
        <div class="locked">${LEVELS.map((L, i) => `<div class="stitch"><span class="qm">?</span><small>${i + 1}. ${esc(L.name)}</small></div>`).join('')}</div></div>
        <div class="right" id="vr">${diya('fill', 0)}<div class="cd" id="cd">--</div><p class="count"><b id="vc">0</b> <span id="vt">guesses locked</span></p></div></div>`;
      lastVotes = 0;
      updPredict(s);
    }
    function updPredict(s) {
      const denom = Math.max(s.players, s.predictions, 1);
      const d = $('#vr .diya'); if (d) d.style.setProperty('--f', (s.predictions / denom).toFixed(3));
      const vc = $('#vc'); if (vc) vc.textContent = s.predictions;
      const r = left(), cd = $('#cd');
      if (cd) { cd.textContent = r === null ? '' : Math.max(0, r); cd.classList.toggle('low', r !== null && r <= 10); }
      if (s.predictions > lastVotes && d) { const b = d.getBoundingClientRect(); for (let i = 0; i < Math.min(s.predictions - lastVotes, 6); i++) setTimeout(() => spark(b.left + b.width * (.35 + Math.random() * .3), b.top + b.height * .35), i * 120); }
      lastVotes = s.predictions;
    }
    async function viewReveal(s) {
      try { res = await rpc('dq_results'); } catch (e) { /* keep old */ }
      if (s.level <= 5) return viewBars(s);
      if (s.level === 6) { try { lb = await rpc('dq_leaderboard'); } catch (e) { lb = null; } return viewMind(); }
      return viewTeam();
    }
    function viewBars(s) {
      const lvl = s.level, L = LEVELS[lvl - 1], counts = (res && res[String(lvl)]) || L.opts.map(() => 0), tot = sum(counts), max = Math.max(...counts, 1), w = tot > 0 ? winnerIdx(counts) : -1;
      stage.innerHTML = `<div class="reveal"><div><p class="kick">Light ${lvl} of 5 · ${esc(L.name)}</p><p class="rq">${esc(L.q)}</p></div>
        <div class="bars" id="bars">${L.opts.map((o, i) => `<div class="row" data-i="${i}"><span class="bl"><span class="oe">${o[0]}</span><span>${esc(o[1])}</span></span><span class="track"><i style="--w:0"></i></span><span class="bn">0</span></div>`).join('')}</div>
        <div class="verdict stitch" id="verdict"><span class="vl">${esc(L.result)}</span><span class="vv" id="vv"></span><span class="vt" id="vtie"></span></div></div>`;
      const play = (key0) => {
        document.querySelectorAll('#bars .row').forEach((row) => {
          const i = +row.dataset.i;
          setTimeout(() => {
            if (key !== key0) return;
            row.querySelector('i').style.setProperty('--w', ((counts[i] / max) * 100).toFixed(1));
            countUp(row.querySelector('.bn'), counts[i]);
          }, 250 + i * 160);
        });
        setTimeout(() => {
          if (key !== key0) return;
          const bars = $('#bars'); if (!bars) return;
          if (w < 0) { $('#vv').textContent = 'No votes yet'; $('#verdict').classList.add('show'); return; }
          bars.classList.add('done');
          const row = bars.querySelector(`.row[data-i="${w}"]`); row.classList.add('win');
          const o = L.opts[w];
          $('#vv').textContent = `${o[0]} ${lvl === 5 ? short(lvl, w) : o[1]}`;
          const ties = tiedWith(counts, w);
          $('#vtie').textContent = `${counts[w]} of ${tot} votes (${Math.round((counts[w] / tot) * 100)}%)` + (ties.length ? ` · tied with ${ties.map((i) => L.opts[i][1]).join(', ')}` : '');
          $('#verdict').classList.add('show');
          const rb = row.getBoundingClientRect();
          burst(rb.left + rb.width * .5, rb.top);
          setTimeout(() => burst(innerWidth * (.2 + Math.random() * .6), innerHeight * .3), 500);
          hint(S);
        }, 250 + L.opts.length * 160 + 1700);
      };
      play(key);
    }
    function countUp(el, to) {
      if (!el) return;
      if (RM || to === 0) { el.textContent = to; return; }
      const t0 = performance.now();
      const step = (t) => { const p = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1 && el.isConnected) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    function viewMind() {
      const top = (lb && lb.top) || [];
      stage.innerHTML = `<div class="mind"><div><p class="kick">Mind reader round</p><h1 class="hero">Who read the room?</h1>
        <p class="sub">${lb ? `${lb.players} guessed. On average we got ${lb.avg} of 5.` : 'No guesses were locked in.'}</p></div>
        ${top.map((t, i) => `<div class="mrow stitch"><span class="rk">${i + 1}</span><span>${esc(t.alias)}</span><span class="dots">${[0, 1, 2, 3, 4].map((d) => diya(d < t.score ? 'lit' : '')).join('')}</span></div>`).join('')}</div>`;
      if (top.length) setTimeout(() => burst(innerWidth * .5, innerHeight * .35), 400);
    }
    function viewTeam() {
      const win = LEVELS.map((L, i) => { const c = (res && res[String(i + 1)]) || []; return sum(c) > 0 ? winnerIdx(c) : -1; });
      const ang = [-90, -18, 54, 126, 198];
      const pos = ang.map((a) => [50 + 36 * Math.cos((a * Math.PI) / 180), 48 + 34 * Math.sin((a * Math.PI) / 180)]);
      stage.innerHTML = `<div class="team"><svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pos.map((p) => `<line x1="50" y1="48" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}"/>`).join('')}</svg>
        <div class="core">${diya('lit')}<b>OUR TEAM</b></div>
        ${LEVELS.map((L, i) => `<div class="petal stitch" data-i="${i}" style="left:${pos[i][0].toFixed(1)}%;top:${pos[i][1].toFixed(1)}%"><small>${esc(L.team)}</small><span>${win[i] < 0 ? '?' : `${L.opts[win[i]][0]} ${esc(i === 4 ? short(5, win[i]) : L.opts[win[i]][1])}`}</span></div>`).join('')}</div>
        <div class="wish" id="wish">We created our Team Diya. Happy Diwali!</div>`;
      const key0 = key;
      document.querySelectorAll('.petal').forEach((p, i) => setTimeout(() => {
        if (key !== key0) return;
        p.classList.add('in');
        const b = p.getBoundingClientRect(); burst(b.left + b.width / 2, b.top + b.height / 2);
      }, 700 + i * 1100));
      setTimeout(() => { if (key === key0) { const w = $('#wish'); if (w) w.classList.add('in'); burst(innerWidth * .3, innerHeight * .35); burst(innerWidth * .7, innerHeight * .35); } }, 700 + 5 * 1100 + 300);
    }

    async function enter(s) {
      if (s.phase === 'lobby') viewLobby(s);
      else if (s.phase === 'voting') viewVote(s);
      else if (s.phase === 'predict') viewPredict(s);
      else if (s.phase === 'reveal') await viewReveal(s);
      hint(s);
    }

    async function tick() {
      try {
        const s = await rpc('dq_state');
        offset = Date.parse(s.now) - Date.now();
        S = s;
        const k = s.phase + ':' + s.level;
        if (k !== key) { key = k; await enter(s); }
        else if (s.phase === 'lobby') lobbyGrid(s);
        else if (s.phase === 'voting') updVote(s);
        else if (s.phase === 'predict') updPredict(s);
        const nx = nextState(s), nb = $('#nextBtn');
        nb.textContent = nextLabel(s); nb.disabled = !nx;
        $('#simBtn').textContent = s.phase === 'lobby' ? '+10 test players' : s.phase === 'voting' || s.phase === 'predict' ? '+10 test votes' : '+10 test';
        $('#simBtn').disabled = s.phase === 'reveal';
        const net = $('#net'); if (net) net.remove();
      } catch (e) {
        if (!$('#net')) { const d = document.createElement('div'); d.id = 'net'; d.textContent = 'Reconnecting…'; document.body.appendChild(d); }
      }
    }
    (function loop() { tick().finally(() => setTimeout(loop, 1000)); })();

    $('#bar').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b || !S) return;
      const a = b.dataset.act;
      if (a === 'next') go(nextState(S));
      else if (a === 'back') go(prevState(S));
      else if (a === 'hide') document.body.classList.add('nobar');
      else if (a === 'sim') { try { await rpc('dq_sim', { p_pin: pin, p_n: 10 }); tick(); } catch (err) { flash('Test players failed: ' + err.message); } }
      else if (a === 'reset') {
        if (Date.now() - resetArm > 3500) { resetArm = Date.now(); b.textContent = 'Tap again to reset'; setTimeout(() => { b.textContent = 'Reset'; }, 3500); return; }
        resetArm = 0; b.textContent = 'Reset';
        try { await rpc('dq_reset', { p_pin: pin }); key = ''; await tick(); } catch (err) { flash('Reset failed: ' + err.message); }
      }
    });
    addEventListener('keydown', (e) => {
      if (!S || /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(nextState(S)); }
      else if (e.key === 'ArrowLeft') go(prevState(S));
      else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('nobar');
    });
  }

  if (savedPin) rpc('dq_check_pin', { p_pin: savedPin }).then((ok) => (ok ? run(savedPin) : gate())).catch(() => gate());
  else gate();
}

/* ---------- boot ---------- */
(function boot() {
  const start = () => (location.hash === '#host' ? hostApp() : playerApp());
  addEventListener('hashchange', () => location.reload());
  start();
})();
