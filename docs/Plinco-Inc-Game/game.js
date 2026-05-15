(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // ---- Layout ----
  const COIN = { x: W / 2, y: 64, r: 30 };
  const BAR  = { x: (W - 200) / 2, y: COIN.y + COIN.r + 18, w: 200, h: 10 };

  const PEG_R = 7;
  const ROW1_Y = 230;
  const ROW2_Y = 330;
  const PEG_SPACING = 70;

  const PEGS = [
    { x: W / 2,                  y: ROW1_Y },
    { x: W / 2 - PEG_SPACING,    y: ROW2_Y },
    { x: W / 2 + PEG_SPACING,    y: ROW2_Y },
  ];

  const CHAMBER_COUNT = 5;
  const CHAMBER_VALUES = [3, 2, 1, 2, 3];
  const CHAMBER_W = W / CHAMBER_COUNT;
  const CHAMBER_TOP = 430;
  const FLOOR_Y = H - 30;

  const BALL_R = 8;
  const GRAVITY = 700;          // px/s^2
  const RESTITUTION = 0.55;
  const COOLDOWN_MS = 3000;

  // ---- State ----
  const state = {
    gold: 0,
    cooldown: 0,             // ms remaining
    balls: [],
    floaters: [],            // "+3g" popups
  };

  // ---- Persistence ----
  const SAVE_KEY = 'plinco-inc-save-v1';
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ gold: state.gold })); } catch {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s.gold === 'number') state.gold = s.gold;
    } catch {}
  }
  load();

  // ---- Input ----
  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top)  * (H / r.height),
    };
  }

  function tryDrop(p) {
    const dx = p.x - COIN.x;
    const dy = p.y - COIN.y;
    if (dx * dx + dy * dy > COIN.r * COIN.r) return;
    if (state.cooldown > 0) return;
    dropBall();
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tryDrop(canvasPoint(e));
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
    state.cooldown = COOLDOWN_MS;
  }

  // ---- Physics ----
  function step(dt) {
    if (state.cooldown > 0) {
      state.cooldown = Math.max(0, state.cooldown - dt * 1000);
    }

    for (const b of state.balls) {
      if (b.done) continue;
      b.age += dt;

      b.vy += GRAVITY * dt;
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;

      // Pegs
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
          // Tiny random nudge so head-on hits don't get stuck
          b.vx += (Math.random() - 0.5) * 60;
        }
      }

      // Side walls
      if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx) * RESTITUTION; }
      if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx) * RESTITUTION; }

      // Chamber dividers (vertical walls between chambers)
      if (b.y + BALL_R > CHAMBER_TOP) {
        for (let i = 1; i < CHAMBER_COUNT; i++) {
          const wx = i * CHAMBER_W;
          const dx = b.x - wx;
          if (Math.abs(dx) < BALL_R) {
            if (dx < 0) {
              b.x = wx - BALL_R;
              b.vx = -Math.abs(b.vx) * RESTITUTION;
            } else {
              b.x = wx + BALL_R;
              b.vx = Math.abs(b.vx) * RESTITUTION;
            }
          }
        }
      }

      // Floor
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

      // Settled — award gold
      if (b.resting > 0.25 && !b.done) {
        const idx = Math.min(CHAMBER_COUNT - 1, Math.max(0, Math.floor(b.x / CHAMBER_W)));
        const value = CHAMBER_VALUES[idx];
        state.gold += value;
        state.floaters.push({
          x: idx * CHAMBER_W + CHAMBER_W / 2,
          y: CHAMBER_TOP + 20,
          text: '+' + value + 'g',
          life: 0,
        });
        save();
        b.done = true;
      }

      // Safety: kill after 12s no matter what
      if (b.age > 12 && !b.done) {
        b.done = true;
      }
    }

    // Cull
    state.balls = state.balls.filter(b => !b.done || (b.done && false));
    // (balls disappear immediately when scored; the floater shows the payout)

    for (const f of state.floaters) f.life += dt;
    state.floaters = state.floaters.filter(f => f.life < 1.0);
  }

  // ---- Rendering ----
  function drawCoin() {
    const ready = state.cooldown <= 0;
    ctx.save();

    // Glow when ready
    if (ready) {
      const glow = ctx.createRadialGradient(COIN.x, COIN.y, COIN.r * 0.4, COIN.x, COIN.y, COIN.r * 1.8);
      glow.addColorStop(0, 'rgba(245, 200, 66, 0.35)');
      glow.addColorStop(1, 'rgba(245, 200, 66, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(COIN.x, COIN.y, COIN.r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Coin body
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

    // $ symbol
    ctx.fillStyle = ready ? '#5a3a00' : '#8d92ad';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', COIN.x, COIN.y + 1);

    ctx.restore();
  }

  function drawCooldownBar() {
    const progress = 1 - state.cooldown / COOLDOWN_MS;

    ctx.save();
    // Track
    ctx.fillStyle = '#1d2238';
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5);
    ctx.fill();

    // Fill
    const fillW = Math.max(0, Math.min(BAR.w, BAR.w * progress));
    if (fillW > 0) {
      const fg = ctx.createLinearGradient(BAR.x, 0, BAR.x + BAR.w, 0);
      if (state.cooldown > 0) {
        fg.addColorStop(0, '#3a8dff');
        fg.addColorStop(1, '#5fb7ff');
      } else {
        fg.addColorStop(0, '#2dd06a');
        fg.addColorStop(1, '#7ef0a4');
      }
      ctx.fillStyle = fg;
      roundRect(ctx, BAR.x, BAR.y, fillW, BAR.h, 5);
      ctx.fill();
    }

    // Border
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3a4060';
    roundRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoard() {
    // Pegs
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

    // Chamber dividers
    ctx.fillStyle = '#3a4070';
    for (let i = 1; i < CHAMBER_COUNT; i++) {
      ctx.fillRect(i * CHAMBER_W - 1.5, CHAMBER_TOP, 3, FLOOR_Y - CHAMBER_TOP);
    }

    // Chamber floor
    ctx.fillStyle = '#3a4070';
    ctx.fillRect(0, FLOOR_Y, W, 3);

    // Chamber labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < CHAMBER_COUNT; i++) {
      const cx = i * CHAMBER_W + CHAMBER_W / 2;
      const cy = (CHAMBER_TOP + FLOOR_Y) / 2 + 38;
      const v = CHAMBER_VALUES[i];

      // pill background
      const pillW = 44, pillH = 22;
      ctx.fillStyle = '#0d1022';
      roundRect(ctx, cx - pillW / 2, cy - pillH / 2, pillW, pillH, 11);
      ctx.fill();
      ctx.strokeStyle = '#2a2f4d';
      ctx.lineWidth = 1;
      ctx.stroke();

      // value text
      ctx.fillStyle = v === 1 ? '#9aa0c8' : v === 2 ? '#86d6ff' : '#f5c842';
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
    ctx.font = 'bold 16px system-ui, sans-serif';
    for (const f of state.floaters) {
      const t = f.life;
      const alpha = Math.max(0, 1 - t);
      const dy = -30 * t;
      ctx.fillStyle = `rgba(245, 200, 66, ${alpha})`;
      ctx.fillText(f.text, f.x, f.y + dy);
    }
  }

  function drawHud() {
    ctx.save();
    ctx.textBaseline = 'top';

    // Gold counter (top-left)
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f5c842';
    ctx.fillText('● ' + state.gold + 'g', 14, 14);

    ctx.restore();
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
    drawHud();
    drawCoin();
    drawCooldownBar();
    drawBoard();
    drawBalls();
    drawFloaters();
  }

  // ---- Main loop ----
  let last = 0;
  function loop(t) {
    if (!last) last = t;
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    step(dt);
    render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
