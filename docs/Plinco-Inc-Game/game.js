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

  const voidBtn = document.getElementById('voidBtn');
  const voidOverlay = document.getElementById('voidOverlay');
  const voidCloseBtn = document.getElementById('voidCloseBtn');
  const vpBalance = document.getElementById('vpBalance');
  const vpCanvas = document.getElementById('vpCanvas');
  const prestigeBtn = document.getElementById('prestigeBtn');
  const ffBtn = document.getElementById('ffBtn');

  const settingsBtn = document.getElementById('settingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const setMusic = document.getElementById('setMusic');
  const setFx = document.getElementById('setFx');
  const setMute = document.getElementById('setMute');
  const dbgGoldNow = document.getElementById('dbgGoldNow');
  const dbgGold100 = document.getElementById('dbgGold100');
  const dbgGold500 = document.getElementById('dbgGold500');
  const dbgGold1k = document.getElementById('dbgGold1k');
  const dbgGold10k = document.getElementById('dbgGold10k');
  const dbgGap = document.getElementById('dbgGap');
  const dbgGapVal = document.getElementById('dbgGapVal');
  const dbgEntry = document.getElementById('dbgEntry');
  const dbgEntryVal = document.getElementById('dbgEntryVal');
  const dbgFlank = document.getElementById('dbgFlank');
  const dbgFlankVal = document.getElementById('dbgFlankVal');
  const dbgReset = document.getElementById('dbgReset');
  const dbgVp = document.getElementById('dbgVp');
  const devLock = document.getElementById('devLock');
  const devUnlockBtn = document.getElementById('devUnlockBtn');
  const debugSection = document.getElementById('debugSection');

  // ---- Layout ----
  const COIN = { x: W / 2, y: 64, r: 30 };
  const BAR  = { x: (W - 200) / 2, y: COIN.y + COIN.r + 6, w: 200, h: 10 };
  const CEIL_Y = 22;              // solid ceiling above the coin (no escapes)
  const CEIL_TOOTH = 26;          // decorative triangle width

  const PEG_R = 10.5;  // 7 * 1.5
  const SPAWN_Y = BAR.y + BAR.h + 24; // ball drop point (clear of bar + pips)
  // drop point -> first peg row — tunable via Debug settings for now
  const CONTENT_BOTTOM = H - 14;  // floor never goes below this
  const CHAMBER_H = 35;          // short slot
  const PREFERRED_GAP = 78;      // ideal vertical spacing between peg rows
  // gap from last peg row to the slot — tunable via Debug settings for now

  let LO = null;                 // current frame's board layout
  const LOW_GRAV_FACTOR = 0.1;   // moon gravity (per-ball) after a top-of-bar hit
  let goldPegIdx = -1;           // which spinning peg is currently gold
  let goldPegEndsAt = 0;

  const BALL_R = 8;
  const GRAVITY = 700;
  const RESTITUTION = 0.92;       // all pegs — super bouncy
  const WALL_RESTITUTION = 0.85;  // side walls — extra bouncy
  const TINY_SCALE = 0.25;        // bonus peg size relative to a normal peg
  const MOVER_LEN = 70;           // moving bar length
  const MOVER_T = 7;              // moving bar thickness
  // Each bar moves independently across the board (its own fixed speed).
  // Persistent per-bonus-peg data (color/value fixed once; respawn timer).
  const _tinyMeta = new Map();
  function tinyMeta(id) {
    let m = _tinyMeta.get(id);
    if (!m) {
      const red = Math.random() < 0.28;
      m = {
        red,
        gold: red ? 4 + Math.floor(Math.random() * 2)   // 4-5
                  : 1 + Math.floor(Math.random() * 3),  // 1-3
        until: 0,
      };
      _tinyMeta.set(id, m);
    }
    return m;
  }

  const movers = Array.from({ length: 5 }, (_, i) => ({
    x: MOVER_LEN / 2 + Math.random() * (W - MOVER_LEN),
    dir: Math.random() < 0.5 ? -1 : 1,
    speed: 90 + i * 30 + Math.random() * 80,
    vx: 0,
  }));
  const BASE_RECHARGE_S = 3.0;

  // ---- State ----
  const defaultUpg = () => ({
    chamberValue: 0,
    crit: 0,
    recharge: 0,
    rows: 0,        // 0..4  -> rows = 2 + rows  (board 2..6)
    airtime: 0,     // 0/1   -> air-time bonus (up to +3g)
    airtimePlus: 0, // 0..10 -> +10% airtime bonus per level
    pegSpin: 0,     // 0/1   -> main pegs spin (cosmetic)
    pegSpinSpeed: 0,// 0..7  -> spin speed boost
    tinyPegs: 0,    // 0..5  -> bonus pegs per side per big peg
    tinyWorth: 0,   // 0..25 -> +2 flat bonus peg gold per level (cap +50)
    tinyValue: 0,   // 0..5  -> bonus peg worth x4 per level
    movers: 0,      // 0..5  -> moving bars between rows
    lowGrav: 0,     // 0/1   -> bar strike triggers low gravity 5s
    randomDrop: 0,  // 0/1   -> random "rain" drop instead of dead center
    upgradeAll: 0,  // 0/1   -> unlocks the Upgrade All button
    autoDrop: 0,
    ballGold: 0,
    ballGreen: 0,
    ballBlue: 0,
    ballRed: 0,
    ballOrange: 0,
    ballPink: 0,
    ballRainbow: 0,
  });

  const defaultSettings = () => ({
    music: true,
    fx: true,
    mute: false,
    gapToSlot: 125,
    entryGap: 100,
    bonusFlank: 32,
    devUnlocked: false,
  });

  const defaultVpUpg = () => ({
    startGold: 0,   // +10g start per level (max 50)
    earnRate: 0,    // +25% VP per level (max 10)
    earnRate2: 0,   // +10% VP per level (max 5)
    discount: 0,    // lowers VP divisor (max 10)
    fastFwd: 0,     // 0/1 unlock 2x speed toggle
    autoStart: 0,   // 0/1 start runs with Auto-Dropper
    critStart: 0,   // start runs with N crit levels (max 10)
    pegStart: 0,    // start runs with N Bonus Peg levels (max 5)
    valueStart: 0,  // start runs with N Chamber Value levels (max 12)
    critCap: 0,     // +10 crit cap per level (max 10)
    chamberCap: 0,  // +1 Chamber Value cap per level (max 5)
    ballCap: 0,     // +1 max balls on screen per level (max 5)
  });

  const state = {
    gold: 0,
    maxGold: 0,
    cooldown: 0,
    balls: [],
    floaters: [],
    upg: defaultUpg(),
    settings: defaultSettings(),
    seen: {},   // upgrade ids the player has viewed in the menu
    vp: 0,                       // Void Points (persist through prestige)
    vpUpg: defaultVpUpg(),       // VP upgrades (persist through prestige)
    prestigeUnlocked: false,     // sticky once all rows bought
    fastForward: false,          // transient 2x toggle
  };

  // ---- Board geometry (dynamic) ----
  function chamberCount() { return Math.min(5, 2 + state.upg.rows); }  // 2..5 (rows 1&2 free)
  function rowsCount()    { return chamberCount(); }                   // peg rows = chambers
  function chamberW()     { return W / chamberCount(); }

  function chamberMultiplier() { return Math.pow(2, state.upg.chamberValue); }
  // Cosmetic peg spin (independent of game state/speed).
  const BASE_SPIN = 0.7; // rad/s
  function pegSpinSpeedMult() {
    const L = state.upg.pegSpinSpeed;
    return L <= 0 ? 1 : 1 + 0.10 + 0.05 * (L - 1);
  }
  function pegSpinAngle() {
    if (state.upg.pegSpin < 1) return 0;
    return (performance.now() / 1000) * BASE_SPIN * pegSpinSpeedMult();
  }
  function tinyValueMult() { return Math.pow(4, state.upg.tinyValue); }
  function tinyWorthAdd() { return 2 * state.upg.tinyWorth; }  // +2/level, cap +50
  const TINY_VALUE_COSTS = [50000, 500000, 5000000, 5000000000, 1000000000000];
  function chamberValueCost(level) {
    if (level === 0) return 10;
    if (level === 1) return 50;
    if (level === 2) return 150;
    if (level === 3) return 300;
    return 300 * Math.pow(2, level - 3);
  }

  function chamberValues() {
    const m = chamberMultiplier();
    const n = chamberCount();
    const arr = [];
    // 1ch:[1] 2ch:[2,2] 3ch:[3,4,3] 4ch:[4,5,5,4] 5ch:[5,6,7,6,5]
    // edge = n, +1 per step toward center; x2-upgrade still scales it.
    for (let i = 0; i < n; i++) {
      arr.push(m * (n + Math.min(i, n - 1 - i)));
    }
    return arr;
  }

  // Lay out the peg rows + slot. First row sits entryGap below the drop
  // point; slot sits gapToSlot below the last row. Rows use PREFERRED_GAP
  // spacing, compressing only if a tall board would overflow the canvas.
  function computeLayout() {
    const R = rowsCount();
    const cw = chamberW();
    const spacing = (W * 0.72) / Math.max(1, R - 1); // spread the pyramid
    const gapToSlot = state.settings.gapToSlot;
    const startY = SPAWN_Y + state.settings.entryGap;
    const tail = gapToSlot + CHAMBER_H;
    const maxSpan = CONTENT_BOTTOM - tail - startY;
    const gap = R > 1 ? Math.min(PREFERRED_GAP, maxSpan / (R - 1)) : 0;

    const pegs = [];
    const rowYs = [];
    for (let k = 1; k <= R; k++) {
      const y = startY + (k - 1) * gap;
      rowYs.push(y);
      for (let j = 0; j < k; j++) {
        pegs.push({ x: W / 2 + (j - (k - 1) / 2) * spacing, y });
      }
    }

    // Bonus (tiny) pegs: flank each big peg closely on both sides, where a
    // glancing ball actually travels. Level L = L pegs per side per big peg.
    const tinies = [];
    const L = state.upg.tinyPegs;
    if (L > 0) {
      const tr = PEG_R * TINY_SCALE;
      const base = state.settings.bonusFlank;  // tunable flank distance
      const step = tr * 4 + 5;
      const minGapBig = PEG_R + tr + 3;
      for (let k = 1; k <= R; k++) {
        const y = rowYs[k - 1];
        const xs = [];
        for (let j = 0; j < k; j++) xs.push(W / 2 + (j - (k - 1) / 2) * spacing);
        xs.forEach((bx, bi) => {
          for (let i = 0; i < L; i++) {
            const off = base + i * step;
            for (const s of [-1, 1]) {
              const x = bx + s * off;
              if (x < tr + 2 || x > W - tr - 2) continue;
              // don't sit on top of another big peg
              let clash = false;
              for (const xb of xs) {
                if (xb !== bx && Math.abs(x - xb) < minGapBig) { clash = true; break; }
              }
              if (clash) continue;
              tinies.push({ x, y, r: tr, id: `${k}:${bi}:${s < 0 ? 'L' : 'R'}:${i}` });
            }
          }
        });
      }
    }

    const lastRowY = startY + (R - 1) * gap;
    const chamberTop = lastRowY + gapToSlot;
    return {
      pegs,
      tinies,
      rowYs,
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
    { id: 'ballGreen',   name: 'Green',   mult: 3,  chance: 0.15, color: '#4fdc6a' },
    { id: 'ballBlue',    name: 'Blue',    mult: 4,  chance: 0.12, color: '#4f9fff' },
    { id: 'ballRed',     name: 'Red',     mult: 5,  chance: 0.10, color: '#ff5a5a' },
    { id: 'ballOrange',  name: 'Orange',  mult: 7,  chance: 0.07, color: '#ff9b3d' },
    { id: 'ballPink',    name: 'Pink',    mult: 9,  chance: 0.05, color: '#ff7ad9' },
    { id: 'ballRainbow', name: 'Rainbow', mult: 12, chance: 0.02, color: 'rainbow' },
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
    return Math.round(150 * Math.pow(1.55, level));   // steep, capped at lv 100
  }

  const RECHARGE_MAX_LEVEL = 5;
  const RECHARGE_COSTS = [700, 15000, 120000, 1000000, 350000000];
  function rechargeSeconds() {
    const L = state.upg.recharge;
    if (L <= 0) return BASE_RECHARGE_S;
    return Math.max(0.1, BASE_RECHARGE_S - 0.3 - 0.2 * (L - 1));
  }
  function rechargeCost(level) { return RECHARGE_COSTS[level]; }
  function cooldownMs() { return rechargeSeconds() * 1000; }

  const ROWS_MAX_LEVEL = 3; // adds rows 3..5 (board 2..5)

  // ---- Persistence ----
  const SAVE_KEY = 'plinco-inc-save-v1';
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        gold: state.gold,
        maxGold: state.maxGold,
        upg: state.upg,
        settings: state.settings,
        seen: state.seen,
        vp: state.vp,
        vpUpg: state.vpUpg,
        prestigeUnlocked: state.prestigeUnlocked,
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
      if (s.settings) Object.assign(state.settings, s.settings);
      if (s.seen) state.seen = s.seen;
      if (typeof s.vp === 'number') state.vp = s.vp;
      if (s.vpUpg) Object.assign(state.vpUpg, s.vpUpg);
      state.prestigeUnlocked = !!s.prestigeUnlocked;
    } catch {}
  }
  load();

  function addGold(n) {
    state.gold += n;
    if (state.gold > state.maxGold) state.maxGold = state.gold;
    save();
  }

  // ---- Prestige / Void Points ----
  function startingGold() { return state.vpUpg.startGold * 10; }
  // Logarithmic VP: ~1 at 1M, ~3 at 1T, ~4 at 1Qi. Discount lowers the divisor.
  function vpDivisor() { return Math.max(2, 4 - 0.2 * state.vpUpg.discount); }
  function vpEarnMult() { return 1 + 0.25 * state.vpUpg.earnRate + 0.10 * state.vpUpg.earnRate2; }
  function vpGain() {
    const g = Math.max(1, state.maxGold);
    return Math.floor((Math.log10(g) / vpDivisor()) * vpEarnMult());
  }
  function checkPrestigeUnlock() {
    if (!state.prestigeUnlocked && state.upg.rows >= ROWS_MAX_LEVEL) {
      state.prestigeUnlocked = true;
      save();
    }
  }
  function doPrestige() {
    const gain = vpGain();
    if (gain <= 0) return;
    state.vp += gain;
    // Full run reset; VP, VP upgrades, settings, prestige flag persist.
    state.upg = defaultUpg();
    recomputeCaps();
    applyStartingBonuses();
    state.seen = {};
    state.balls = [];
    state.floaters = [];
    state.cooldown = 0;
    _tinyMeta.clear();
    state.gold = startingGold();
    state.maxGold = state.gold;
    save();
    renderPanel();
    openVoid();              // go to the talent-tree screen
  }

  // VP "new game+" head starts applied to a fresh run.
  function applyStartingBonuses() {
    state.upg.crit = Math.min(100, state.vpUpg.critStart);
    state.upg.tinyPegs = Math.min(5, state.vpUpg.pegStart);
    state.upg.chamberValue = Math.min(CHV_UP.maxLevel, state.vpUpg.valueStart);
    state.upg.autoDrop = state.vpUpg.autoStart >= 1 ? 1 : 0;
  }
  function unspentVpMult() { return 1 + 0.10 * state.vp; }

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
    ballGold:    { cost: 1000,           unlockAt: 800 },
    ballGreen:   { cost: 10000,          unlockAt: 8000 },
    ballBlue:    { cost: 1000000,        unlockAt: 750000 },
    ballRed:     { cost: 50000000,       unlockAt: 40000000 },
    ballOrange:  { cost: 5000000000,     unlockAt: 4000000000 },
    ballPink:    { cost: 500000000000,   unlockAt: 400000000000 },
    ballRainbow: { cost: 50000000000000, unlockAt: 40000000000000 },
  };
  for (const t of BALL_TIERS) Object.assign(t, TIER_ECON[t.id]);

  const UPGRADES = [
    {
      id: 'chamberValue', name: 'Chamber Value x2', unlockAt: 10, maxLevel: 5,
      level: () => state.upg.chamberValue,
      cost: () => chamberValueCost(state.upg.chamberValue),
      desc: () => `Doubles every chamber payout (compounding). Now x${fmt(chamberMultiplier())}.`,
      buy() { state.upg.chamberValue++; },
    },
    {
      id: 'crit', name: 'Critical Chance', unlockAt: 30, maxLevel: 100,
      level: () => state.upg.crit, cost: () => critCost(state.upg.crit),
      desc: () => `+1% crit chance per level (crit = +10% payout). Now: ${state.upg.crit}%.`,
      buy() { state.upg.crit++; },
    },
    {
      id: 'recharge', name: 'Faster Recharge', unlockAt: 500, maxLevel: RECHARGE_MAX_LEVEL,
      level: () => state.upg.recharge, cost: () => rechargeCost(state.upg.recharge),
      desc: () => `Recharge: ${rechargeSeconds().toFixed(1)}s. −0.3s first level, then −0.2s. Lv ${state.upg.recharge}/5.`,
      buy() { state.upg.recharge++; },
    },
    {
      id: 'randomDrop', name: 'Random Rain Drop', unlockAt: 500, maxLevel: 1,
      level: () => state.upg.randomDrop, cost: () => 500,
      desc: () => state.upg.randomDrop >= 1
        ? 'Balls rain from random spots across the top.'
        : 'Balls drop from a random spot across the top instead of dead center.',
      buy() { state.upg.randomDrop = 1; },
    },
    {
      id: 'rows', name: 'Add Row', unlockAt: 1000, maxLevel: ROWS_MAX_LEVEL,
      level: () => state.upg.rows,
      cost: () => 1000 * Math.pow(10, state.upg.rows),
      desc: () => `Board: ${chamberCount()} rows. Adds row ${chamberCount() + 1} (+1 chamber, max 5 rows).`,
      buy() { state.upg.rows++; },
    },
    {
      id: 'airtime', name: 'Airtime', unlockAt: 500, maxLevel: 1,
      level: () => state.upg.airtime, cost: () => 600,
      desc: () => state.upg.airtime >= 1
        ? 'Longer time in the air = up to +3g bonus on landing.'
        : 'Bonus of up to +3g based on how long the ball stays airborne.',
      buy() { state.upg.airtime = 1; },
    },
    {
      id: 'airtimePlus', name: 'Airtime+', unlockAt: 1000, maxLevel: 10,
      level: () => state.upg.airtimePlus,
      cost: () => 1200 * Math.pow(2, state.upg.airtimePlus),
      desc: () => `+10% Airtime bonus per level. Now +${10 * state.upg.airtimePlus}%. Lv ${state.upg.airtimePlus}/10.`,
      buy() { state.upg.airtimePlus++; },
    },
    {
      id: 'pegSpin', name: 'Spinning Pegs', unlockAt: 5, maxLevel: 1,
      level: () => state.upg.pegSpin, cost: () => 20,
      desc: () => state.upg.pegSpin >= 1
        ? 'All main pegs slowly spin.'
        : 'All main pegs slowly spin in place (cosmetic).',
      buy() { state.upg.pegSpin = 1; },
    },
    {
      id: 'pegSpinSpeed', name: 'Peg Spin Speed', unlockAt: 200, maxLevel: 7,
      level: () => state.upg.pegSpinSpeed,
      cost: () => 250 * Math.pow(2, state.upg.pegSpinSpeed),
      desc: () => `Speeds up peg spin (+10% then +5%/level). Now +${Math.round((pegSpinSpeedMult() - 1) * 100)}%. Lv ${state.upg.pegSpinSpeed}/7.`,
      buy() { state.upg.pegSpinSpeed++; },
    },
    {
      id: 'tinyPegs', name: 'Bonus Pegs', unlockAt: 75, maxLevel: 5,
      level: () => state.upg.tinyPegs,
      cost: () => 100 * Math.pow(2, state.upg.tinyPegs),
      desc: () => `Adds bonus pegs flanking each peg where balls glance off. Green = 1–3g, red = 4–5g; vanish 5s when struck. Lv ${state.upg.tinyPegs}/5.`,
      buy() { state.upg.tinyPegs++; },
    },
    {
      id: 'tinyWorth', name: 'Bonus Peg Worth', unlockAt: 175, maxLevel: 25,
      level: () => state.upg.tinyWorth,
      cost: () => 200 * Math.pow(2, state.upg.tinyWorth),
      desc: () => `+2 gold per bonus peg per level (cap +50). Now +${tinyWorthAdd()}g. Lv ${state.upg.tinyWorth}/25.`,
      buy() { state.upg.tinyWorth++; },
    },
    {
      id: 'tinyValue', name: 'Bonus Peg Value', unlockAt: 50000, maxLevel: 5,
      level: () => state.upg.tinyValue,
      cost: () => TINY_VALUE_COSTS[state.upg.tinyValue],
      desc: () => `Bonus pegs are worth x4 more per level. Now x${fmt(tinyValueMult())}. Lv ${state.upg.tinyValue}/5.`,
      buy() { state.upg.tinyValue++; },
    },
    {
      id: 'movers', name: 'Moving Bar', unlockAt: 1000, maxLevel: 5,
      level: () => state.upg.movers,
      cost: () => [1000, 10000, 100000, 1000000, 1000000000][state.upg.movers],
      desc: () => {
        const next = state.upg.movers + 1;
        return `Bar ${next}/5 between rows ${next} & ${next + 1}: slides across, balls bounce off it. Each bar moves on its own.`;
      },
      buy() { state.upg.movers++; },
    },
    {
      id: 'lowGrav', name: 'Low Gravity', unlockAt: 600, maxLevel: 1,
      level: () => state.upg.lowGrav, cost: () => 650,
      desc: () => state.upg.lowGrav >= 1
        ? 'Striking a moving bar drops gravity hard for 5s.'
        : 'When a ball hits a moving bar, gravity is greatly reduced for 5 seconds.',
      buy() { state.upg.lowGrav = 1; },
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
    {
      id: 'upgradeAll', name: 'Upgrade All', unlockAt: 1000000, maxLevel: 1,
      level: () => state.upg.upgradeAll, cost: () => 1000000,
      desc: () => 'Unlocks an "Upgrade All" button at the top of this menu that spends all your gold buying upgrades.',
      buy() { state.upg.upgradeAll = 1; },
    },
  ];

  // VP-driven dynamic caps on two upgrades.
  const CRIT_UP = UPGRADES.find(u => u.id === 'crit');
  const CHV_UP = UPGRADES.find(u => u.id === 'chamberValue');
  function recomputeCaps() {
    CRIT_UP.maxLevel = 100 + 10 * (state.vpUpg.critCap || 0);
    CHV_UP.maxLevel = 5 + (state.vpUpg.chamberCap || 0);
  }
  recomputeCaps();

  function canBuy(u) { return u.level() < u.maxLevel && state.gold >= u.cost(); }
  function purchase(u) {
    if (!canBuy(u)) return;
    state.gold -= u.cost();
    u.buy();
    save();
    renderPanel();
  }

  // Spend all gold: repeatedly buy the cheapest affordable unlocked upgrade.
  function doUpgradeAll() {
    let guard = 200000;
    while (guard-- > 0) {
      let best = null;
      for (const u of UPGRADES) {
        if (u.id === 'upgradeAll') continue;
        if (u.level() >= u.maxLevel) continue;
        if (state.maxGold < u.unlockAt) continue;
        const c = u.cost();
        if (state.gold >= c && (best === null || c < best.c)) best = { u, c };
      }
      if (!best) break;
      state.gold -= best.c;
      best.u.buy();
    }
    save();
    renderPanel();
  }

  // ---- Menu DOM ----
  let panelOpen = false;

  function visibleUpgrades() {
    return UPGRADES.filter(u => state.maxGold >= u.unlockAt && u.level() < u.maxLevel);
  }
  function markSeen() {
    let changed = false;
    for (const u of visibleUpgrades()) {
      if (!state.seen[u.id]) { state.seen[u.id] = true; changed = true; }
    }
    if (changed) save();
  }
  let lastBadge = null;
  function updateMenuBadge() {
    const vis = visibleUpgrades();
    const hasNew = vis.some(u => !state.seen[u.id]);
    const canBuy = vis.some(u => state.gold >= u.cost());
    let html = 'Upgrades';
    if (canBuy) html += ' <span class="badge-buy">!</span>';
    if (hasNew) html += ' <span class="badge-new">!!</span>';
    if (html !== lastBadge) { menuBtn.innerHTML = html; lastBadge = html; }
  }

  function openPanel() {
    panelOpen = true; overlay.hidden = false;
    renderPanel(); markSeen();
  }
  function closePanel() { panelOpen = false; overlay.hidden = true; }
  menuBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });

  // ---- Audio (lazy WebAudio FX) ----
  let audioCtx = null;
  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {}
  }
  function sfx(kind) {
    const s = state.settings;
    if (s.mute || !s.fx || !audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (kind === 'drop') {
      o.type = 'triangle';
      o.frequency.setValueAtTime(440, t);
      o.frequency.exponentialRampToValueAtTime(220, t + 0.08);
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
      o.start(t); o.stop(t + 0.11);
    } else {
      o.type = 'sine';
      o.frequency.setValueAtTime(740, t);
      o.frequency.setValueAtTime(988, t + 0.06);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.19);
    }
  }

  // ---- Settings DOM ----
  function syncSettingsUI() {
    setMusic.setAttribute('aria-checked', String(state.settings.music));
    setFx.setAttribute('aria-checked', String(state.settings.fx));
    setMute.setAttribute('aria-checked', String(state.settings.mute));
    dbgGap.value = String(state.settings.gapToSlot);
    dbgGapVal.textContent = state.settings.gapToSlot + 'px';
    dbgEntry.value = String(state.settings.entryGap);
    dbgEntryVal.textContent = state.settings.entryGap + 'px';
    dbgFlank.value = String(state.settings.bonusFlank);
    dbgFlankVal.textContent = state.settings.bonusFlank + 'px';
    dbgGoldNow.textContent = fmt(state.gold) + 'g';
    const unlocked = !!state.settings.devUnlocked;
    debugSection.hidden = !unlocked;
    devLock.hidden = unlocked;
  }
  function openSettings() {
    settingsOverlay.hidden = false;
    ensureAudio();
    syncSettingsUI();
  }
  function closeSettings() { settingsOverlay.hidden = true; }
  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  // ---- Void Points talent tree ----
  const TAU = Math.PI * 2;
  const R1 = 155, R2 = 250;
  const VC = vpCanvas.width / 2, VCY = vpCanvas.height / 2;
  const NODE_R = 46;

  // ring1 angles (6 around the centre), ring2 hang off their parent's angle.
  const A = i => -Math.PI / 2 + i * (TAU / 6);
  const VP_TREE = [
    { id: 'startGold', label: 'Start Gold', sub: '+10g/run', field: 'startGold',
      max: 50, cost: () => 1, parent: null, ring: 0, ang: 0 },

    { id: 'earnRate', label: 'VP Rate', sub: '+25%/lvl', field: 'earnRate',
      max: 10, cost: l => 2 * 2 ** l, parent: 'startGold', ring: 1, ang: A(0) },
    { id: 'discount', label: 'VP Yield', sub: 'lower ÷', field: 'discount',
      max: 10, cost: l => 3 * 2 ** l, parent: 'startGold', ring: 1, ang: A(1) },
    { id: 'critStart', label: 'Start Crit', sub: '+1 lvl/lvl', field: 'critStart',
      max: 10, cost: l => 5 * 2 ** l, parent: 'startGold', ring: 1, ang: A(2) },
    { id: 'fastFwd', label: 'Fast Fwd', sub: '2x toggle', field: 'fastFwd',
      max: 1, cost: () => 10, parent: 'startGold', ring: 1, ang: A(3) },
    { id: 'pegStart', label: 'Start Pegs', sub: 'bonus pegs', field: 'pegStart',
      max: 5, cost: l => 8 * 2 ** l, parent: 'startGold', ring: 1, ang: A(4) },
    { id: 'valueStart', label: 'Start Value', sub: 'chamber x2', field: 'valueStart',
      max: 12, cost: l => 6 * 2 ** l, parent: 'startGold', ring: 1, ang: A(5) },

    { id: 'earnRate2', label: 'VP Rate+', sub: '+10%/lvl', field: 'earnRate2',
      max: 5, cost: l => 12 * 2 ** l, parent: 'earnRate', ring: 2, ang: A(0) },
    { id: 'autoStart', label: 'Start Auto', sub: 'auto-drop', field: 'autoStart',
      max: 1, cost: () => 25, parent: 'fastFwd', ring: 2, ang: A(3) },
    { id: 'critCap', label: 'Crit Cap', sub: '+10/lvl', field: 'critCap',
      max: 10, cost: l => (l < 5 ? 1 : 2), parent: 'critStart', ring: 2, ang: A(2) },
    { id: 'chamberCap', label: 'Chamber Cap', sub: '+1/lvl', field: 'chamberCap',
      max: 5, cost: l => (l < 3 ? 2 : 3), parent: 'valueStart', ring: 2, ang: A(5) },
    { id: 'ballCap', label: 'Ball Cap', sub: '+1 ball/lvl', field: 'ballCap',
      max: 5, cost: l => (l < 3 ? 2 : 3), parent: 'discount', ring: 2, ang: A(1) },
  ];
  const VP_BY_ID = Object.fromEntries(VP_TREE.map(n => [n.id, n]));
  function vpNodePos(n) {
    const r = n.ring === 0 ? 0 : n.ring === 1 ? R1 : R2;
    return { x: VC + Math.cos(n.ang) * r, y: VCY + Math.sin(n.ang) * r };
  }
  const vpLvl = n => state.vpUpg[n.field] || 0;
  const vpBought = n => vpLvl(n) >= 1;
  function vpUnlocked(n) {                       // prerequisite met
    return n.parent === null ? true : vpBought(VP_BY_ID[n.parent]);
  }
  function vpVisible(n) {                        // shown on the tree
    if (n.ring <= 1) return true;
    return vpBought(VP_BY_ID[n.parent]);
  }
  function vpNodeCost(n) { return n.cost(vpLvl(n)); }
  function vpCanBuy(n) {
    return vpVisible(n) && vpUnlocked(n) && vpLvl(n) < n.max && state.vp >= vpNodeCost(n);
  }
  function buyVpNode(n) {
    if (!vpCanBuy(n)) return;
    state.vp -= vpNodeCost(n);
    state.vpUpg[n.field] = vpLvl(n) + 1;
    recomputeCaps();
    save();
    drawVpTree();
  }

  let voidOpen = false;
  function drawVpTree() {
    if (!voidOpen) return;
    vpBalance.textContent = fmt(state.vp) + ' VP';
    const gain = vpGain();
    prestigeBtn.textContent = gain > 0 ? `Prestige (+${fmt(gain)})` : 'Prestige';
    prestigeBtn.disabled = gain <= 0;

    const c = vpCanvas.getContext('2d');
    c.clearRect(0, 0, vpCanvas.width, vpCanvas.height);

    // links first
    for (const n of VP_TREE) {
      if (!n.parent || !vpVisible(n)) continue;
      const p = VP_BY_ID[n.parent];
      const a = vpNodePos(p), b = vpNodePos(n);
      const lit = vpBought(p) && vpBought(n);
      c.strokeStyle = lit ? '#9b7bff' : '#2c2550';
      c.lineWidth = lit ? 5 : 3;
      if (lit) { c.shadowColor = '#9b7bff'; c.shadowBlur = 12; }
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.shadowBlur = 0;
    }
    // nodes
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const n of VP_TREE) {
      if (!vpVisible(n)) continue;
      const pos = vpNodePos(n);
      const lvl = vpLvl(n), maxed = lvl >= n.max;
      const unlocked = vpUnlocked(n);
      let fill, ring;
      if (maxed) { fill = '#1f3a26'; ring = '#5fce8a'; }
      else if (!unlocked) { fill = '#1a1730'; ring = '#39335c'; }
      else if (state.vp >= vpNodeCost(n)) { fill = '#3a2f12'; ring = '#f5c842'; }
      else { fill = '#241f3d'; ring = '#6a5fa0'; }
      c.beginPath(); c.arc(pos.x, pos.y, NODE_R, 0, TAU);
      c.fillStyle = fill; c.fill();
      c.lineWidth = 4; c.strokeStyle = ring; c.stroke();

      c.fillStyle = '#fff';
      c.font = 'bold 16px system-ui, sans-serif';
      c.fillText(n.label, pos.x, pos.y - 16);
      c.fillStyle = '#9aa0c8';
      c.font = '12px system-ui, sans-serif';
      c.fillText(n.sub, pos.x, pos.y + 1);
      c.font = 'bold 13px system-ui, sans-serif';
      if (maxed) { c.fillStyle = '#5fce8a'; c.fillText('MAX', pos.x, pos.y + 18); }
      else if (!unlocked) { c.fillStyle = '#6a6f9a'; c.fillText('locked', pos.x, pos.y + 18); }
      else {
        c.fillStyle = state.vp >= vpNodeCost(n) ? '#f5c842' : '#8b91b5';
        c.fillText(fmt(vpNodeCost(n)) + ' VP', pos.x, pos.y + 18);
      }
      if (n.max > 1) {
        c.fillStyle = '#7c83a8';
        c.font = '11px system-ui, sans-serif';
        c.fillText(`${lvl}/${n.max}`, pos.x, pos.y + 33);
      }
    }
  }
  function openVoid() { voidOpen = true; voidOverlay.hidden = false; drawVpTree(); }
  function closeVoid() { voidOpen = false; voidOverlay.hidden = true; }
  voidBtn.addEventListener('click', openVoid);
  voidCloseBtn.addEventListener('click', closeVoid);   // "Play"
  vpCanvas.addEventListener('pointerup', (e) => {
    e.preventDefault();
    const r = vpCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (vpCanvas.width / r.width);
    const y = (e.clientY - r.top) * (vpCanvas.height / r.height);
    for (const n of VP_TREE) {
      if (!vpVisible(n)) continue;
      const p = vpNodePos(n);
      if ((x - p.x) ** 2 + (y - p.y) ** 2 <= NODE_R * NODE_R) { buyVpNode(n); break; }
    }
  });
  prestigeBtn.addEventListener('click', () => {
    const gain = vpGain();
    if (gain <= 0) return;
    if (!confirm(`Prestige now? Resets gold & all upgrades. You gain ${fmt(gain)} Void Points (kept).`)) return;
    doPrestige();
  });
  ffBtn.addEventListener('click', () => {
    state.fastForward = !state.fastForward;
    ffBtn.textContent = state.fastForward ? 'FF x2' : 'FF x1';
  });
  setInterval(() => { if (voidOpen) drawVpTree(); }, 300);

  function toggleSetting(key) {
    state.settings[key] = !state.settings[key];
    save();
    syncSettingsUI();
  }
  setMusic.addEventListener('click', () => toggleSetting('music'));
  setFx.addEventListener('click', () => toggleSetting('fx'));
  setMute.addEventListener('click', () => toggleSetting('mute'));

  function debugAddGold(n) {
    addGold(n);
    dbgGoldNow.textContent = fmt(state.gold) + 'g';
  }
  dbgGold100.addEventListener('click', () => debugAddGold(100));
  dbgGold500.addEventListener('click', () => debugAddGold(500));
  dbgGold1k.addEventListener('click', () => debugAddGold(1000));
  dbgGold10k.addEventListener('click', () => debugAddGold(10000));
  dbgGap.addEventListener('input', () => {
    const v = Math.max(12, Math.min(1000, parseInt(dbgGap.value, 10) || 125));
    state.settings.gapToSlot = v;
    dbgGapVal.textContent = v + 'px';
    save();
  });
  dbgEntry.addEventListener('input', () => {
    const v = Math.max(12, Math.min(1000, parseInt(dbgEntry.value, 10) || 100));
    state.settings.entryGap = v;
    dbgEntryVal.textContent = v + 'px';
    save();
  });
  dbgFlank.addEventListener('input', () => {
    const v = Math.max(10, Math.min(1000, parseInt(dbgFlank.value, 10) || 32));
    state.settings.bonusFlank = v;
    dbgFlankVal.textContent = v + 'px';
    save();
  });
  dbgReset.addEventListener('click', () => {
    if (!confirm('Delete your game and start completely over? This cannot be undone.')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    location.reload();
  });
  dbgVp.addEventListener('click', () => {
    state.vp += 1;
    save();
    if (voidOpen) drawVpTree();
  });
  devUnlockBtn.addEventListener('click', () => {
    const pw = prompt("Developer's Kitchen — enter password:");
    if (pw === null) return;
    if (pw.trim() === '1337') {
      state.settings.devUnlocked = true;
      save();
      syncSettingsUI();
    } else {
      alert('Incorrect password.');
    }
  });

  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
                 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod', 'Vg'];
  function fmt(n) {
    n = Math.round(n);
    if (n < 1e6) return n.toLocaleString('en-US');
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier >= UNITS.length) tier = UNITS.length - 1;
    const scaled = n / Math.pow(10, tier * 3);
    const dec = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    return scaled.toFixed(dec) + UNITS[tier];
  }

  // Compact label for chambers: <10k plain, else 10k / 1m / 1b / 1t ...
  const UNITS_LC = ['', 'k', 'm', 'b', 't', 'qa', 'qi', 'sx', 'sp', 'oc', 'no', 'dc',
                    'ud', 'dd', 'td', 'qad', 'qid', 'sxd', 'spd', 'ocd', 'nod', 'vg'];
  function fmtShort(n) {
    n = Math.round(n);
    if (n < 10000) return String(n);
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier < 1) tier = 1;
    if (tier >= UNITS_LC.length) tier = UNITS_LC.length - 1;
    const s = n / Math.pow(10, tier * 3);
    let str = s.toFixed(s < 10 ? 1 : 0);
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return str + UNITS_LC[tier];
  }

  let panelRows = [];   // [{ u, btn, descEl, lvlEl }]
  let panelSig = '';
  function currentSig() {
    return (state.upg.upgradeAll >= 1 ? 'A|' : '') +
      visibleUpgrades().map(u => u.id + (u.level() >= u.maxLevel ? 'M' : '')).join(',');
  }

  function renderPanel() {
    if (!panelOpen) return;
    upgradeList.innerHTML = '';
    panelRows = [];

    if (state.upg.upgradeAll >= 1) {
      const allBtn = document.createElement('button');
      allBtn.className = 'buy-btn upgrade-all-btn';
      allBtn.textContent = 'Upgrade All (spend all gold)';
      allBtn.addEventListener('pointerup', (e) => { e.preventDefault(); doUpgradeAll(); });
      upgradeList.appendChild(allBtn);
    }

    const visible = visibleUpgrades();
    if (visible.length === 0) {
      const p = document.createElement('div');
      p.className = 'upg-desc';
      p.style.cssText = 'padding:20px;text-align:center';
      p.textContent = 'Earn more gold to unlock upgrades.';
      upgradeList.appendChild(p);
      panelSig = currentSig();
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
      let lvlEl = null;
      if (u.maxLevel > 1 && u.maxLevel !== Infinity) {
        lvlEl = document.createElement('span');
        lvlEl.className = 'lvl'; lvlEl.textContent = `Lv ${lvl}/${u.maxLevel}`;
        name.appendChild(lvlEl);
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
        btn.addEventListener('pointerup', (e) => { e.preventDefault(); purchase(u); });
      }
      row.appendChild(info);
      row.appendChild(btn);
      upgradeList.appendChild(row);
      panelRows.push({ u, btn, descEl: desc, lvlEl });
    }
    panelSig = currentSig();
  }

  // Lightweight tick: rebuild only if composition changed, else update in place
  // (so a button is never destroyed under the player's finger).
  function refreshPanel() {
    if (!panelOpen) return;
    if (currentSig() !== panelSig) { renderPanel(); return; }
    for (const r of panelRows) {
      const u = r.u;
      r.descEl.textContent = u.desc();
      if (r.lvlEl) r.lvlEl.textContent = `Lv ${u.level()}/${u.maxLevel}`;
      if (!r.btn.classList.contains('maxed')) {
        const c = u.cost();
        r.btn.textContent = fmt(c) + 'g';
        r.btn.disabled = state.gold < c;
      }
    }
  }
  setInterval(refreshPanel, 300);

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
    ensureAudio();
    const p = canvasPoint(e);
    if (!tappedCoin(p)) return;
    if (state.cooldown <= 0 && state.balls.length < maxBalls()) {
      dropBall();
      state.cooldown = cooldownMs();
    }
  });
  function maxBalls() { return 5 + (state.vpUpg.ballCap || 0); }

  // Distinct peg columns across all visible rows (deduped).
  function pegColumns() {
    const xs = [], seen = new Set();
    if (LO && LO.pegs) {
      for (const p of LO.pegs) {
        const k = Math.round(p.x);
        if (!seen.has(k)) { seen.add(k); xs.push(p.x); }
      }
    }
    return xs;
  }

  function dropBall() {
    const t = rollBall();
    const rain = state.upg.randomDrop >= 1;
    let x;
    if (rain) {
      const cols = pegColumns();                    // line up over a random peg
      x = cols.length ? cols[(Math.random() * cols.length) | 0] : COIN.x;
    } else {
      x = COIN.x + (Math.random() - 0.5) * 1.5;      // dead center
    }
    state.balls.push({
      x,
      y: SPAWN_Y,
      vx: rain ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 8,
      vy: 0,
      age: 0,
      done: false,
      mult: t.mult,
      color: t.color,
    });
    sfx('drop');
  }

  // Bar m sits between peg row m and row m+1 (upgrade 1 -> rows 1&2, etc.).
  // Distinct rows => distinct heights, so bars never intersect.
  function moverList() {
    if (!LO) return [];
    const ys = LO.rowYs, R = ys.length;
    const owned = Math.min(5, state.upg.movers);
    const list = [];
    for (let m = 1; m <= owned; m++) {
      if (R < m + 1) continue;                 // needs both rows present
      list.push({ y: (ys[m - 1] + ys[m]) / 2, mv: movers[m - 1] });
    }
    return list;
  }

  // ---- Physics ----
  function step(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt * 1000);

    if (state.upg.autoDrop >= 1 && state.cooldown <= 0 && state.balls.length < maxBalls()) {
      dropBall();
      state.cooldown = cooldownMs();
    }

    // Each bar keeps its set speed, easing down near a wall (never bouncing),
    // reversing at the wall, then returning to full speed away from it.
    const half = MOVER_LEN / 2;
    const minX = half, maxX = W - half;
    const EASE_MARGIN = 70, MIN_FACTOR = 0.3;
    for (const mv of movers) {
      const distToWall = mv.dir > 0 ? (maxX - mv.x) : (mv.x - minX);
      const factor = MIN_FACTOR +
        (1 - MIN_FACTOR) * Math.min(1, Math.max(0, distToWall) / EASE_MARGIN);
      mv.vx = mv.dir * mv.speed * factor;
      mv.x += mv.vx * dt;
      if (mv.x <= minX) { mv.x = minX; mv.dir = 1; }
      else if (mv.x >= maxX) { mv.x = maxX; mv.dir = -1; }
    }
    const activeMovers = moverList();

    const { pegs, tinies, values, n, cw, chamberTop } = LO;
    const now = performance.now();

    // Spinning triangle pegs: precompute this frame's 3 vertex directions.
    const spinning = state.upg.pegSpin >= 1;
    const sAng = spinning ? pegSpinAngle() : 0;
    const vertDirs = spinning ? [
      -Math.PI / 2 + sAng,
      Math.atan2(0.85, 1) + sAng,
      Math.atan2(0.85, -1) + sAng,
    ] : null;

    // One peg is always gold while spinning; the moment its window ends,
    // a new peg becomes gold immediately (no gap).
    if (spinning && pegs.length) {
      if (goldPegIdx < 0 || now >= goldPegEndsAt) {
        let i = Math.floor(Math.random() * pegs.length);
        if (pegs.length > 1 && i === goldPegIdx) i = (i + 1) % pegs.length;
        goldPegIdx = i;
        goldPegEndsAt = now + 5000;
      }
    } else {
      goldPegIdx = -1;
    }
    const goldPeg = (goldPegIdx >= 0 && goldPegIdx < pegs.length) ? pegs[goldPegIdx] : null;

    for (const b of state.balls) {
      if (b.done) continue;
      b.age += dt;
      const moonImmune = b.moonImmuneUntil && now < b.moonImmuneUntil;
      const moonActive = !moonImmune && b.lowGravUntil && now < b.lowGravUntil;
      const grav = moonActive ? GRAVITY * LOW_GRAV_FACTOR : GRAVITY;
      b.vy += grav * dt;
      b.x  += b.vx * dt;
      b.y  += b.vy * dt;

      for (const p of pegs) {
        const dx = b.x - p.x, dy = b.y - p.y;
        const d2 = dx * dx + dy * dy;
        const md = BALL_R + PEG_R;
        if (d2 < md * md && d2 > 0.0001) {
          const isGold = p === goldPeg;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          b.x = p.x + nx * md;
          b.y = p.y + ny * md;
          const vn = b.vx * nx + b.vy * ny;

          if (spinning) {
            const ca = Math.atan2(dy, dx);
            let nearest = Infinity;
            for (const va of vertDirs) {
              let a = ca - va;
              a = Math.atan2(Math.sin(a), Math.cos(a));
              if (Math.abs(a) < nearest) nearest = Math.abs(a);
            }
            if (nearest < 0.5) {
              // hit near a point/vertex -> bounce high
              if (vn < 0) {
                b.vx -= (1 + 1.05) * vn * nx;
                b.vy -= (1 + 1.05) * vn * ny;
              }
              b.vy -= 240;                       // launch upward
              b.vx += (Math.random() - 0.5) * 40;
            } else {
              // hit a flat face -> veer randomly left or right
              if (vn < 0) {
                b.vx -= (1 + 0.4) * vn * nx;
                b.vy -= (1 + 0.4) * vn * ny;
              }
              b.vx = (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 140);
            }
          } else {
            if (vn < 0) {
              b.vx -= (1 + RESTITUTION) * vn * nx;
              b.vy -= (1 + RESTITUTION) * vn * ny;
            }
            b.vx += (Math.random() - 0.5) * 60;
          }
          // Gold peg: +100% speed for 3s, moon-gravity-immune, 10s cooldown.
          if (isGold && now >= (b.speedCdUntil || 0)) {
            b.vx *= 2; b.vy *= 2;
            b.speedUntil = now + 3000;
            b.speedCdUntil = now + 10000;
            b.moonImmuneUntil = now + 10000;   // no moon buff for 10s
          }
        }
      }

      for (const tp of tinies) {
        const meta = tinyMeta(tp.id);
        if (now < meta.until) continue;          // hidden / respawning
        const dx = b.x - tp.x, dy = b.y - tp.y;
        const d2 = dx * dx + dy * dy;
        const md = BALL_R + tp.r;
        if (d2 < md * md && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          b.x = tp.x + nx * md;
          b.y = tp.y + ny * md;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + RESTITUTION) * vn * nx;
            b.vy -= (1 + RESTITUTION) * vn * ny;
          }
          b.vx += (Math.random() - 0.5) * 70;
          const g = Math.round((meta.gold + tinyWorthAdd()) * tinyValueMult() * unspentVpMult());
          addGold(g);
          state.floaters.push({
            x: tp.x, y: tp.y - 8,
            text: '+' + fmt(g) + 'g',
            crit: false,
            color: meta.red ? '#ff5a5a' : '#4fdc6a',
            life: 0,
          });
          meta.until = now + 5000;             // vanish for 5s, then fade back
        }
      }

      for (const am of activeMovers) {
        const xL = am.mv.x - MOVER_LEN / 2, xR = am.mv.x + MOVER_LEN / 2;
        const nearestX = Math.max(xL, Math.min(b.x, xR));
        const nearestY = Math.max(am.y - MOVER_T / 2, Math.min(b.y, am.y + MOVER_T / 2));
        const dx = b.x - nearestX, dy = b.y - nearestY;
        const d2 = dx * dx + dy * dy;
        if (d2 < BALL_R * BALL_R) {
          const d = Math.sqrt(d2) || 0.0001;
          const nx = d2 > 0.0001 ? dx / d : 0;
          const ny = d2 > 0.0001 ? dy / d : -1;
          b.x = nearestX + nx * BALL_R;
          b.y = nearestY + ny * BALL_R;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= 1.9 * vn * nx;
            b.vy -= 1.9 * vn * ny;
          }
          b.vx += am.mv.vx * 0.35 + (Math.random() - 0.5) * 110;
          // Only a top-of-bar hit (ball above it) triggers low gravity.
          if (state.upg.lowGrav >= 1 && ny < -0.3 &&
              now >= (b.lowGravCdUntil || 0) && now >= (b.moonImmuneUntil || 0)) {
            b.lowGravUntil = now + 1000;
            b.lowGravCdUntil = now + 10000;
          }
        }
      }

      if (b.x - BALL_R < 0) { b.x = BALL_R; b.vx = Math.abs(b.vx) * WALL_RESTITUTION; }
      if (b.x + BALL_R > W) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx) * WALL_RESTITUTION; }
      {
        // Zig-zag ceiling: triangle tips point down; the tip bounces harder.
        const half = CEIL_TOOTH / 2;
        const lx = ((b.x % CEIL_TOOTH) + CEIL_TOOTH) % CEIL_TOOTH;
        const offset = Math.abs(lx - half);          // 0 at the point
        const surfaceY = CEIL_Y * (1 - offset / half);
        if (b.y - BALL_R < surfaceY) {
          b.y = surfaceY + BALL_R;
          if (b.vy < 0) {
            const atPoint = offset < CEIL_TOOTH * 0.22;
            b.vy = -b.vy * (atPoint ? 1.3 : WALL_RESTITUTION);
            if (atPoint) b.vx += (Math.random() - 0.5) * 130;     // hard scatter
            else b.vx += (lx < half ? -1 : 1) * 60;               // slide off slope
          }
        }
      }

      // Score the instant the ball enters the slot (or if it ever gets stuck)
      if (!b.done && (b.y + BALL_R >= chamberTop || b.age > 14)) {
        const idx = Math.min(n - 1, Math.max(0, Math.floor(b.x / cw)));
        let value = values[idx] * b.mult;
        const isCrit = Math.random() < critChance();
        if (isCrit) value = Math.ceil(value * 1.1);
        if (state.upg.airtime >= 1) {
          const airMult = 1 + 0.10 * state.upg.airtimePlus;
          // +50g cap at 20s aloft, scaled linearly (2.5g/s)
          value += Math.round(Math.min(50, b.age * 2.5) * airMult);
        }
        value = Math.round(value * unspentVpMult());   // unspent VP: +10%/VP
        addGold(value);
        sfx('score');
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

    // Ball-to-ball collisions (equal mass, springy).
    const bs = state.balls;
    const minD = 2 * BALL_R;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.done) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const c = bs[j];
        if (c.done) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const overlap = (minD - d) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        c.x += nx * overlap; c.y += ny * overlap;
        const rvn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rvn < 0) {
          const imp = -(1 + 0.9) * rvn / 2;     // equal mass, e=0.9
          a.vx -= imp * nx; a.vy -= imp * ny;
          c.vx += imp * nx; c.vy += imp * ny;
        }
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
    ctx.restore();
  }

  function triPath(cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.85);
    ctx.lineTo(cx - r, cy + r * 0.85);
    ctx.closePath();
  }

  function drawBoard() {
    const { pegs, tinies, n, cw, values, chamberTop, floorY } = LO;
    const now = performance.now();

    const spin = pegSpinAngle();
    for (let pi = 0; pi < pegs.length; pi++) {
      const p = pegs[pi];
      const gold = pi === goldPegIdx;
      ctx.save();
      ctx.translate(p.x, p.y);
      if (spin) ctx.rotate(spin);
      const g = ctx.createLinearGradient(0, -PEG_R, 0, PEG_R);
      if (gold) { g.addColorStop(0, '#fff3b0'); g.addColorStop(1, '#e0a51e'); }
      else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#8a92b8'); }
      ctx.fillStyle = g;
      if (gold) { ctx.shadowColor = '#ffd75a'; ctx.shadowBlur = 14; }
      triPath(0, 0, PEG_R); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = gold ? '#a8780f' : '#4a517a';
      ctx.lineWidth = gold ? 2 : 1; ctx.stroke();
      ctx.restore();
    }

    for (const tp of tinies) {
      const m = tinyMeta(tp.id);
      if (m.until && now < m.until) continue;             // hidden
      const alpha = m.until ? Math.min(1, (now - m.until) / 600) : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = m.red ? '#ff5a5a' : '#4fdc6a';
      triPath(tp.x, tp.y, tp.r);
      ctx.fill();
      ctx.strokeStyle = m.red ? '#a82020' : '#1f8a3b';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const am of moverList()) {
      const x = am.mv.x - MOVER_LEN / 2;
      const g = ctx.createLinearGradient(x, 0, x + MOVER_LEN, 0);
      g.addColorStop(0, '#3fe0e0');
      g.addColorStop(0.5, '#7af7f7');
      g.addColorStop(1, '#3fe0e0');
      ctx.fillStyle = g;
      roundRect(ctx, x, am.y - MOVER_T / 2, MOVER_LEN, MOVER_T, MOVER_T / 2);
      ctx.fill();
      ctx.strokeStyle = '#1f8a8a';
      ctx.lineWidth = 1; ctx.stroke();
    }

    ctx.fillStyle = '#1b2038';
    ctx.fillRect(0, chamberTop, W, CHAMBER_H);
    ctx.fillStyle = '#3a4070';
    ctx.fillRect(0, chamberTop, W, 2);
    for (let i = 1; i < n; i++) ctx.fillRect(i * cw - 1, chamberTop, 2, CHAMBER_H);
    ctx.fillRect(0, floorY, W, 3);

    const maxBase = Math.max(...values) / chamberMultiplier();
    const fs = Math.max(7, Math.min(13, Math.round(cw * 0.42)));
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = chamberTop + CHAMBER_H / 2;
    for (let i = 0; i < n; i++) {
      const cx = i * cw + cw / 2;
      const v = values[i];
      const ratio = (v / chamberMultiplier()) / maxBase; // 1 center .. low edge
      ctx.fillStyle = ratio > 0.66 ? '#f5c842' : ratio > 0.33 ? '#86d6ff' : '#9aa0c8';
      ctx.fillText(cw >= 40 ? fmtShort(v) + 'g' : fmtShort(v), cx, cy);
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

  function drawCeiling() {
    ctx.fillStyle = '#0e1122';
    ctx.fillRect(0, 0, W, CEIL_Y);
    const cols = Math.ceil(W / CEIL_TOOTH);
    for (let i = 0; i < cols; i++) {
      const x0 = i * CEIL_TOOTH;
      const g = ctx.createLinearGradient(0, 0, 0, CEIL_Y);
      g.addColorStop(0, '#9aa0c8');
      g.addColorStop(1, '#5a6090');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0 + CEIL_TOOTH, 0);
      ctx.lineTo(x0 + CEIL_TOOTH / 2, CEIL_Y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3a4070';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawCoin();
    drawCooldownBar();
    drawBoard();
    drawBalls();
    drawFloaters();
    drawCeiling();
  }

  function syncHud() {
    goldDisplay.textContent = fmt(state.gold) + 'g';
    menuBtn.hidden = state.maxGold < 10;
    if (!menuBtn.hidden) updateMenuBadge();
    checkPrestigeUnlock();
    voidBtn.hidden = !state.prestigeUnlocked;
    ffBtn.hidden = state.vpUpg.fastFwd < 1;
    if (!settingsOverlay.hidden) dbgGoldNow.textContent = fmt(state.gold) + 'g';
  }

  let last = 0;
  function loop(t) {
    if (!last) last = t;
    const dt = Math.min(0.033, (t - last) / 1000);
    last = t;
    LO = computeLayout();
    const iterations = state.fastForward ? 2 : 1;
    for (let s = 0; s < iterations; s++) step(dt);
    render();
    syncHud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
