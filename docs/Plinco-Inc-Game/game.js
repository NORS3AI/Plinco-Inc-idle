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
  const ROW1_Y = 230;
  const ROW2_Y = 330;
  const PEG_SPACING = 70;

  const PEGS = [
    { x: W / 2,               y: ROW1_Y },
    { x: W / 2 - PEG_SPACING, y: ROW2_Y },
    { x: W / 2 + PEG_SPACING, y: ROW2_Y },
  ];

  const CHAMBER_COUNT = 5;
  const BASE_CHAMBER_VALUES = [3, 2, 1, 2, 3];
  const CHAMBER_W = W / CHAMBER_COUNT;
  const CHAMBER_TOP = 430;
  const FLOOR_Y = H - 30;

  const BALL_R = 8;
  const GRAVITY = 700;
  const RESTITUTION = 0.55;
  const BASE_RECHARGE_S = 3.0;
  const QUEUE_INTERVAL_MS = 1000;

  // ---- State ----
  const defaultState = () => ({
    gold: 0,
    maxGold: 0,
    cooldown: 0,
    balls: [],
    floaters: [],
    queue: 0,
    queueTimer: 0,
    upg: {
      chamberValue: 0, // 0/1
      crit: 0,
      recharge: 0,
      queue: 0,
      autoDrop: 0,
    },
  });
  const state = defaultState();

  // ---- Upgrade math ----
  function chamberMultiplier() {
    return state.upg.chamberValue >= 1 ? 2 : 1;
  }
  function chamberValues() {
    const m = chamberMultiplier();
    return BASE_CHAMBER_VALUES.map(v => v * m);
  }

  function critChance() {
    return state.upg.crit * 0.01;
  }
  function critCost(level) {
    let c = 50;
    for (let i = 0; i < level; i++) {
      if (c < 100) c += 10;
      else if (c < 1000) c += 50;
      else c += 250;
    }
    return c;
  }

  const RECHARGE_MAX_LEVEL = 14; // brings 3.0s down to 0.1s
  function rechargeSeconds() {
    const L = state.upg.recharge;
    if (L <= 0) return BASE_RECHARGE_S;
    const t = BASE_RECHARGE_S - 0.3 - 0.2 * (L - 1);
    return Math.max(0.1, t);
  }
  function rechargeCost(level) {
    return 250 + 500 * level;
  }

  const QUEUE_MAX_LEVEL = 10;
  function queueCost() { return 200; }

  function cooldownMs() { return rechargeSeconds() * 1000; }

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
      if (typeof s.maxGold === 'number') state.maxGold = s.maxGold;
      else state.maxGold = state.gold;
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
  const UPGRADES = [
    {
      id: 'chamberValue',
      name: 'Chamber Value x2',
      unlockAt: 10,
      maxLevel: 1,
      level: () => state.upg.chamberValue,
      cost: () => 10,
      desc: () => state.upg.chamberValue >= 1
        ? 'Chamber payouts doubled (2 / 4 / 6).'
        : 'Double every chamber payout: 1/2/3 → 2/4/6.',
      buy() { state.upg.chamberValue = 1; },
    },
    {
      id: 'crit',
      name: 'Critical Chance',
      unlockAt: 30,
      maxLevel: Infinity,
      level: () => state.upg.crit,
      cost: () => critCost(state.upg.crit),
      desc: () => `Each level: +1% chance for a ball to crit (+10% payout). Now: ${state.upg.crit}%.`,
      buy() { state.upg.crit++; },
    },
    {
      id: 'recharge',
      name: 'Faster Recharge',
      unlockAt: 200,
      maxLevel: RECHARGE_MAX_LEVEL,
      level: () => state.upg.recharge,
      cost: () => rechargeCost(state.upg.recharge),
      desc: () => `Recharge: ${rechargeSeconds().toFixed(1)}s. First level −0.3s, then −0.2s each (min 0.1s).`,
      buy() { state.upg.recharge++; },
    },
    {
      id: 'queue',
      name: 'Ball Queue',
      unlockAt: 150,
      maxLevel: QUEUE_MAX_LEVEL,
      level: () => state.upg.queue,
      cost: () => queueCost(),
      desc: () => `Store taps in a queue (cap ${state.upg.queue}/${QUEUE_MAX_LEVEL}); one queued ball drops every second.`,
      buy() { state.upg.queue++; },
    },
    {
      id: 'autoDrop',
      name: 'Auto-Dropper',
      unlockAt: 2500,
      maxLevel: 1,
      level: () => state.upg.autoDrop,
      cost: () => 3000,
      desc: () => state.upg.autoDrop >= 1
        ? 'Balls drop automatically every recharge.'
        : 'Automatically drop a ball each time the coin recharges.',
      buy() { state.upg.autoDrop = 1; },
    },
  ];

  function canBuy(u) {
    return u.level() < u.maxLevel && state.gold >= u.cost();
  }
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
    return n.toLocaleString('en-US');
  }

  function renderPanel() {
    if (!panelOpen) return;
    upgradeList.innerHTML = '';
    const visible = UPGRADES.filter(u => state.maxGold >= u.unlockAt);
    if (visible.length === 0) {
      const p = document.createElement('div');
      p.className = 'upg-desc';
      p.style.padding = '20px';
      p.style.textAlign = 'center';
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
      if (u.maxLevel !== 1 && u.maxLevel !== Infinity) {
        const ls = document.createElement('span');
        ls.className = 'lvl';
        ls.textContent = `Lv ${lvl}/${u.maxLevel}`;
        name.appendChild(ls);
      } else if (u.maxLevel === Infinity) {
        const ls = document.createElement('span');
        ls.className = 'lvl';
        ls.textContent = `Lv ${lvl}`;
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
        btn.textContent = 'MAX';
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

  // periodic refresh so affordability updates while panel is open
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
    const dx = p.x - COIN.x;
    const dy = p.y - COIN.y;
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
    state.balls.push({
      x: COIN.x + (Math.random() - 0.5) * 1.5,
      y: COIN.y + COIN.r + BALL_R + 1,
      vx: (Math.random() - 0.5) * 40,
      vy: 0,
      age: 0,
      resting: 0,
      done: false,
    });
  }

  // ---- Physics ----
  function step(dt) {
    if (state.cooldown > 0) {
      state.cooldown = Math.max(0, state.cooldown - dt * 1000);
    }

    // Auto-dropper
    if (state.upg.autoDrop >= 1 && state.cooldown <= 0) {
      dropBall();
      state.cooldown = cooldownMs();
    }

    // Queue release (one per second)
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

    const values = chamberValues();

    for (const b of state.balls) {
      if (b.done) continue;
      b.age += dt;

      b.vy += GRAVITY * dt;
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;

      for (const p of PEGS) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
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

      if (b.y + BALL_R > CHAMBER_TOP) {
        for (let i = 1; i < CHAMBER_COUNT; i++) {
          const wx = i * CHAMBER_W;
          const dx = b.x - wx;
          if (Math.abs(dx) < BALL_R) {
            if (dx < 0) { b.x = wx - BALL_R; b.vx = -Math.abs(b.vx) * RESTITUTION; }
            else        { b.x = wx + BALL_R; b.vx = Math.abs(b.vx) * RESTITUTION; }
          }
        }
      }

      if (b.y + BALL_R >= FLOOR_Y) {
        b.y = FLOOR_Y - BALL_R;
        if (b.vy > 50) {
          b.vy = -b.vy * RESTITUTION;
          b.vx *= 0.7;
        } else {
          b.vy = 0;
          b.vx *= 0.85;
          b.resting += dt;
        }
      } else {
        b.resting = 0;
      }

      if (b.resting > 0.25 && !b.done) {
        const idx = Math.min(CHAMBER_COUNT - 1, Math.max(0, Math.floor(b.x / CHAMBER_W)));
        let value = values[idx];
        const isCrit = Math.random() < critChance();
        if (isCrit) value = Math.ceil(value * 1.1);
        addGold(value);
        state.floaters.push({
          x: idx * CHAMBER_W + CHAMBER_W / 2,
          y: CHAMBER_TOP + 20,
          text: (isCrit ? 'CRIT +' : '+') + value + 'g',
          crit: isCrit,
          life: 0,
        });
        b.done = true;
      }

      if (b.age > 12 && !b.done) b.done = true;
    }

    state.balls = state.balls.filter(b => !b.done);

    for (const f of state.floaters) f.life += dt;
    state.floaters = state.floaters.filter(f => f.life < 1.0);
  }

  // ---- Rendering ----
  function drawCoin() {
    const ready = state.cooldown <= 0;
    ctx.save();
    if (ready) {
      const glow = ctx.createRadialGradient(COIN.x, COIN.y, COIN.r * 0.4, COIN.x, COIN.y, COIN.r * 1.8);
      glow.addColorStop(0, 'rgba(245, 200, 66, 0.35)');
      glow.addColorStop(1, 'rgba(245, 200, 66, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(COIN.x, COIN.y, COIN.r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(COIN.x - 10, COIN.y - 10, 4, COIN.x, COIN.y, COIN.r);
    if (ready) {
      g.addColorStop(0, '#fff1a8');
      g.addColorStop(0.6, '#f5c842');
      g.addColorStop(1, '#a87510');
    } else {
      g.addColorStop(0, '#6a6f88');
      g.addColorStop(1, '#2f334a');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(COIN.x, COIN.y, COIN.r, 0, Math.PI * 2);
    ctx.fill();
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
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5);
    ctx.fill();
    const fillW = Math.max(0, Math.min(BAR.w, BAR.w * progress));
    if (fillW > 0) {
      const fg = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
      if (state.cooldown > 0) { fg.addColorStop(0, '#3a8dff'); fg.addColorStop(1, '#5fb7ff'); }
      else { fg.addColorStop(0, '#2dd06a'); fg.addColorStop(1, '#7ef0a4'); }
      ctx.fillStyle = fg;
      roundRect(ctx, BAR.x, BAR.y, fillW, BAR.h, 5);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3a4060';
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5);
    ctx.stroke();

    // Queue pips
    if (state.upg.queue > 0) {
      const pipR = 4, gap = 12;
      const total = state.upg.queue * gap;
      let px = W / 2 - total / 2 + gap / 2;
      const py = BAR.y + BAR.h + 14;
      for (let i = 0; i < state.upg.queue; i++) {
        ctx.beginPath();
        ctx.arc(px, py, pipR, 0, Math.PI * 2);
        ctx.fillStyle = i < state.queue ? '#f5c842' : '#2a2f4d';
        ctx.fill();
        px += gap;
      }
    }
    ctx.restore();
  }

  function drawBoard() {
    for (const p of PEGS) {
      const g = ctx.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, PEG_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#8a92b8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4a517a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = '#3a4070';
    for (let i = 1; i < CHAMBER_COUNT; i++) {
      ctx.fillRect(i * CHAMBER_W - 1.5, CHAMBER_TOP, 3, FLOOR_Y - CHAMBER_TOP);
    }
    ctx.fillRect(0, FLOOR_Y, W, 3);

    const values = chamberValues();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < CHAMBER_COUNT; i++) {
      const cx = i * CHAMBER_W + CHAMBER_W / 2;
      const cy = (CHAMBER_TOP + FLOOR_Y) / 2 + 38;
      const v = values[i];
      const base = BASE_CHAMBER_VALUES[i];
      const pillW = 48, pillH = 22;
      ctx.fillStyle = '#0d1022';
      roundRect(ctx, cx - pillW / 2, cy - pillH / 2, pillW, pillH, 11);
      ctx.fill();
      ctx.strokeStyle = '#2a2f4d';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = base === 1 ? '#9aa0c8' : base === 2 ? '#86d6ff' : '#f5c842';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(v + 'g', cx, cy + 1);
    }
  }

  function drawBalls() {
    for (const b of state.balls) {
      const g = ctx.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, BALL_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#7d86b8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a4070';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawFloaters() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of state.floaters) {
      const t = f.life;
      const alpha = Math.max(0, 1 - t);
      const dy = -30 * t;
      ctx.font = `bold ${f.crit ? 18 : 16}px system-ui, sans-serif`;
      ctx.fillStyle = f.crit
        ? `rgba(255, 120, 90, ${alpha})`
        : `rgba(245, 200, 66, ${alpha})`;
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

  // ---- HUD sync ----
  function syncHud() {
    goldDisplay.textContent = fmt(state.gold) + 'g';
    menuBtn.hidden = state.maxGold < 10;
  }

  // ---- Main loop ----
  let last = 0;
  function loop(t) {
    if (!last) last = t;
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    step(dt);
    render();
    syncHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
