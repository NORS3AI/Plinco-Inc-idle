(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const goldDisplay = document.getElementById('goldDisplay');
  const menuBtn = document.getElementById('menuBtn');
  const overlay = document.getElementById('overlay');
  const closeBtn = document.getElementById('closeBtn');
  const upgradeList = document.getElementById('upgradeList');

  // ---- Layout ----
  const COIN = { x: W / 2, y: 64, r: 30 };
  const BAR  = { x: (W - 200) / 2, y: COIN.y + COIN.r + 18, w: 200, h: 10 };

  const PEG_R = 7;
  const CONTENT_TOP = 150;       // first peg row never goes above this
  const CONTENT_BOTTOM = H - 14; // floor never goes below this
  const CHAMBER_H = 35;          // short slot
  const GAP_TO_SLOT = 28;        // distance from last peg row to slot
  const PREFERRED_GAP = 78;      // ideal vertical spacing between peg rows

  let LO = null;                 // current frame's board layout

  const BALL_R = 8;
  const GRAVITY = 700;
  const RESTITUTION = 0.55;
  const BASE_RECHARGE_S = 3.0;
  const QUEUE_INTERVAL_MS = 1000;

  // ---- State ----
  const defaultUpg = () => ({
    chamberValue: 0,
    crit: 0,
    recharge: 0,
    queue: 0,
    rows: 0,        // 0..8  -> board rows = 2 + rows  (max 10)
    autoDrop: 0,
    ballGold: 0,
    ballGreen: 0,
    ballBlue: 0,
    ballRed: 0,
    ballOrange: 0,
    ballPink: 0,
    ballRainbow: 0,
  });

  const state = {
    gold: 0,
    maxGold: 0,
    cooldown: 0,
    balls: [],
    floaters: [],
    queue: 0,
    queueTimer: 0,
    upg: defaultUpg(),
  };

  // ---- Board geometry (dynamic) ----
  function rowsCount()    { return 2 + state.upg.rows; }       // 2..10
  function chamberCount() { return 2 * rowsCount() + 1; }      // 5..21
  function chamberW()     { return W / chamberCount(); }

  function chamberMultiplier() { return state.upg.chamberValue >= 1 ? 2 : 1; }

  function chamberValues() {
    const R = rowsCount();
    const m = chamberMultiplier();
    const n = chamberCount();
    const arr = [];
    // Center is worth the most, outer edges the least: 1>2>3<2<1 etc.
    for (let i = 0; i < n; i++) arr.push(m * ((R + 1) - Math.abs(i - R)));
    return arr;
  }

  // Lay out the peg rows + slot. The slot always sits GAP_TO_SLOT below the
  // last peg row, whatever the row count. Compact boards are centered in the
  // available space; tall boards compress to fit.
  function computeLayout() {
    const R = rowsCount();
    const cw = chamberW();
    const spacing = 2 * cw;
    const avail = CONTENT_BOTTOM - CONTENT_TOP;
    const tail = GAP_TO_SLOT + CHAMBER_H;

    let gap, startY;
    if (R > 1) {
      const neededPref = (R - 1) * PREFERRED_GAP + tail;
      if (neededPref <= avail) {
        gap = PREFERRED_GAP;
        startY = CONTENT_TOP + (avail - neededPref) / 2;
      } else {
        gap = (avail - tail) / (R - 1);
        startY = CONTENT_TOP;
      }
    } else {
      gap = 0;
      startY = CONTENT_TOP + (avail - tail) / 2;
    }

    const pegs = [];
    for (let k = 1; k <= R; k++) {
      const y = startY + (k - 1) * gap;
      for (let j = 0; j < k; j++) {
        pegs.push({ x: W / 2 + (j - (k - 1) / 2) * spacing, y });
      }
    }

    const lastRowY = startY + (R - 1) * gap;
    const chamberTop = lastRowY + GAP_TO_SLOT;
    return {
      pegs,
      chamberTop,
      floorY: chamberTop + CHAMBER_H,
      cw,
      n: chamberCount(),
      values: chamberValues(),
    };
  }

  // ---- Colored balls (independent rolls, highest tier wins) ----
  const BALL_TIERS = [
    { id: 'ballGold',    name: 'Gold',    mult: 2,  chance: 0.20, color: '#f5c842' },
    { id: 'ballGreen',   name: 'Green',   mult: 5,  chance: 0.15, color: '#4fdc6a' },
    { id: 'ballBlue',    name: 'Blue',    mult: 8,  chance: 0.12, color: '#4f9fff' },
    { id: 'ballRed',     name: 'Red',     mult: 12, chance: 0.10, color: '#ff5a5a' },
    { id: 'ballOrange',  name: 'Orange',  mult: 15, chance: 0.07, color: '#ff9b3d' },
    { id: 'ballPink',    name: 'Pink',    mult: 20, chance: 0.05, color: '#ff7ad9' },
    { id: 'ballRainbow', name: 'Rainbow', mult: 25, chance: 0.02, color: 'rainbow' },
  ];

  function rollBall() {
    let best = { mult: 1, color: 'white' };
    for (const t of BALL_TIERS) {
      if (state.upg[t.id] >= 1 && Math.random() < t.chance) {
        if (t.mult > best.mult) best = { mult: t.mult, color: t.color };
      }
    }
    return best;
  }

  // ---- Upgrade math ----
  function critChance() { return state.upg.crit * 0.01; }
  function critCost(level) {
    let c = 50;
    for (let i = 0; i < level; i++) {
      if (c < 100) c += 10;
      else if (c < 1000) c += 50;
      else c += 250;
    }
    return c;
  }

  const RECHARGE_MAX_LEVEL = 14;
  function rechargeSeconds() {
    const L = state.upg.recharge;
    if (L <= 0) return BASE_RECHARGE_S;
    return Math.max(0.1, BASE_RECHARGE_S - 0.3 - 0.2 * (L - 1));
  }
  function rechargeCost(level) { return 250 + 500 * level; }
  function cooldownMs() { return rechargeSeconds() * 1000; }

  const QUEUE_MAX_LEVEL = 10;
  const ROWS_MAX_LEVEL = 8; // board rows 2..10

  // ---- Persistence ----
  const SAVE_KEY = 'plinco-inc-save-v1';
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        gold: state.gold,
        maxGold: state.maxGold,
        upg: state.upg,
      }));
    } catch {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!s) return;
      if (typeof s.gold === 'number') state.gold = s.gold;
      state.maxGold = typeof s.maxGold === 'number' ? s.maxGold : state.gold;
      if (s.upg) Object.assign(state.upg, s.upg);
    } catch {}
  }
  load();

  function addGold(n) {
    state.gold += n;
    if (state.gold > state.maxGold) state.maxGold = state.gold;
    save();
  }

  // ---- Upgrade definitions ----
  function ballUpg(tier) {
    return {
      id: tier.id,
      name: tier.name + ' Balls',
      unlockAt: tier.unlockAt,
      maxLevel: 1,
      level: () => state.upg[tier.id],
      cost: () => tier.cost,
      desc: () => state.upg[tier.id] >= 1
        ? `${tier.name} balls active — ${tier.chance * 100}% spawn, x${tier.mult} in a chamber.`
        : `${tier.chance * 100}% chance to drop a ${tier.name.toLowerCase()} ball worth x${tier.mult}.`,
      buy() { state.upg[tier.id] = 1; },
    };
  }

  // attach economy data to tiers
  const TIER_ECON = {
    ballGold:    { cost: 1000,          unlockAt: 800 },
    ballGreen:   { cost: 10000,         unlockAt: 8000 },
    ballBlue:    { cost: 100000,        unlockAt: 80000 },
    ballRed:     { cost: 500000,        unlockAt: 400000 },
    ballOrange:  { cost: 10000000,      unlockAt: 8000000 },
    ballPink:    { cost: 50000000,      unlockAt: 40000000 },
    ballRainbow: { cost: 5000000000,    unlockAt: 3000000000 },
  };
  for (const t of BALL_TIERS) Object.assign(t, TIER_ECON[t.id]);

  const UPGRADES = [
    {
      id: 'chamberValue', name: 'Chamber Value x2', unlockAt: 10, maxLevel: 1,
      level: () => state.upg.chamberValue, cost: () => 10,
      desc: () => state.upg.chamberValue >= 1
        ? 'Chamber payouts doubled.'
        : 'Double every chamber payout (e.g. 1/2/3 → 2/4/6).',
      buy() { state.upg.chamberValue = 1; },
    },
    {
      id: 'crit', name: 'Critical Chance', unlockAt: 30, maxLevel: Infinity,
      level: () => state.upg.crit, cost: () => critCost(state.upg.crit),
      desc: () => `+1% crit chance per level (crit = +10% payout). Now: ${state.upg.crit}%.`,
      buy() { state.upg.crit++; },
    },
    {
      id: 'recharge', name: 'Faster Recharge', unlockAt: 200, maxLevel: RECHARGE_MAX_LEVEL,
      level: () => state.upg.recharge, cost: () => rechargeCost(state.upg.recharge),
      desc: () => `Recharge: ${rechargeSeconds().toFixed(1)}s. −0.3s first level, then −0.2s (min 0.1s).`,
      buy() { state.upg.recharge++; },
    },
    {
      id: 'queue', name: 'Ball Queue', unlockAt: 150, maxLevel: QUEUE_MAX_LEVEL,
      level: () => state.upg.queue, cost: () => 200,
      desc: () => `Bank taps during cooldown (cap ${state.upg.queue}/${QUEUE_MAX_LEVEL}); 1 drops per second.`,
      buy() { state.upg.queue++; },
    },
    {
      id: 'rows', name: 'Add Row', unlockAt: 450, maxLevel: ROWS_MAX_LEVEL,
      level: () => state.upg.rows,
      cost: () => (state.upg.rows === 0 ? 500 : 1000),
      desc: () => {
        const R = rowsCount();
        return `Board: ${R} rows / ${chamberCount()} chambers. +1 row, +2 chambers (max 10 rows).`;
      },
      buy() { state.upg.rows++; },
    },
    {
      id: 'autoDrop', name: 'Auto-Dropper', unlockAt: 2500, maxLevel: 1,
      level: () => state.upg.autoDrop, cost: () => 3000,
      desc: () => state.upg.autoDrop >= 1
        ? 'Balls drop automatically every recharge.'
        : 'Automatically drop a ball each time the coin recharges.',
      buy() { state.upg.autoDrop = 1; },
    },
    ...BALL_TIERS.map(ballUpg),
  ];

  function canBuy(u) { return u.level() < u.maxLevel && state.gold >= u.cost(); }
  function purchase(u) {
    if (!canBuy(u)) return;
    state.gold -= u.cost();
    u.buy();
    save();
    renderPanel();
  }

  // ---- Menu DOM ----
  let panelOpen = false;
  function openPanel() { panelOpen = true; overlay.hidden = false; renderPanel(); }
  function closePanel() { panelOpen = false; overlay.hidden = true; }
  menuBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

  function fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2) + 'M';
    if (n >= 1e4) return Math.round(n).toLocaleString('en-US');
    return Math.round(n).toLocaleString('en-US');
  }

  function renderPanel() {
    if (!panelOpen) return;
    upgradeList.innerHTML = '';
    const visible = UPGRADES.filter(u => state.maxGold >= u.unlockAt);
    if (visible.length === 0) {
      const p = document.createElement('div');
      p.className = 'upg-desc';
      p.style.cssText = 'padding:20px;text-align:center';
      p.textContent = 'Earn more gold to unlock upgrades.';
      upgradeList.appendChild(p);
      return;
    }
    for (const u of visible) {
      const lvl = u.level();
      const maxed = lvl >= u.maxLevel;
      const row = document.createElement('div');
      row.className = 'upg';

      const info = document.createElement('div');
      info.className = 'upg-info';
      const name = document.createElement('div');
      name.className = 'upg-name';
      name.textContent = u.name;
      if (u.maxLevel === Infinity) {
        const ls = document.createElement('span');
        ls.className = 'lvl'; ls.textContent = `Lv ${lvl}`;
        name.appendChild(ls);
      } else if (u.maxLevel > 1) {
        const ls = document.createElement('span');
        ls.className = 'lvl'; ls.textContent = `Lv ${lvl}/${u.maxLevel}`;
        name.appendChild(ls);
      }
      const desc = document.createElement('div');
      desc.className = 'upg-desc';
      desc.textContent = u.desc();
      info.appendChild(name);
      info.appendChild(desc);

      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      if (maxed) {
        btn.classList.add('maxed');
        btn.textContent = u.maxLevel === 1 ? 'OWNED' : 'MAX';
        btn.disabled = true;
      } else {
        btn.textContent = fmt(u.cost()) + 'g';
        btn.disabled = state.gold < u.cost();
        btn.addEventListener('click', () => purchase(u));
      }
      row.appendChild(info);
      row.appendChild(btn);
      upgradeList.appendChild(row);
    }
  }
  setInterval(() => { if (panelOpen) renderPanel(); }, 300);

  // ---- Input ----
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top)  * (H / r.height),
    };
  }
  function tappedCoin(p) {
    const dx = p.x - COIN.x, dy = p.y - COIN.y;
    return dx * dx + dy * dy <= COIN.r * COIN.r;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = canvasPoint(e);
    if (!tappedCoin(p)) return;
    if (state.cooldown <= 0) {
      dropBall();
      state.cooldown = cooldownMs();
    } else if (state.upg.queue > 0 && state.queue < state.upg.queue) {
      state.queue++;
    }
  });

  function dropBall() {
    const t = rollBall();
    state.balls.push({
      x: COIN.x + (Math.random() - 0.5) * 1.5,
      y: COIN.y + COIN.r + BALL_R + 1,
      vx: (Math.random() - 0.5) * 40,
      vy: 0,
      age: 0,
      done: false,
      mult: t.mult,
      color: t.color,
    });
  }

  // ---- Physics ----
  function step(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt * 1000);

    if (state.upg.autoDrop >= 1 && state.cooldown <= 0) {
      dropBall();
      state.cooldown = cooldownMs();
    }

    if (state.upg.queue > 0 && state.queue > 0) {
      state.queueTimer += dt * 1000;
      if (state.queueTimer >= QUEUE_INTERVAL_MS) {
        state.queueTimer -= QUEUE_INTERVAL_MS;
        state.queue--;
        dropBall();
      }
    } else {
      state.queueTimer = 0;
    }

    const { pegs, values, n, cw, chamberTop } = LO;

    for (const b of state.balls) {
      if (b.done) continue;
      b.age += dt;
      b.vy += GRAVITY * dt;
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;

      for (const p of pegs) {
        const dx = b.x - p.x, dy = b.y - p.y;
        const d2 = dx * dx + dy * dy;
        const md = BALL_R + PEG_R;
        if (d2 < md * md && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          b.x = p.x + nx * md;
          b.y = p.y + ny * md;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + RESTITUTION) * vn * nx;
            b.vy -= (1 + RESTITUTION) * vn * ny;
          }
          b.vx += (Math.random() - 0.5) * 60;
        }
      }

      if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx) * RESTITUTION; }
      if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx) * RESTITUTION; }

      // Score the instant the ball enters the slot (or if it ever gets stuck)
      if (!b.done && (b.y + BALL_R >= chamberTop || b.age > 14)) {
        const idx = Math.min(n - 1, Math.max(0, Math.floor(b.x / cw)));
        let value = values[idx] * b.mult;
        const isCrit = Math.random() < critChance();
        if (isCrit) value = Math.ceil(value * 1.1);
        addGold(value);
        state.floaters.push({
          x: idx * cw + cw / 2,
          y: chamberTop - 6,
          text: (isCrit ? 'CRIT +' : '+') + fmt(value) + 'g',
          crit: isCrit,
          color: b.color,
          life: 0,
        });
        b.done = true;
      }
    }

    state.balls = state.balls.filter(b => !b.done);
    for (const f of state.floaters) f.life += dt;
    state.floaters = state.floaters.filter(f => f.life < 1.0);
  }

  // ---- Rendering ----
  function ballFill(x, y, r, color) {
    if (color === 'rainbow') {
      const hue = (x * 2 + performance.now() / 8) % 360;
      const g = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, `hsl(${hue}, 90%, 58%)`);
      return g;
    }
    const g = ctx.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, color === 'white' ? '#7d86b8' : color);
    return g;
  }

  function drawCoin() {
    const ready = state.cooldown <= 0;
    ctx.save();
    if (ready) {
      const glow = ctx.createRadialGradient(COIN.x, COIN.y, COIN.r * 0.4, COIN.x, COIN.y, COIN.r * 1.8);
      glow.addColorStop(0, 'rgba(245, 200, 66, 0.35)');
      glow.addColorStop(1, 'rgba(245, 200, 66, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(COIN.x, COIN.y, COIN.r * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createRadialGradient(COIN.x - 10, COIN.y - 10, 4, COIN.x, COIN.y, COIN.r);
    if (ready) { g.addColorStop(0, '#fff1a8'); g.addColorStop(0.6, '#f5c842'); g.addColorStop(1, '#a87510'); }
    else { g.addColorStop(0, '#6a6f88'); g.addColorStop(1, '#2f334a'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(COIN.x, COIN.y, COIN.r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ready ? '#ffd75a' : '#3a3f5a';
    ctx.stroke();
    ctx.fillStyle = ready ? '#5a3a00' : '#8d92ad';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', COIN.x, COIN.y + 1);
    ctx.restore();
  }

  function drawCooldownBar() {
    const cd = cooldownMs();
    const progress = cd > 0 ? 1 - state.cooldown / cd : 1;
    ctx.save();
    ctx.fillStyle = '#1d2238';
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5); ctx.fill();
    const fillW = Math.max(0, Math.min(BAR.w, BAR.w * progress));
    if (fillW > 0) {
      const fg = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
      if (state.cooldown > 0) { fg.addColorStop(0, '#3a8dff'); fg.addColorStop(1, '#5fb7ff'); }
      else { fg.addColorStop(0, '#2dd06a'); fg.addColorStop(1, '#7ef0a4'); }
      ctx.fillStyle = fg;
      roundRect(ctx, BAR.x, BAR.y, fillW, BAR.h, 5); ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3a4060';
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5); ctx.stroke();

    if (state.upg.queue > 0) {
      const pipR = 4, gap = 12;
      let px = W / 2 - (state.upg.queue * gap) / 2 + gap / 2;
      const py = BAR.y + BAR.h + 14;
      for (let i = 0; i < state.upg.queue; i++) {
        ctx.beginPath(); ctx.arc(px, py, pipR, 0, Math.PI * 2);
        ctx.fillStyle = i < state.queue ? '#f5c842' : '#2a2f4d';
        ctx.fill(); px += gap;
      }
    }
    ctx.restore();
  }

  function drawBoard() {
    const { pegs, n, cw, values, chamberTop, floorY } = LO;
    for (const p of pegs) {
      const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, PEG_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#8a92b8');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#4a517a';
      ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.fillStyle = '#1b2038';
    ctx.fillRect(0, chamberTop, W, CHAMBER_H);
    ctx.fillStyle = '#3a4070';
    ctx.fillRect(0, chamberTop, W, 2);
    for (let i = 1; i < n; i++) ctx.fillRect(i * cw - 1, chamberTop, 2, CHAMBER_H);
    ctx.fillRect(0, floorY, W, 3);

    const R = rowsCount();
    const fs = Math.max(7, Math.min(13, Math.round(cw * 0.42)));
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = chamberTop + CHAMBER_H / 2;
    for (let i = 0; i < n; i++) {
      const cx = i * cw + cw / 2;
      const v = values[i];
      const ratio = (v / chamberMultiplier()) / (R + 1); // 1 center .. low edge
      ctx.fillStyle = ratio > 0.66 ? '#f5c842' : ratio > 0.33 ? '#86d6ff' : '#9aa0c8';
      ctx.fillText(cw >= 34 ? v + 'g' : String(v), cx, cy);
    }
  }

  function drawBalls() {
    for (const b of state.balls) {
      ctx.fillStyle = ballFill(b.x, b.y, BALL_R, b.color);
      ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2c3258';
      ctx.lineWidth = 1; ctx.stroke();
    }
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of state.floaters) {
      const t = f.life;
      const alpha = Math.max(0, 1 - t);
      const dy = -30 * t;
      ctx.font = `bold ${f.crit ? 17 : 15}px system-ui, sans-serif`;
      let col;
      if (f.crit) col = `rgba(255,120,90,${alpha})`;
      else if (f.color && f.color !== 'white' && f.color !== 'rainbow') {
        col = f.color + Math.round(alpha * 255).toString(16).padStart(2, '0');
      } else if (f.color === 'rainbow') {
        col = `hsla(${(f.x * 3) % 360},90%,62%,${alpha})`;
      } else {
        col = `rgba(245,200,66,${alpha})`;
      }
      ctx.fillStyle = col;
      ctx.fillText(f.text, f.x, f.y + dy);
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawCoin();
    drawCooldownBar();
    drawBoard();
    drawBalls();
    drawFloaters();
  }

  function syncHud() {
    goldDisplay.textContent = fmt(state.gold) + 'g';
    menuBtn.hidden = state.maxGold < 10;
  }

  let last = 0;
  function loop(t) {
    if (!last) last = t;
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    LO = computeLayout();
    step(dt);
    render();
    syncHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
