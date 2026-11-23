(() => {
  'use strict';

  // ============================================================
  // 1. MATTER.JS ALIASES & CORE CONSTANTS
  // ============================================================
  const { Engine, World, Bodies, Body, Events, Vertices } = Matter;

  const W = 480;
  const H = 820;
  const PLAY_CX = 217; // Center of playfield (between x=18 and x=416)
  const BALL_RADIUS = 11;

  const SUBSTEPS = 4;
  const FIXED_FRAME_MS = 1000 / 60;
  const SUBSTEP_DT = FIXED_FRAME_MS / SUBSTEPS;
  const GRAVITY_Y = 1.05;
  const MAX_FRAME_SPEED = 38.0;

  const ARCH_CX = 240;
  const ARCH_CY = 240;
  const ARCH_R = 222;
  const INNER_GUIDE_R = 182;

  const PLUNGER_X = 445;
  const PLUNGER_REST_Y = 742;
  const PLUNGER_MAX_PULL = 48;

  const STORAGE_KEY = 'neon_pinball_highscore_v1';

  const COLORS = {
    cyan: '#00f0ff',
    magenta: '#ff2a85',
    amber: '#ffb800',
    violet: '#9b5cff',
    white: '#f2fbff',
    bgTop: '#0b1026',
    bgBottom: '#050814'
  };

  // ============================================================
  // 2. WEB AUDIO SYNTHESIZED ARCADE SOUND ENGINE
  // ============================================================
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.lastWallTime = 0;
      this.lastTickCharge = 0;
      this.bumperNoteIdx = 0;
    }

    unlock() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    toggleMute() {
      this.muted = !this.muted;
      return this.muted;
    }

    _canPlay() {
      return !this.muted && this.ctx && this.ctx.state === 'running';
    }

    _tone({ type = 'sine', freqStart = 440, freqEnd = 440, duration = 0.1, gain = 0.15, delay = 0 }) {
      if (!this._canPlay()) return;
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freqStart), now);
      if (freqEnd !== freqStart) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
      }
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(env);
      env.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    }

    _noise({ duration = 0.04, gain = 0.08, highpass = 1200 }) {
      if (!this._canPlay()) return;
      const now = this.ctx.currentTime;
      const bufferSize = Math.floor(this.ctx.sampleRate * duration);
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(highpass, now);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(gain, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      src.connect(filter);
      filter.connect(env);
      env.connect(this.ctx.destination);
      src.start(now);
    }

    flipperUp() {
      this._tone({ type: 'triangle', freqStart: 240, freqEnd: 75, duration: 0.055, gain: 0.16 });
      this._noise({ duration: 0.03, gain: 0.06, highpass: 1400 });
    }

    flipperDown() {
      this._tone({ type: 'triangle', freqStart: 130, freqEnd: 58, duration: 0.038, gain: 0.07 });
    }

    bumper() {
      const pentatonic = [330, 392, 440, 523.25, 587.33, 659.25];
      const base = pentatonic[this.bumperNoteIdx % pentatonic.length];
      this.bumperNoteIdx++;
      this._tone({ type: 'square', freqStart: base * 1.4, freqEnd: base * 0.72, duration: 0.095, gain: 0.11 });
      this._tone({ type: 'sine', freqStart: base * 2, freqEnd: base * 1.5, duration: 0.12, gain: 0.09 });
    }

    slingshot() {
      this._tone({ type: 'sawtooth', freqStart: 420, freqEnd: 150, duration: 0.085, gain: 0.11 });
      this._tone({ type: 'triangle', freqStart: 780, freqEnd: 320, duration: 0.055, gain: 0.08 });
    }

    targetLit(litCount) {
      const notes = [523.25, 659.25, 783.99];
      const f = notes[Math.min(litCount - 1, notes.length - 1)] || 523.25;
      this._tone({ type: 'triangle', freqStart: f, freqEnd: f * 1.02, duration: 0.15, gain: 0.15 });
      this._tone({ type: 'sine', freqStart: f * 2, freqEnd: f * 2, duration: 0.12, gain: 0.07 });
    }

    targetBankBonus() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, idx) => {
        this._tone({ type: 'triangle', freqStart: f, freqEnd: f, duration: 0.16, gain: 0.14, delay: idx * 0.065 });
        this._tone({ type: 'sine', freqStart: f * 1.5, freqEnd: f * 1.5, duration: 0.14, gain: 0.06, delay: idx * 0.065 });
      });
    }

    plungerChargeTick(charge) {
      if (Math.abs(charge - this.lastTickCharge) >= 0.11) {
        this.lastTickCharge = charge;
        const freq = 180 + charge * 320;
        this._tone({ type: 'square', freqStart: freq, freqEnd: freq * 0.9, duration: 0.022, gain: 0.04 });
      }
    }

    plungerRelease(charge) {
      this.lastTickCharge = 0;
      const startF = 110 + charge * 90;
      const endF = 340 + charge * 420;
      this._tone({ type: 'sawtooth', freqStart: startF, freqEnd: endF, duration: 0.16, gain: 0.13 });
      this._tone({ type: 'triangle', freqStart: 180, freqEnd: 60, duration: 0.08, gain: 0.12 });
    }

    wallHit(speed) {
      if (!this._canPlay()) return;
      const now = performance.now();
      if (now - this.lastWallTime < 55 || speed < 4.5) return;
      this.lastWallTime = now;
      const g = Math.min(0.07, (speed - 4) * 0.0045);
      this._tone({ type: 'sine', freqStart: 220 + speed * 14, freqEnd: 140, duration: 0.035, gain: g });
    }

    ballDrain() {
      this._tone({ type: 'sawtooth', freqStart: 360, freqEnd: 78, duration: 0.42, gain: 0.13 });
      this._tone({ type: 'triangle', freqStart: 240, freqEnd: 62, duration: 0.48, gain: 0.11, delay: 0.04 });
    }

    gameStart() {
      const notes = [330, 440, 554.37, 659.25];
      notes.forEach((f, idx) => {
        this._tone({ type: 'triangle', freqStart: f, freqEnd: f, duration: 0.11, gain: 0.12, delay: idx * 0.055 });
      });
    }

    gameOver() {
      const notes = [392, 349.23, 311.13, 261.63];
      notes.forEach((f, idx) => {
        this._tone({ type: 'sawtooth', freqStart: f, freqEnd: f * 0.96, duration: 0.22, gain: 0.1, delay: idx * 0.14 });
      });
    }
  }

  // ============================================================
  // 3. DOM REFERENCES & CANVAS SETUP
  // ============================================================
  const canvas = document.getElementById('pinball-canvas');
  const ctx = canvas.getContext('2d');

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const ui = {
    score: document.getElementById('score-display'),
    best: document.getElementById('best-display'),
    mult: document.getElementById('mult-display'),
    comboBar: document.getElementById('combo-bar'),
    balls: document.getElementById('balls-display'),
    muteBtn: document.getElementById('mute-btn'),
    muteIcon: document.getElementById('mute-icon'),
    startOverlay: document.getElementById('start-overlay'),
    startBestVal: document.getElementById('start-best-val'),
    startBtn: document.getElementById('start-btn'),
    gameoverOverlay: document.getElementById('gameover-overlay'),
    newRecordBadge: document.getElementById('new-record-badge'),
    finalScore: document.getElementById('final-score'),
    finalBest: document.getElementById('final-best'),
    finalCombo: document.getElementById('final-combo'),
    finalMult: document.getElementById('final-mult'),
    restartBtn: document.getElementById('restart-btn'),
    keyLeft: document.getElementById('key-left'),
    keyRight: document.getElementById('key-right'),
    keySpace: document.getElementById('key-space'),
    keyMute: document.getElementById('key-mute')
  };

  const sound = new SoundEngine();

  // ============================================================
  // 4. GEOMETRY HELPERS FOR CONVEX MATTER.JS BODIES
  // ============================================================
  function buildTaperedCapsuleVertices(length, rPivot, rTip, dir) {
    // Pivot at (0, 0), tip at (dir * length, 0). Strictly convex polygon.
    const pts = [];
    const steps = 8;

    if (dir > 0) {
      // Right semicircle at tip (+length, 0), from -PI/2 to +PI/2
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / steps;
        pts.push({ x: length + Math.cos(a) * rTip, y: Math.sin(a) * rTip });
      }
      // Left semicircle at pivot (0, 0), from +PI/2 to +3*PI/2
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / steps;
        pts.push({ x: Math.cos(a) * rPivot, y: Math.sin(a) * rPivot });
      }
    } else {
      // Right semicircle at pivot (0, 0), from -PI/2 to +PI/2
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / steps;
        pts.push({ x: Math.cos(a) * rPivot, y: Math.sin(a) * rPivot });
      }
      // Left semicircle at tip (-length, 0), from +PI/2 to +3*PI/2
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI / 2 + (Math.PI * i) / steps;
        pts.push({ x: -length + Math.cos(a) * rTip, y: Math.sin(a) * rTip });
      }
    }

    return Vertices.clockwiseSort(pts);
  }

  function buildRoundedTriangleVertices(points, radius) {
    // Expand each corner smoothly by sampling arcs around the 3 vertices.
    // Returns strictly convex hull points.
    const raw = [];
    const samples = 6;
    for (const p of points) {
      for (let i = 0; i < samples; i++) {
        const a = (Math.PI * 2 * i) / samples;
        raw.push({ x: p.x + Math.cos(a) * radius, y: p.y + Math.sin(a) * radius });
      }
    }
    return Vertices.hull(raw);
  }

  function createSegmentWall(x1, y1, x2, y2, thickness, options = {}) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, len, thickness, {
      isStatic: true,
      angle,
      restitution: 0.45,
      friction: 0.01,
      label: 'wall',
      ...options
    });
  }

  // ============================================================
  // 5. GAME STATE & TABLE OBJECTS
  // ============================================================
  const engine = Engine.create({
    positionIterations: 10,
    velocityIterations: 8
  });
  engine.gravity.x = 0;
  engine.gravity.y = GRAVITY_Y;
  engine.gravity.scale = 0.001;

  const world = engine.world;

  const state = {
    phase: 'start', // 'start' | 'playing' | 'respawning' | 'gameover'
    score: 0,
    highScore: loadHighScore(),
    newRecord: false,
    ballsLeft: 3,
    baseMultiplier: 1,
    comboCount: 0,
    maxCombo: 0,
    maxMultiplier: 1,
    comboTimer: 0,
    comboDuration: 2.4,
    respawnTimer: 0,
    bannerText: '',
    bannerSub: '',
    bannerTimer: 0,
    shakeTime: 0,
    shakeIntensity: 0,
    wallFlash: 0,
    plungerCharge: 0,
    plungerSpringVisual: 0,
    gateClosed: false,
    gateSwing: 0,
    inShooterLane: true,
    stallTimer: 0,
    time: 0
  };

  const input = {
    left: false,
    right: false,
    space: false,
    prevLeft: false,
    prevRight: false,
    prevSpace: false
  };

  // Visual effects pools
  const ballTrail = [];
  const particles = [];
  const rings = [];
  const popups = [];

  // Interactive table entities
  let ball = null;
  let plungerBody = null;
  let gateBody = null;
  let gateMeta = null;
  const bumpers = [];
  const slingshots = [];
  const topTargets = [];
  const laneFins = [];
  const sideDeflectors = [];
  const flippers = {};

  function loadHighScore() {
    try {
      const val = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      return Number.isFinite(val) && val > 0 ? val : 0;
    } catch {
      return 0;
    }
  }

  function saveHighScore(val) {
    try {
      localStorage.setItem(STORAGE_KEY, String(val));
    } catch {
      // Ignore storage quota / private mode errors
    }
  }

  // ============================================================
  // 6. BUILD PINBALL TABLE GEOMETRY (480 x 820)
  // ============================================================
  function buildTable() {
    const wallBodies = [];

    // --- Outer thick structural walls (40px thick so ball can NEVER escape) ---
    // Left wall (inner edge x = 18)
    wallBodies.push(
      Bodies.rectangle(-2, 530, 40, 620, { isStatic: true, restitution: 0.45, friction: 0.008, label: 'wall' })
    );
    // Right outer wall (inner edge x = 462)
    wallBodies.push(
      Bodies.rectangle(482, 530, 40, 620, { isStatic: true, restitution: 0.45, friction: 0.005, label: 'wall' })
    );
    // Top ceiling backup safety bar
    wallBodies.push(
      Bodies.rectangle(W / 2, -26, W + 80, 40, { isStatic: true, label: 'wall' })
    );
    // Shooter lane bottom floor (top surface y = 804)
    wallBodies.push(
      Bodies.rectangle(448, 824, 68, 40, { isStatic: true, restitution: 0.2, friction: 0.05, label: 'wall' })
    );

    // --- Smooth Top Arch (semicircle center (240, 240), inner radius 222) ---
    const archSegs = 28;
    const archThick = 40;
    for (let i = 0; i < archSegs; i++) {
      const a1 = Math.PI + (Math.PI * i) / archSegs;
      const a2 = Math.PI + (Math.PI * (i + 1)) / archSegs;
      const midA = (a1 + a2) / 2;
      const rMid = ARCH_R + archThick / 2;
      const segLen = 2 * ARCH_R * Math.sin(Math.PI / (2 * archSegs)) + 6;
      const cx = ARCH_CX + Math.cos(midA) * rMid;
      const cy = ARCH_CY + Math.sin(midA) * rMid;
      wallBodies.push(
        Bodies.rectangle(cx, cy, segLen, archThick, {
          isStatic: true,
          angle: midA + Math.PI / 2,
          restitution: 0.42,
          friction: 0.004,
          label: 'wall'
        })
      );
    }

    // --- Shooter Lane Divider Wall (x = 416..428, center 422, from y = 240 to 824) ---
    wallBodies.push(
      Bodies.rectangle(422, 532, 12, 584, {
        isStatic: true,
        restitution: 0.42,
        friction: 0.006,
        label: 'wall'
      })
    );

    // --- Concentric Inner Shooter Guide Arc (from angle 0 up to -0.58 rad) ---
    const guideSegs = 8;
    const guideEndAngle = -0.58;
    for (let i = 0; i < guideSegs; i++) {
      const a1 = (guideEndAngle * i) / guideSegs;
      const a2 = (guideEndAngle * (i + 1)) / guideSegs;
      const midA = (a1 + a2) / 2;
      const segLen = Math.abs(a2 - a1) * INNER_GUIDE_R + 4;
      const cx = ARCH_CX + Math.cos(midA) * INNER_GUIDE_R;
      const cy = ARCH_CY + Math.sin(midA) * INNER_GUIDE_R;
      wallBodies.push(
        Bodies.rectangle(cx, cy, 12, segLen, {
          isStatic: true,
          angle: midA,
          restitution: 0.42,
          friction: 0.005,
          label: 'wall'
        })
      );
    }
    // Rounded cap at top tip of inner shooter guide
    const guideTipX = ARCH_CX + Math.cos(guideEndAngle) * INNER_GUIDE_R;
    const guideTipY = ARCH_CY + Math.sin(guideEndAngle) * INNER_GUIDE_R;
    wallBodies.push(
      Bodies.circle(guideTipX, guideTipY, 6, {
        isStatic: true,
        restitution: 0.45,
        friction: 0.005,
        label: 'wall'
      })
    );

    // --- One-Way Gate at top of Shooter Lane ---
    const outerGateAngle = -0.68;
    const gOuterX = ARCH_CX + Math.cos(outerGateAngle) * ARCH_R;
    const gOuterY = ARCH_CY + Math.sin(outerGateAngle) * ARCH_R;
    const gDx = gOuterX - guideTipX;
    const gDy = gOuterY - guideTipY;
    const gLen = Math.hypot(gDx, gDy);
    const gAngle = Math.atan2(gDy, gDx);
    const gMidX = (guideTipX + gOuterX) / 2;
    const gMidY = (guideTipY + gOuterY) / 2;
    // Outward normal pointing UP-LEFT into the main playfield
    const gNormX = gDy / gLen;
    const gNormY = -gDx / gLen;

    gateMeta = {
      x1: guideTipX,
      y1: guideTipY,
      x2: gOuterX,
      y2: gOuterY,
      midX: gMidX,
      midY: gMidY,
      nx: gNormX,
      ny: gNormY
    };

    gateBody = Bodies.rectangle(gMidX, gMidY, gLen + 6, 8, {
      isStatic: true,
      isSensor: true, // Starts open while ball is in shooter lane
      angle: gAngle,
      restitution: 0.45,
      friction: 0.01,
      label: 'gate'
    });
    wallBodies.push(gateBody);

    // --- Top Lane Divider Fins (4 slim rounded fins forming 3 target lanes) ---
    const finXs = [132, 189, 245, 302];
    const finTop = 94;
    const finBot = 142;
    for (const fx of finXs) {
      laneFins.push({ x: fx, top: finTop, bot: finBot, r: 5, flash: 0 });
      wallBodies.push(
        Bodies.rectangle(fx, (finTop + finBot) / 2, 10, finBot - finTop, {
          isStatic: true,
          restitution: 0.5,
          friction: 0.01,
          label: 'fin'
        }),
        Bodies.circle(fx, finTop, 5, { isStatic: true, restitution: 0.5, label: 'fin' }),
        Bodies.circle(fx, finBot, 5, { isStatic: true, restitution: 0.5, label: 'fin' })
      );
    }

    // --- 3 Illuminable Top Targets (Rollover Sensors) ---
    const targetXs = [160.5, 217, 273.5];
    const targetLabels = ['N', 'E', 'O'];
    targetXs.forEach((tx, idx) => {
      const body = Bodies.circle(tx, 118, 15, {
        isStatic: true,
        isSensor: true,
        label: 'target'
      });
      body.targetIndex = idx;
      topTargets.push({
        id: idx,
        x: tx,
        y: 118,
        r: 14,
        char: targetLabels[idx],
        lit: false,
        flash: 0,
        cooldown: 0,
        body
      });
      wallBodies.push(body);
    });

    // --- 4 Circular Pop Bumpers (Strong Radial Impulse) ---
    const bumperSpecs = [
      { x: PLAY_CX, y: 232, r: 24, color: COLORS.magenta, kick: 14.8, points: 150 },
      { x: 132, y: 308, r: 24, color: COLORS.cyan, kick: 14.8, points: 150 },
      { x: 302, y: 308, r: 24, color: COLORS.cyan, kick: 14.8, points: 150 },
      { x: PLAY_CX, y: 384, r: 22, color: COLORS.amber, kick: 15.2, points: 200 }
    ];
    bumperSpecs.forEach((spec, idx) => {
      const body = Bodies.circle(spec.x, spec.y, spec.r, {
        isStatic: true,
        restitution: 0.9,
        friction: 0,
        label: 'bumper'
      });
      body.bumperIndex = idx;
      bumpers.push({
        ...spec,
        flash: 0,
        scale: 1,
        body
      });
      wallBodies.push(body);
    });

    // --- Mid-table Angled Side Deflectors (zero flat surfaces, lively rebound) ---
    const leftDefPts = [
      { x: 18, y: 422 },
      { x: 46, y: 462 },
      { x: 18, y: 502 }
    ];
    const rightDefPts = [
      { x: 416, y: 422 },
      { x: 416, y: 502 },
      { x: 388, y: 462 }
    ];
    [
      { pts: leftDefPts, side: 'left', color: COLORS.cyan },
      { pts: rightDefPts, side: 'right', color: COLORS.cyan }
    ].forEach((def, idx) => {
      const centre = Vertices.centre(def.pts);
      const body = Bodies.fromVertices(centre.x, centre.y, [def.pts], {
        isStatic: true,
        restitution: 0.65,
        friction: 0.01,
        label: 'deflector'
      });
      body.deflectorIndex = idx;
      sideDeflectors.push({ ...def, flash: 0, body });
      wallBodies.push(body);
    });

    // --- 2 Triangular Slingshots Above the Flippers ---
    const leftSlingPts = [
      { x: 64, y: 536 },
      { x: 64, y: 626 },
      { x: 122, y: 654 }
    ];
    const rightSlingPts = [
      { x: 370, y: 536 },
      { x: 370, y: 626 },
      { x: 312, y: 654 }
    ];

    const slingDefs = [
      {
        pts: leftSlingPts,
        side: 'left',
        kickA: leftSlingPts[0],
        kickB: leftSlingPts[2],
        // Outward normal from A(64,536)->C(122,654) pointing UP-RIGHT
        nx: 0.898,
        ny: -0.44,
        color: COLORS.magenta
      },
      {
        pts: rightSlingPts,
        side: 'right',
        kickA: rightSlingPts[0],
        kickB: rightSlingPts[2],
        // Outward normal from A(370,536)->C(312,654) pointing UP-LEFT
        nx: -0.898,
        ny: -0.44,
        color: COLORS.magenta
      }
    ];

    slingDefs.forEach((def, idx) => {
      const hull = buildRoundedTriangleVertices(def.pts, 6);
      const centre = Vertices.centre(hull);
      const body = Bodies.fromVertices(centre.x, centre.y, [hull], {
        isStatic: true,
        restitution: 0.7,
        friction: 0.01,
        label: 'slingshot'
      });
      body.slingshotIndex = idx;
      slingshots.push({
        ...def,
        hull,
        flash: 0,
        body
      });
      wallBodies.push(body);
    });

    // --- Apron Guide Rails (aligning seamlessly with flipper upper surfaces) ---
    // Left apron: top edge runs from (18, 664) to (125, 715)
    const leftApronPts = [
      { x: 18, y: 664 },
      { x: 124, y: 715 },
      { x: 124, y: 740 },
      { x: 18, y: 726 }
    ];
    const leftApronC = Vertices.centre(leftApronPts);
    wallBodies.push(
      Bodies.fromVertices(leftApronC.x, leftApronC.y, [leftApronPts], {
        isStatic: true,
        restitution: 0.25,
        friction: 0.008,
        label: 'apron'
      })
    );

    // Right apron: mirrored around PLAY_CX = 217 -> (416, 664) to (310, 715)
    const rightApronPts = [
      { x: 416, y: 664 },
      { x: 416, y: 726 },
      { x: 310, y: 740 },
      { x: 310, y: 715 }
    ];
    const rightApronC = Vertices.centre(rightApronPts);
    wallBodies.push(
      Bodies.fromVertices(rightApronC.x, rightApronC.y, [rightApronPts], {
        isStatic: true,
        restitution: 0.25,
        friction: 0.008,
        label: 'apron'
      })
    );

    // Lower drain side skirts (below aprons so missed ball exits cleanly down center)
    wallBodies.push(
      createSegmentWall(18, 720, 148, 822, 18, { label: 'apron' }),
      createSegmentWall(416, 720, 286, 822, 18, { label: 'apron' })
    );

    // --- Plunger Physics Head (in right launch channel) ---
    plungerBody = Bodies.rectangle(PLUNGER_X, PLUNGER_REST_Y + 8, 32, 16, {
      isStatic: true,
      restitution: 0.2,
      friction: 0.05,
      label: 'plunger'
    });
    wallBodies.push(plungerBody);

    // --- Left & Right Flippers (Kinematic Rigid Tapered Capsules) ---
    flippers.left = createFlipper({
      side: 'left',
      pivotX: 125,
      pivotY: 725,
      length: 72,
      rPivot: 10,
      rTip: 6,
      dir: 1,
      restAngle: 0.44,
      upAngle: -0.54,
      color: COLORS.cyan
    });

    flippers.right = createFlipper({
      side: 'right',
      pivotX: 309,
      pivotY: 725,
      length: 72,
      rPivot: 10,
      rTip: 6,
      dir: -1,
      restAngle: -0.44,
      upAngle: 0.54,
      color: COLORS.cyan
    });

    wallBodies.push(flippers.left.body, flippers.right.body);
    World.add(world, wallBodies);
  }

  function createFlipper(cfg) {
    const verts = buildTaperedCapsuleVertices(cfg.length, cfg.rPivot, cfg.rTip, cfg.dir);
    const centroid = Vertices.centre(verts);
    const body = Bodies.fromVertices(0, 0, [verts], {
      isStatic: true,
      restitution: 0.45,
      friction: 0.02,
      label: cfg.side === 'left' ? 'flipper_left' : 'flipper_right'
    });

    const flipper = {
      ...cfg,
      centroidX: centroid.x,
      centroidY: centroid.y,
      angle: cfg.restAngle,
      prevAngle: cfg.restAngle,
      angularSpeed: 0,
      isSwingingUp: false,
      hitCooldown: 0,
      glow: 0,
      body
    };

    positionFlipperBody(flipper, flipper.angle);
    return flipper;
  }

  function positionFlipperBody(flipper, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = flipper.pivotX + flipper.centroidX * cos - flipper.centroidY * sin;
    const cy = flipper.pivotY + flipper.centroidX * sin + flipper.centroidY * cos;
    Body.setAngle(flipper.body, angle);
    Body.setPosition(flipper.body, { x: cx, y: cy });
  }

  // ============================================================
  // 7. BALL MANAGEMENT & VELOCITY HELPERS
  // ============================================================
  function setBallFrameVelocity(vxFrame, vyFrame) {
    if (!ball) return;
    if (typeof Body.getVelocity === 'function') {
      Body.setVelocity(ball, { x: vxFrame, y: vyFrame });
    } else {
      Body.setVelocity(ball, {
        x: vxFrame / SUBSTEPS,
        y: vyFrame / SUBSTEPS
      });
    }
  }

  function getBallFrameVelocity() {
    if (!ball) return { x: 0, y: 0, speed: 0 };
    if (typeof Body.getVelocity === 'function') {
      const v = Body.getVelocity(ball);
      return { x: v.x, y: v.y, speed: Math.hypot(v.x, v.y) };
    }
    const vx = ball.velocity.x * SUBSTEPS;
    const vy = ball.velocity.y * SUBSTEPS;
    return { x: vx, y: vy, speed: Math.hypot(vx, vy) };
  }

  function spawnBall() {
    if (ball) {
      World.remove(world, ball);
    }
    ball = Bodies.circle(PLUNGER_X, PLUNGER_REST_Y - BALL_RADIUS - 3, BALL_RADIUS, {
      restitution: 0.46,
      friction: 0.002,
      frictionAir: 0.00045,
      density: 0.004,
      slop: 0.01,
      label: 'ball'
    });
    World.add(world, ball);

    ballTrail.length = 0;
    state.inShooterLane = true;
    state.gateClosed = false;
    state.gateSwing = 0;
    state.plungerCharge = 0;
    state.stallTimer = 0;
    if (gateBody) {
      gateBody.isSensor = true;
    }
    updatePlungerPosition(0);
  }

  function updatePlungerPosition(charge) {
    if (!plungerBody) return;
    const topY = PLUNGER_REST_Y + charge * PLUNGER_MAX_PULL;
    Body.setPosition(plungerBody, { x: PLUNGER_X, y: topY + 8 });
  }

  // ============================================================
  // 8. SCORING, COMBOS & VISUAL JUICE
  // ============================================================
  function getActiveMultiplier() {
    const comboExtra = Math.floor(state.comboCount / 5);
    return Math.min(10, state.baseMultiplier + comboExtra);
  }

  function addScore(basePoints, x, y, color = COLORS.cyan, incrementCombo = true) {
    if (state.phase !== 'playing') return;

    if (incrementCombo) {
      state.comboCount++;
      state.comboTimer = state.comboDuration;
      if (state.comboCount > state.maxCombo) {
        state.maxCombo = state.comboCount;
      }
    }

    const mult = getActiveMultiplier();
    if (mult > state.maxMultiplier) {
      state.maxMultiplier = mult;
    }

    const gained = Math.round(basePoints * mult);
    state.score += gained;

    if (state.score > state.highScore) {
      state.highScore = state.score;
      state.newRecord = true;
      saveHighScore(state.highScore);
    }

    popups.push({
      x,
      y,
      text: `+${gained}`,
      color,
      life: 1.0,
      scale: gained >= 1000 ? 1.35 : 1.0
    });

    if (incrementCombo && state.comboCount > 0 && state.comboCount % 5 === 0) {
      popups.push({
        x: PLAY_CX,
        y: Math.max(150, y - 34),
        text: `COMBO x${state.comboCount}!`,
        color: COLORS.amber,
        life: 1.25,
        scale: 1.25
      });
    }

    syncHUD();
  }

  function spawnParticles(x, y, color, count = 14, speedMin = 1.6, speedMax = 6.2) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speedMin + Math.random() * (speedMax - speedMin);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        size: 1.8 + Math.random() * 2.8,
        color,
        life: 1.0,
        decay: 0.022 + Math.random() * 0.025
      });
    }
  }

  function spawnRing(x, y, color, startR = 14, endR = 64) {
    rings.push({
      x,
      y,
      color,
      r: startR,
      endR,
      life: 1.0
    });
  }

  function triggerShake(intensity = 4, duration = 0.14) {
    state.shakeIntensity = Math.max(state.shakeIntensity, intensity);
    state.shakeTime = Math.max(state.shakeTime, duration);
  }

  function showBanner(text, sub = '', duration = 1.4) {
    state.bannerText = text;
    state.bannerSub = sub;
    state.bannerTimer = duration;
  }

  // ============================================================
  // 9. COLLISION EVENTS (BUMPERS, SLINGSHOTS, TARGETS, FLIPPERS)
  // ============================================================
  Events.on(engine, 'collisionStart', (event) => {
    if (!ball) return;

    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA !== ball && bodyB !== ball) continue;
      const other = bodyA === ball ? bodyB : bodyA;
      const label = other.label;

      // 1. Pop Bumpers
      if (label === 'bumper') {
        const bumper = bumpers[other.bumperIndex];
        if (!bumper) continue;

        const dx = ball.position.x - bumper.x;
        const dy = ball.position.y - bumper.y;
        const dist = Math.hypot(dx, dy) || 1;
        // Tiny angular jitter prevents infinite straight-line ping-pong loops
        const jitter = (Math.random() - 0.5) * 0.12;
        const baseAngle = Math.atan2(dy, dx) + jitter;
        const nx = Math.cos(baseAngle);
        const ny = Math.sin(baseAngle);

        setBallFrameVelocity(nx * bumper.kick, ny * bumper.kick);

        bumper.flash = 1.0;
        bumper.scale = 1.24;
        spawnParticles(
          bumper.x + nx * bumper.r,
          bumper.y + ny * bumper.r,
          bumper.color,
          18,
          2.0,
          6.8
        );
        spawnRing(bumper.x, bumper.y, bumper.color, bumper.r, bumper.r + 44);
        triggerShake(4.2, 0.13);
        sound.bumper();
        addScore(bumper.points, bumper.x, bumper.y - bumper.r - 8, bumper.color, true);
        continue;
      }

      // 2. Triangular Slingshots
      if (label === 'slingshot') {
        const sling = slingshots[other.slingshotIndex];
        if (!sling) continue;

        const midX = (sling.kickA.x + sling.kickB.x) / 2;
        const midY = (sling.kickA.y + sling.kickB.y) / 2;
        const toBallX = ball.position.x - midX;
        const toBallY = ball.position.y - midY;
        const sideDot = toBallX * sling.nx + toBallY * sling.ny;

        // Fire active slingshot kick when struck on its diagonal face
        if (sideDot > -4) {
          const jitter = (Math.random() - 0.5) * 0.1;
          const kickAngle = Math.atan2(sling.ny, sling.nx) + jitter;
          const kickSpeed = 13.8;
          setBallFrameVelocity(Math.cos(kickAngle) * kickSpeed, Math.sin(kickAngle) * kickSpeed);

          sling.flash = 1.0;
          spawnParticles(ball.position.x, ball.position.y, sling.color, 15, 2.0, 6.2);
          spawnRing(ball.position.x, ball.position.y, sling.color, 10, 42);
          triggerShake(3.0, 0.1);
          sound.slingshot();
          addScore(100, ball.position.x, ball.position.y - 16, sling.color, true);
        }
        continue;
      }

      // 3. 3 Top Illuminable Targets
      if (label === 'target') {
        const target = topTargets[other.targetIndex];
        if (!target || target.cooldown > 0) continue;

        target.cooldown = 0.4;
        target.flash = 1.0;
        const wasLit = target.lit;
        target.lit = true;

        spawnParticles(target.x, target.y, COLORS.amber, 16, 1.8, 5.5);
        spawnRing(target.x, target.y, COLORS.amber, 10, 38);

        const litCount = topTargets.filter((t) => t.lit).length;
        addScore(wasLit ? 120 : 250, target.x, target.y - 18, COLORS.amber, true);

        if (litCount === topTargets.length) {
          // All 3 targets illuminated! Level up multiplier & big bonus
          state.baseMultiplier = Math.min(6, state.baseMultiplier + 1);
          addScore(1500, PLAY_CX, 165, COLORS.amber, false);
          showBanner(`MULTIPLICADOR x${getActiveMultiplier()}`, '¡OBJETIVOS COMPLETADOS!', 1.5);
          triggerShake(6.0, 0.22);
          sound.targetBankBonus();

          for (const t of topTargets) {
            spawnParticles(t.x, t.y, COLORS.cyan, 18, 2.2, 7.0);
            spawnRing(t.x, t.y, COLORS.cyan, 12, 54);
          }

          // Reset target lights after brief celebratory glow
          setTimeout(() => {
            if (state.phase === 'playing') {
              topTargets.forEach((t) => {
                t.lit = false;
                t.flash = 0.8;
              });
            }
          }, 550);
        } else {
          sound.targetLit(litCount);
        }
        continue;
      }

      // 4. Mid-table Side Deflectors
      if (label === 'deflector') {
        const def = sideDeflectors[other.deflectorIndex];
        if (def) {
          def.flash = 1.0;
          spawnParticles(ball.position.x, ball.position.y, def.color, 8, 1.4, 4.2);
          addScore(50, ball.position.x, ball.position.y - 12, def.color, false);
          sound.wallHit(10);
        }
        continue;
      }

      // 5. Flippers active hit boost
      if (label === 'flipper_left' || label === 'flipper_right') {
        const fl = label === 'flipper_left' ? flippers.left : flippers.right;
        handleFlipperImpact(fl);
        continue;
      }

      // 6. General wall clink
      if (label === 'wall' || label === 'fin' || label === 'gate' || label === 'apron') {
        const { speed } = getBallFrameVelocity();
        if (speed > 7) {
          state.wallFlash = Math.min(1, state.wallFlash + 0.25);
        }
        sound.wallHit(speed);
      }
    }
  });

  Events.on(engine, 'collisionActive', (event) => {
    if (!ball) return;
    for (const pair of event.pairs) {
      const { bodyA, bodyB } = pair;
      if (bodyA !== ball && bodyB !== ball) continue;
      const other = bodyA === ball ? bodyB : bodyA;
      if (other.label === 'flipper_left') {
        handleFlipperImpact(flippers.left);
      } else if (other.label === 'flipper_right') {
        handleFlipperImpact(flippers.right);
      }
    }
  });

  function handleFlipperImpact(fl) {
    if (!fl || !fl.isSwingingUp || fl.hitCooldown > 0 || !ball) return;

    const dx = ball.position.x - fl.pivotX;
    const dy = ball.position.y - fl.pivotY;
    // Exact upward normal for both left & right flippers
    const upX = Math.sin(fl.angle);
    const upY = -Math.cos(fl.angle);
    const sideDot = dx * upX + dy * upY;

    // Only apply upward launch boost when ball is on the top face of the flipper
    if (sideDot < -4) return;

    const dist = Math.hypot(dx, dy);
    const leverage = Math.max(0.25, Math.min(1.05, dist / fl.length));

    // Blend upward normal with current tangential velocity for authentic aiming
    const cur = getBallFrameVelocity();
    const tangentX = fl.dir * Math.cos(fl.angle);
    const tangentY = fl.dir * Math.sin(fl.angle);
    const tangentSpeed = cur.x * tangentX + cur.y * tangentY;

    const launchMag = 13.5 + leverage * 10.5;
    const vx = upX * launchMag + tangentX * (tangentSpeed * 0.45);
    const vy = upY * launchMag + tangentY * (tangentSpeed * 0.45);

    setBallFrameVelocity(vx, vy);
    fl.hitCooldown = 0.09;
    fl.glow = 1.0;

    spawnParticles(ball.position.x, ball.position.y, COLORS.cyan, 10, 1.5, 4.8);
  }

  // ============================================================
  // 10. PHYSICS STEP & GAMEPLAY LOOP
  // ============================================================
  function stepFlippers(subDtSec) {
    const upRatePerSubstep = 0.28 / SUBSTEPS;
    const downRatePerSubstep = 0.16 / SUBSTEPS;

    const list = [
      { fl: flippers.left, active: input.left },
      { fl: flippers.right, active: input.right }
    ];

    for (const { fl, active } of list) {
      if (fl.hitCooldown > 0) {
        fl.hitCooldown = Math.max(0, fl.hitCooldown - subDtSec);
      }

      const target = active ? fl.upAngle : fl.restAngle;
      const diff = target - fl.angle;
      const maxStep = active ? upRatePerSubstep : downRatePerSubstep;

      const prevAngle = fl.angle;
      const prevPos = { x: fl.body.position.x, y: fl.body.position.y };

      let step = 0;
      if (Math.abs(diff) <= maxStep) {
        fl.angle = target;
        step = diff;
      } else {
        step = Math.sign(diff) * maxStep;
        fl.angle += step;
      }

      positionFlipperBody(fl, fl.angle);

      const dx = fl.body.position.x - prevPos.x;
      const dy = fl.body.position.y - prevPos.y;
      Body.setVelocity(fl.body, { x: dx, y: dy });
      Body.setAngularVelocity(fl.body, step);

      fl.prevAngle = prevAngle;
      fl.angularSpeed = step;
      fl.isSwingingUp = active && Math.abs(step) > 0.002;
      if (active) {
        fl.glow = Math.max(fl.glow, 0.55);
      }
    }
  }

  function stepPlungerAndGate(dtSec) {
    if (!ball || state.phase !== 'playing') return;

    const ballInChuteArea = ball.position.x > 422 && ball.position.y > 210;
    const nearPlunger = ball.position.x > 425 && ball.position.y > 665;

    if (state.inShooterLane) {
      if (input.space) {
        state.plungerCharge = Math.min(1, state.plungerCharge + dtSec * 1.15);
        state.plungerSpringVisual = state.plungerCharge;
        updatePlungerPosition(state.plungerCharge);
        sound.plungerChargeTick(state.plungerCharge);

        // Keep ball resting smoothly on plunger while charging
        if (nearPlunger) {
          const restingY = PLUNGER_REST_Y + state.plungerCharge * PLUNGER_MAX_PULL - BALL_RADIUS - 1;
          if (ball.position.y > restingY) {
            Body.setPosition(ball, { x: PLUNGER_X, y: restingY });
            Body.setVelocity(ball, { x: 0, y: 0 });
          }
        }
      } else if (input.prevSpace && state.plungerCharge > 0.01) {
        const charge = state.plungerCharge;
        state.plungerCharge = 0;

        if (nearPlunger || ballInChuteArea) {
          // Ensure ball is cleanly above the resting plunger head before snapping plunger up
          const launchY = Math.min(ball.position.y, PLUNGER_REST_Y - BALL_RADIUS - 3);
          Body.setPosition(ball, { x: PLUNGER_X, y: launchY });
          updatePlungerPosition(0);

          const launchSpeed = 20.0 + charge * 18.0;
          setBallFrameVelocity(0, -launchSpeed);
          spawnParticles(PLUNGER_X, PLUNGER_REST_Y - 6, COLORS.amber, 18, 2.0, 6.4);
          spawnRing(PLUNGER_X, PLUNGER_REST_Y - 8, COLORS.amber, 8, 40);
          sound.plungerRelease(charge);
        } else {
          updatePlungerPosition(0);
        }
      } else {
        state.plungerSpringVisual += (0 - state.plungerSpringVisual) * Math.min(1, dtSec * 18);
      }
    } else {
      state.plungerCharge = 0;
      state.plungerSpringVisual += (0 - state.plungerSpringVisual) * Math.min(1, dtSec * 14);
      updatePlungerPosition(0);
    }

    // One-way gate state machine
    if (!state.gateClosed && gateMeta) {
      const signedDist =
        (ball.position.x - gateMeta.midX) * gateMeta.nx +
        (ball.position.y - gateMeta.midY) * gateMeta.ny;

      // Visually swing flap open as ball zips past
      if (signedDist > -28 && signedDist < 24 && ball.position.y < 210 && ball.position.x > 365) {
        state.gateSwing = Math.min(1, state.gateSwing + dtSec * 16);
      } else {
        state.gateSwing = Math.max(0, state.gateSwing - dtSec * 8);
      }

      // Close gate solidly as soon as the ball has completely entered the playfield
      if (signedDist > BALL_RADIUS + 6 && ball.position.x < 406) {
        state.gateClosed = true;
        state.inShooterLane = false;
        gateBody.isSensor = false;
      }
    } else {
      state.gateSwing = Math.max(0, state.gateSwing - dtSec * 12);
    }
  }

  function clampBallVelocityAndBounds() {
    if (!ball) return;

    // Velocity clamp keeps per-substep displacement safely below BALL_RADIUS
    const vel = getBallFrameVelocity();
    if (vel.speed > MAX_FRAME_SPEED) {
      const ratio = MAX_FRAME_SPEED / vel.speed;
      setBallFrameVelocity(vel.x * ratio, vel.y * ratio);
    }

    // Belt-and-suspenders safety containment
    if (ball.position.x < 20) {
      Body.setPosition(ball, { x: 24, y: ball.position.y });
      setBallFrameVelocity(Math.abs(vel.x) * 0.6, vel.y);
    } else if (ball.position.x > 460) {
      Body.setPosition(ball, { x: 456, y: ball.position.y });
      setBallFrameVelocity(-Math.abs(vel.x) * 0.6, vel.y);
    }
    if (ball.position.y < 18) {
      Body.setPosition(ball, { x: ball.position.x, y: 22 });
      setBallFrameVelocity(vel.x, Math.abs(vel.y) * 0.6);
    }
  }

  function updateGameStep(dtSec) {
    state.time += dtSec;

    // Flipper audio on fresh press/release
    if (state.phase === 'playing') {
      if (input.left && !input.prevLeft) sound.flipperUp();
      if (!input.left && input.prevLeft) sound.flipperDown();
      if (input.right && !input.prevRight) sound.flipperUp();
      if (!input.right && input.prevRight) sound.flipperDown();
    }

    // Plunger & one-way gate control
    stepPlungerAndGate(dtSec);

    // Sub-stepped Matter.js physics update
    const subDtSec = dtSec / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      stepFlippers(subDtSec);
      Engine.update(engine, SUBSTEP_DT);
      clampBallVelocityAndBounds();
    }

    // Store prev input state after step
    input.prevLeft = input.left;
    input.prevRight = input.right;
    input.prevSpace = input.space;

    // Update timers & visual decays
    for (const b of bumpers) {
      b.flash = Math.max(0, b.flash - dtSec * 3.8);
      b.scale += (1 - b.scale) * Math.min(1, dtSec * 16);
    }
    for (const s of slingshots) {
      s.flash = Math.max(0, s.flash - dtSec * 4.5);
    }
    for (const t of topTargets) {
      t.flash = Math.max(0, t.flash - dtSec * 3.2);
      t.cooldown = Math.max(0, t.cooldown - dtSec);
    }
    for (const d of sideDeflectors) {
      d.flash = Math.max(0, d.flash - dtSec * 4.5);
    }
    flippers.left.glow = Math.max(0, flippers.left.glow - dtSec * 3.5);
    flippers.right.glow = Math.max(0, flippers.right.glow - dtSec * 3.5);
    state.wallFlash = Math.max(0, state.wallFlash - dtSec * 3.5);

    if (state.shakeTime > 0) {
      state.shakeTime = Math.max(0, state.shakeTime - dtSec);
      if (state.shakeTime === 0) state.shakeIntensity = 0;
    }

    if (state.bannerTimer > 0) {
      state.bannerTimer = Math.max(0, state.bannerTimer - dtSec);
    }

    // Combo decay timer
    if (state.comboTimer > 0 && state.phase === 'playing') {
      state.comboTimer = Math.max(0, state.comboTimer - dtSec);
      if (state.comboTimer === 0 && state.comboCount > 0) {
        state.comboCount = 0;
        syncHUD();
      } else {
        updateComboBar();
      }
    }

    // Ball trail & anti-stall check & drain detection
    if (ball && state.phase === 'playing') {
      const vel = getBallFrameVelocity();
      ballTrail.push({ x: ball.position.x, y: ball.position.y, speed: vel.speed });
      if (ballTrail.length > 20) {
        ballTrail.shift();
      }

      // Anti-stall safeguard (only when in active play and not being cradled on a held flipper)
      if (!state.inShooterLane && !input.left && !input.right && vel.speed < 0.25) {
        state.stallTimer += dtSec;
        if (state.stallTimer > 1.5) {
          setBallFrameVelocity((Math.random() - 0.5) * 4.5, -3.5);
          state.stallTimer = 0;
        }
      } else {
        state.stallTimer = 0;
      }

      // Ball Drain Detection
      if (ball.position.y > H + BALL_RADIUS + 14) {
        handleBallDrain();
      }
    }

    // Respawn countdown between balls
    if (state.phase === 'respawning') {
      state.respawnTimer -= dtSec;
      if (state.respawnTimer <= 0) {
        state.phase = 'playing';
        spawnBall();
        const ballNum = 4 - state.ballsLeft;
        showBanner(`BOLA ${ballNum}`, 'MANTÉN ESPACIO PARA LANZAR', 1.35);
        syncHUD();
      }
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.vy += 0.06;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }

    // Update shockwave rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dtSec * 3.2;
      r.r += (r.endR - r.r) * Math.min(1, dtSec * 12);
      if (r.life <= 0) rings.splice(i, 1);
    }

    // Update floating score popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const pop = popups[i];
      pop.y -= 36 * dtSec;
      pop.life -= dtSec * 1.15;
      if (pop.life <= 0) popups.splice(i, 1);
    }
  }

  function handleBallDrain() {
    sound.ballDrain();
    triggerShake(5.5, 0.2);

    if (ball) {
      World.remove(world, ball);
      ball = null;
    }
    ballTrail.length = 0;

    state.ballsLeft--;
    state.comboCount = 0;
    state.comboTimer = 0;
    state.baseMultiplier = 1;
    topTargets.forEach((t) => {
      t.lit = false;
    });
    syncHUD();

    if (state.ballsLeft > 0) {
      state.phase = 'respawning';
      state.respawnTimer = 0.85;
      showBanner('BOLA PERDIDA', `${state.ballsLeft} ${state.ballsLeft === 1 ? 'RESTANTE' : 'RESTANTES'}`, 0.85);
    } else {
      endGame();
    }
  }

  function startNewGame() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    sound.unlock();
    sound.gameStart();

    state.phase = 'playing';
    state.score = 0;
    state.newRecord = false;
    state.ballsLeft = 3;
    state.baseMultiplier = 1;
    state.comboCount = 0;
    state.maxCombo = 0;
    state.maxMultiplier = 1;
    state.comboTimer = 0;
    state.plungerCharge = 0;
    state.plungerSpringVisual = 0;

    topTargets.forEach((t) => {
      t.lit = false;
      t.flash = 0;
      t.cooldown = 0;
    });
    particles.length = 0;
    rings.length = 0;
    popups.length = 0;

    ui.startOverlay.classList.add('hidden');
    ui.gameoverOverlay.classList.add('hidden');

    spawnBall();
    showBanner('¡A JUGAR!', 'MANTÉN ESPACIO PARA LANZAR', 1.5);
    syncHUD();
  }

  function endGame() {
    state.phase = 'gameover';
    saveHighScore(state.highScore);
    sound.gameOver();

    ui.finalScore.textContent = state.score.toLocaleString('es-ES');
    ui.finalBest.textContent = state.highScore.toLocaleString('es-ES');
    ui.finalCombo.textContent = String(state.maxCombo);
    ui.finalMult.textContent = `x${state.maxMultiplier}`;
    ui.newRecordBadge.classList.toggle('hidden', !state.newRecord || state.score === 0);
    ui.gameoverOverlay.classList.remove('hidden');
    syncHUD();
  }

  // ============================================================
  // 11. HUD SYNCHRONIZATION
  // ============================================================
  function syncHUD() {
    ui.score.textContent = String(state.score).padStart(6, '0');
    ui.best.textContent = String(state.highScore).padStart(6, '0');
    ui.startBestVal.textContent = state.highScore.toLocaleString('es-ES');
    ui.mult.textContent = `x${getActiveMultiplier()}`;

    const dots = ui.balls.children;
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('active', i < state.ballsLeft);
    }

    updateComboBar();
  }

  function updateComboBar() {
    const pct = state.comboTimer > 0 ? Math.max(0, Math.min(100, (state.comboTimer / state.comboDuration) * 100)) : 0;
    ui.comboBar.style.width = `${pct}%`;
  }

  function updateMuteUI() {
    ui.muteIcon.textContent = sound.muted ? '🔇' : '🔊';
    ui.muteBtn.classList.toggle('muted', sound.muted);
    ui.keyMute.classList.toggle('active', sound.muted);
  }

  // ============================================================
  // 12. CUSTOM NEON ARCADE CANVAS RENDERER
  // ============================================================
  function render() {
    ctx.save();

    // Micro screen-shake on big impacts
    if (state.shakeTime > 0 && state.shakeIntensity > 0) {
      const mag = state.shakeIntensity * (state.shakeTime / 0.18);
      const sx = (Math.random() - 0.5) * mag * 2;
      const sy = (Math.random() - 0.5) * mag * 2;
      ctx.translate(sx, sy);
    }

    drawPlayfieldBackground();
    drawDecorativeFloorArt();
    drawTopTargets();
    drawLaneFins();
    drawSideDeflectors();
    drawSlingshots();
    drawBumpers();
    drawApronsAndWalls();
    drawOneWayGate();
    drawPlunger();
    drawFlipper(flippers.left);
    drawFlipper(flippers.right);
    drawBallTrail();
    drawBall();
    drawEffects();
    drawBanner();

    ctx.restore();
  }

  function drawPlayfieldBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0f26');
    bg.addColorStop(0.55, '#070b1c');
    bg.addColorStop(1, '#040611');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Subtle neon grid inside the playfield
    ctx.save();
    ctx.beginPath();
    ctx.arc(ARCH_CX, ARCH_CY, ARCH_R, Math.PI, 0, false);
    ctx.lineTo(462, H);
    ctx.lineTo(18, H);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = 'rgba(0, 240, 255, 0.045)';
    ctx.lineWidth = 1;
    const step = 32;
    for (let x = 18; x <= 462; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 18; y <= H; y += step) {
      ctx.beginPath();
      ctx.moveTo(18, y);
      ctx.lineTo(462, y);
      ctx.stroke();
    }

    // Soft ambient radial glow under bumper cluster
    const clusterGlow = ctx.createRadialGradient(PLAY_CX, 305, 10, PLAY_CX, 305, 195);
    clusterGlow.addColorStop(0, 'rgba(255, 42, 133, 0.12)');
    clusterGlow.addColorStop(0.55, 'rgba(0, 240, 255, 0.05)');
    clusterGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = clusterGlow;
    ctx.fillRect(18, 100, 400, 420);

    // Subtle shooter lane tint
    const laneGrad = ctx.createLinearGradient(428, 240, 462, 804);
    laneGrad.addColorStop(0, 'rgba(255, 184, 0, 0.03)');
    laneGrad.addColorStop(1, 'rgba(255, 184, 0, 0.09)');
    ctx.fillStyle = laneGrad;
    ctx.fillRect(428, 220, 34, 584);

    ctx.restore();
  }

  function drawDecorativeFloorArt() {
    ctx.save();

    // Glowing center playfield emblem & multiplier ring
    const mult = getActiveMultiplier();
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 3.5);

    ctx.translate(PLAY_CX, 515);

    // Outer decorative circuit ring
    ctx.beginPath();
    ctx.arc(0, 0, 52, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.14 + pulse * 0.08})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.strokeStyle = mult > 1 ? 'rgba(255, 42, 133, 0.45)' : 'rgba(255, 42, 133, 0.16)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Active multiplier display on table floor
    ctx.font = '800 22px "Orbitron", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = mult > 1 ? 'rgba(255, 184, 0, 0.65)' : 'rgba(0, 240, 255, 0.25)';
    ctx.fillText(`x${mult}`, 0, -2);

    ctx.font = '700 8px "Orbitron", "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(155, 180, 220, 0.35)';
    ctx.fillText('MULTIPLICADOR', 0, 18);

    // Subtle directional chevrons pointing toward top targets
    for (let i = 0; i < 3; i++) {
      const y = -82 - i * 14;
      const alpha = 0.08 + 0.14 * ((Math.sin(state.time * 4 - i * 0.9) + 1) / 2);
      ctx.beginPath();
      ctx.moveTo(-14, y + 6);
      ctx.lineTo(0, y);
      ctx.lineTo(14, y + 6);
      ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();

    // Subtle pulsing launch prompt in shooter lane when ball is waiting
    if (state.phase === 'playing' && state.inShooterLane && ball && ball.position.y > 670) {
      const alpha = 0.35 + 0.45 * ((Math.sin(state.time * 5) + 1) / 2);
      ctx.save();
      ctx.translate(445, 555);
      ctx.rotate(-Math.PI / 2);
      ctx.font = '700 10px "Orbitron", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255, 184, 0, ${alpha})`;
      ctx.fillText(state.plungerCharge > 0.05 ? '¡SUELTA ESPACIO!' : 'MANTÉN ESPACIO ▲', 0, 0);
      ctx.restore();
    }
  }

  function drawTopTargets() {
    for (const t of topTargets) {
      ctx.save();
      const activeGlow = t.lit || t.flash > 0.1;

      // Halo glow
      if (activeGlow) {
        const halo = ctx.createRadialGradient(t.x, t.y, 2, t.x, t.y, 28 + t.flash * 10);
        halo.addColorStop(0, 'rgba(255, 184, 0, 0.65)');
        halo.addColorStop(0.6, 'rgba(255, 184, 0, 0.18)');
        halo.addColorStop(1, 'rgba(255, 184, 0, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 34, 0, Math.PI * 2);
        ctx.fill();
      }

      // Target disc
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fillStyle = t.lit ? 'rgba(255, 184, 0, 0.32)' : 'rgba(15, 22, 48, 0.85)';
      ctx.fill();

      ctx.shadowColor = t.lit ? COLORS.amber : COLORS.cyan;
      ctx.shadowBlur = t.lit ? 16 : 6;
      ctx.strokeStyle = t.lit ? COLORS.amber : 'rgba(0, 240, 255, 0.45)';
      ctx.lineWidth = t.lit ? 2.6 : 1.6;
      ctx.stroke();

      // Letter / emblem
      ctx.shadowBlur = t.lit ? 10 : 0;
      ctx.font = '900 13px "Orbitron", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.lit ? '#fff7d6' : 'rgba(0, 240, 255, 0.65)';
      ctx.fillText(t.char, t.x, t.y + 0.5);

      ctx.restore();
    }
  }

  function drawLaneFins() {
    ctx.save();
    ctx.lineCap = 'round';
    for (const f of laneFins) {
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = f.r * 2;
      ctx.beginPath();
      ctx.moveTo(f.x, f.top);
      ctx.lineTo(f.x, f.bot);
      ctx.stroke();

      // Bright inner neon tube core
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#d7fbff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(f.x, f.top);
      ctx.lineTo(f.x, f.bot);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSideDeflectors() {
    for (const d of sideDeflectors) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d.pts[0].x, d.pts[0].y);
      ctx.lineTo(d.pts[1].x, d.pts[1].y);
      ctx.lineTo(d.pts[2].x, d.pts[2].y);
      ctx.closePath();

      ctx.fillStyle = d.flash > 0.05 ? 'rgba(0, 240, 255, 0.35)' : 'rgba(0, 240, 255, 0.1)';
      ctx.fill();

      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 10 + d.flash * 14;
      ctx.strokeStyle = d.flash > 0.2 ? COLORS.white : COLORS.cyan;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBumpers() {
    for (const b of bumpers) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.scale(b.scale, b.scale);

      // Outer ambient halo
      const halo = ctx.createRadialGradient(0, 0, b.r * 0.4, 0, 0, b.r + 18 + b.flash * 14);
      halo.addColorStop(0, b.color + '55');
      halo.addColorStop(1, b.color + '00');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, b.r + 22, 0, Math.PI * 2);
      ctx.fill();

      // Base body
      const fillGrad = ctx.createRadialGradient(-4, -5, 2, 0, 0, b.r);
      fillGrad.addColorStop(0, b.flash > 0.3 ? '#ffffff' : '#1c254a');
      fillGrad.addColorStop(0.65, b.flash > 0.3 ? b.color : '#0c122b');
      fillGrad.addColorStop(1, '#060916');
      ctx.fillStyle = fillGrad;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();

      // Outer neon ring
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 14 + b.flash * 20;
      ctx.strokeStyle = b.flash > 0.45 ? '#ffffff' : b.color;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // Inner accent ring
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.56, 0, Math.PI * 2);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Center core dot
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = b.flash > 0.2 ? '#ffffff' : b.color;
      ctx.fill();

      ctx.restore();
    }
  }

  function drawSlingshots() {
    for (const s of slingshots) {
      ctx.save();
      const [A, B, C] = s.pts;

      // Body polygon (rounded feel via lineJoin = round)
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.lineTo(C.x, C.y);
      ctx.closePath();

      ctx.fillStyle = s.flash > 0.1 ? 'rgba(255, 42, 133, 0.34)' : 'rgba(22, 14, 46, 0.85)';
      ctx.fill();

      ctx.lineJoin = 'round';
      ctx.shadowColor = COLORS.magenta;
      ctx.shadowBlur = 10 + s.flash * 16;
      ctx.strokeStyle = 'rgba(255, 42, 133, 0.65)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Active kicking rubber band along A -> C (brighter + snaps outward on hit)
      const kickOffset = s.flash * 5;
      const midX = (A.x + C.x) / 2 + s.nx * kickOffset;
      const midY = (A.y + C.y) / 2 + s.ny * kickOffset;

      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(midX, midY, C.x, C.y);
      ctx.shadowColor = s.flash > 0.25 ? COLORS.amber : COLORS.magenta;
      ctx.shadowBlur = 16 + s.flash * 16;
      ctx.strokeStyle = s.flash > 0.3 ? '#ffffff' : COLORS.magenta;
      ctx.lineWidth = 4.2;
      ctx.stroke();

      // Corner neon posts
      ctx.shadowBlur = 8;
      for (const p of s.pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = s.flash > 0.3 ? COLORS.amber : '#ffd4ea';
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawApronsAndWalls() {
    ctx.save();

    // --- Decorative dark translucent lower aprons ---
    // Left apron fill
    ctx.beginPath();
    ctx.moveTo(18, 664);
    ctx.lineTo(125, 715);
    ctx.lineTo(125, 738);
    ctx.lineTo(148, 820);
    ctx.lineTo(18, 820);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 18, 42, 0.92)';
    ctx.fill();

    // Right apron fill
    ctx.beginPath();
    ctx.moveTo(416, 664);
    ctx.lineTo(309, 715);
    ctx.lineTo(309, 738);
    ctx.lineTo(286, 820);
    ctx.lineTo(416, 820);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 18, 42, 0.92)';
    ctx.fill();

    // Apron neon top rails
    ctx.lineCap = 'round';
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 3.5;

    ctx.beginPath();
    ctx.moveTo(18, 664);
    ctx.lineTo(123, 714);
    ctx.moveTo(416, 664);
    ctx.lineTo(311, 714);
    ctx.stroke();

    // Subtle drain edge lines
    ctx.shadowBlur = 6;
    ctx.strokeStyle = 'rgba(255, 42, 133, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(18, 722);
    ctx.lineTo(148, 820);
    ctx.moveTo(416, 722);
    ctx.lineTo(286, 820);
    ctx.stroke();

    // --- Outer Arch + Left & Right Playfield Neon Border ---
    const wallGlow = 12 + state.wallFlash * 10;
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = wallGlow;
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(18, H);
    ctx.lineTo(18, ARCH_CY);
    ctx.arc(ARCH_CX, ARCH_CY, ARCH_R, Math.PI, 0, false);
    ctx.lineTo(462, 804);
    ctx.lineTo(422, 804);
    ctx.stroke();

    // Crisp bright inner neon core on outer border
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#d8fdff';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // --- Shooter Lane Divider + Inner Guide Curve ---
    ctx.shadowColor = COLORS.amber;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(422, 804);
    ctx.lineTo(422, ARCH_CY);
    ctx.arc(ARCH_CX, ARCH_CY, INNER_GUIDE_R, 0, -0.58, true);
    ctx.stroke();

    // Dark center bevel inside divider wall
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#191429';
    ctx.lineWidth = 5;
    ctx.stroke();

    // Inner thin highlight on divider
    ctx.strokeStyle = '#ffe599';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  }

  function drawOneWayGate() {
    if (!gateMeta) return;
    ctx.save();

    // Hinge at outer arch point (x2, y2), swings up-left into playfield when ball passes
    const hingeX = gateMeta.x2;
    const hingeY = gateMeta.y2;
    const baseDx = gateMeta.x1 - hingeX;
    const baseDy = gateMeta.y1 - hingeY;
    const swingAngle = state.gateSwing * 0.95; // Swings open counter-clockwise into playfield
    const cos = Math.cos(swingAngle);
    const sin = Math.sin(swingAngle);
    const tipX = hingeX + baseDx * cos - baseDy * sin;
    const tipY = hingeY + baseDx * sin + baseDy * cos;

    const color = state.gateClosed ? COLORS.magenta : COLORS.amber;
    ctx.shadowColor = color;
    ctx.shadowBlur = state.gateClosed ? 12 : 16;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hingeX, hingeY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    // Gate hinge pin
    ctx.beginPath();
    ctx.arc(hingeX, hingeY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  function drawPlunger() {
    ctx.save();
    const pull = state.plungerSpringVisual;
    const headY = PLUNGER_REST_Y + pull * PLUNGER_MAX_PULL;
    const baseY = 802;

    // Charge color transition: cyan -> amber -> hot magenta
    const chargeColor = pull > 0.72 ? COLORS.magenta : pull > 0.3 ? COLORS.amber : COLORS.cyan;

    // Coiled spring
    const coils = 8;
    const springTop = headY + 10;
    const springH = Math.max(8, baseY - springTop);
    ctx.shadowColor = chargeColor;
    ctx.shadowBlur = 8 + pull * 14;
    ctx.strokeStyle = chargeColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(PLUNGER_X, baseY);
    for (let i = 1; i <= coils; i++) {
      const y = baseY - (springH * i) / coils;
      const offsetX = i === coils ? 0 : i % 2 === 0 ? -9 : 9;
      ctx.lineTo(PLUNGER_X + offsetX, y);
    }
    ctx.stroke();

    // Plunger metallic cap
    ctx.fillStyle = '#182442';
    ctx.strokeStyle = chargeColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(PLUNGER_X - 13, headY, 26, 12, 4);
    ctx.fill();
    ctx.stroke();

    // Power gauge ticks beside shooter lane
    const gaugeX = 433;
    const tickCount = 8;
    for (let i = 0; i < tickCount; i++) {
      const ty = 790 - i * 8;
      const lit = pull >= (i + 0.5) / tickCount;
      ctx.shadowBlur = lit ? 8 : 0;
      ctx.fillStyle = lit ? chargeColor : 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(gaugeX, ty, 4, 4);
    }

    ctx.restore();
  }

  function drawFlipper(fl) {
    ctx.save();
    ctx.translate(fl.pivotX, fl.pivotY);
    ctx.rotate(fl.angle);

    const tipX = fl.dir * fl.length;
    const r1 = fl.rPivot;
    const r2 = fl.rTip;

    // Construct tapered capsule path matching physics geometry 1:1
    ctx.beginPath();
    if (fl.dir > 0) {
      ctx.arc(0, 0, r1, Math.PI / 2, (Math.PI * 3) / 2, false);
      ctx.arc(tipX, 0, r2, -Math.PI / 2, Math.PI / 2, false);
    } else {
      ctx.arc(0, 0, r1, -Math.PI / 2, Math.PI / 2, false);
      ctx.arc(tipX, 0, r2, Math.PI / 2, (Math.PI * 3) / 2, false);
    }
    ctx.closePath();

    // Metallic dark core gradient
    const grad = ctx.createLinearGradient(0, -r1, 0, r1);
    grad.addColorStop(0, '#2a456e');
    grad.addColorStop(0.5, '#132042');
    grad.addColorStop(1, '#091026');
    ctx.fillStyle = grad;
    ctx.fill();

    // Neon rim
    const glowColor = fl.glow > 0.35 ? '#7cf9ff' : COLORS.cyan;
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 12 + fl.glow * 14;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // Center neon stripe
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fl.dir * 12, 0);
    ctx.lineTo(fl.dir * (fl.length - 8), 0);
    ctx.stroke();

    // Glowing pivot bolt
    ctx.beginPath();
    ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.amber;
    ctx.shadowColor = COLORS.amber;
    ctx.shadowBlur = 10;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  function drawBallTrail() {
    if (ballTrail.length < 2) return;
    ctx.save();
    for (let i = 0; i < ballTrail.length; i++) {
      const pt = ballTrail[i];
      const t = (i + 1) / ballTrail.length;
      const speedFactor = Math.min(1, pt.speed / 14);
      const alpha = t * t * 0.42 * (0.25 + 0.75 * speedFactor);
      const radius = BALL_RADIUS * (0.28 + 0.65 * t);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 240, 255, ${alpha.toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBall() {
    if (!ball) return;
    const { x, y } = ball.position;
    ctx.save();

    // Outer neon aura
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 16;

    // 3D chrome-neon sphere shading
    const grad = ctx.createRadialGradient(x - 3.5, y - 3.5, 1.5, x, y, BALL_RADIUS);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#d2faff');
    grad.addColorStop(0.75, '#4fc3e8');
    grad.addColorStop(1, '#104970');

    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Crisp specular highlight dot
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x - 3.4, y - 3.6, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();

    ctx.restore();
  }

  function drawEffects() {
    // Shockwave rings
    for (const r of rings) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.strokeStyle = r.color;
      ctx.shadowColor = r.color;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.6 * r.life;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Glowing particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Floating score popups
    for (const pop of popups) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, pop.life * 1.2));
      const fontSize = Math.round(14 * pop.scale);
      ctx.font = `900 ${fontSize}px "Orbitron", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = pop.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = pop.color;
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.restore();
    }
  }

  function drawBanner() {
    if (state.bannerTimer <= 0 || !state.bannerText) return;
    const alpha = Math.min(1, state.bannerTimer * 2.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '900 24px "Orbitron", system-ui, sans-serif';
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(state.bannerText, PLAY_CX, 462);

    if (state.bannerSub) {
      ctx.font = '700 11px "Orbitron", system-ui, sans-serif';
      ctx.shadowColor = COLORS.amber;
      ctx.shadowBlur = 10;
      ctx.fillStyle = COLORS.amber;
      ctx.fillText(state.bannerSub, PLAY_CX, 488);
    }

    ctx.restore();
  }

  // ============================================================
  // 13. INPUT HANDLING (KEYBOARD, MOUSE/TOUCH & ON-SCREEN PILLS)
  // ============================================================
  function syncKeyPills() {
    ui.keyLeft.classList.toggle('active', input.left);
    ui.keyRight.classList.toggle('active', input.right);
    ui.keySpace.classList.toggle('active', input.space);
  }

  window.addEventListener('keydown', (e) => {
    sound.unlock();

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    if (e.code === 'KeyM' && !e.repeat) {
      sound.toggleMute();
      updateMuteUI();
      return;
    }

    // Quick start / instant restart with Space or Enter
    if ((state.phase === 'start' || state.phase === 'gameover') && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      startNewGame();
      return;
    }

    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      input.left = true;
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      input.right = true;
    }
    if (e.code === 'Space') {
      input.space = true;
    }

    syncKeyPills();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      input.left = false;
    }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      input.right = false;
    }
    if (e.code === 'Space') {
      input.space = false;
    }
    syncKeyPills();
  });

  window.addEventListener('blur', () => {
    input.left = false;
    input.right = false;
    input.space = false;
    syncKeyPills();
  });

  // UI Buttons
  ui.startBtn.addEventListener('click', () => startNewGame());
  ui.restartBtn.addEventListener('click', () => startNewGame());
  ui.muteBtn.addEventListener('click', () => {
    ui.muteBtn.blur();
    sound.unlock();
    sound.toggleMute();
    updateMuteUI();
  });

  // Interactive on-screen key pills (also great for mouse/touch play!)
  function bindHoldPill(el, keyName) {
    const down = (e) => {
      e.preventDefault();
      sound.unlock();
      input[keyName] = true;
      syncKeyPills();
    };
    const up = (e) => {
      e.preventDefault();
      input[keyName] = false;
      syncKeyPills();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }

  bindHoldPill(ui.keyLeft, 'left');
  bindHoldPill(ui.keyRight, 'right');
  bindHoldPill(ui.keySpace, 'space');
  ui.keyMute.addEventListener('click', () => {
    sound.unlock();
    sound.toggleMute();
    updateMuteUI();
  });

  // Direct touch/pointer support on canvas (left half = left flipper, right = right flipper, shooter lane = plunger)
  const activePointers = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    sound.unlock();
    if (state.phase !== 'playing') return;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const relY = ((e.clientY - rect.top) / rect.height) * H;

    let action = 'left';
    if (relX > 410 && relY > 450 && state.inShooterLane) {
      action = 'space';
    } else if (relX >= PLAY_CX) {
      action = 'right';
    }

    activePointers.set(e.pointerId, action);
    input[action] = true;
    syncKeyPills();
  });

  function releasePointer(e) {
    const action = activePointers.get(e.pointerId);
    if (!action) return;
    activePointers.delete(e.pointerId);
    // Only release if no other pointer holds the same action
    const stillHeld = Array.from(activePointers.values()).includes(action);
    if (!stillHeld) {
      input[action] = false;
      syncKeyPills();
    }
  }

  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);

  // ============================================================
  // 14. MAIN ANIMATION LOOP (FIXED TIMESTEP ACCUMULATOR)
  // ============================================================
  let lastTimestamp = 0;
  let accumulator = 0;

  function loop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const rawDelta = Math.min(50, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    accumulator += rawDelta;

    while (accumulator >= FIXED_FRAME_MS) {
      updateGameStep(FIXED_FRAME_MS / 1000);
      accumulator -= FIXED_FRAME_MS;
    }

    render();
    requestAnimationFrame(loop);
  }

  // ============================================================
  // 15. INITIALIZE
  // ============================================================
  buildTable();
  syncHUD();
  updateMuteUI();
  requestAnimationFrame(loop);
})();
