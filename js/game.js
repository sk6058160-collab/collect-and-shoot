/* Collect and Shoot — landscape 3D arena PWA */
(function () {
  "use strict";

  const VERSION = "2.1";
  const HS_KEY = "cas_highscore_v1";
  const SET_KEY = "cas_settings_v2";
  const MAX_HP = 100;
  const WORLD = { minX: -52, maxX: 52, minZ: -48, maxZ: 52 };
  const ZONES = [
    { id: "ruins", name: "Ruined Court", x: 0, z: 6, rx: 28, rz: 20 },
    { id: "lava", name: "Ember Field", x: 0, z: -32, rx: 26, rz: 18 },
    { id: "mist", name: "Mist Pass", x: 12, z: 36, rx: 26, rz: 18 },
  ];
  const LAIRS = [
    { id: "ember", name: "EMBERHORN", x: 0, z: -36, bossIdx: 0, color: "#ff4a10", defeated: false },
    { id: "void", name: "VOIDMAW", x: 18, z: 40, bossIdx: 1, color: "#b44aff", defeated: false },
  ];
  function el(id) { return document.getElementById(id); }

  let renderer, scene, camera, clock, sunLight, hemi, lavaLight, worldEmbers, worldMist;
  let flashT = 0, mode = "home", score = 0, wave = 1, combo = 0, comboT = 0, highScore = 0, kills = 0, time = 0;
  let pendingPower = null, activePower = null, powerT = 0;
  let wavePhase = "idle", waveTimer = 0, toSpawn = 0, muted = false;
  let quality = "high", autoQuality = true, showFps = true;
  let fps = 0, fpsAccum = 0, fpsFrames = 0, autoGrace = 5, autoCd = 0, autoStable = 0;
  let envMap = null, settingsFrom = "home", currentZone = "ruins";
  let gfx = { shadows: true, particles: 1, pr: 1.5 };
  let hemiBase = 1.45, sunBase = 1.9;
  const worldProps = [];

  const enemies = [], bullets = [], arrows = [], pickups = [], particles = [], floaters = [], pillars = [];

  const input = {
    x: 0, z: 0, joyId: null,
    firing: false, slashQueued: false,
    bowHeld: false, bowCharge: 0, bowStarted: false, powerQueued: false,
  };

  const player = {
    group: null, parts: null, hp: MAX_HP, maxHp: MAX_HP, yaw: 0, speed: 11,
    invuln: 0, gunCd: 0, slashCd: 0, gunLv: 1, swordLv: 0, bowLv: 0, radius: 0.7, _slashVis: 0, _bubble: null,
  };

  let bossRef = null, mats = {}, geos = {}, minimapCtx = null;
  const _look = new THREE.Vector3(0, 1, 0);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function irand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function len2(x, z) { return Math.sqrt(x * x + z * z) || 0; }
  function angNorm(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function lerpAng(a, b, t) { return a + angNorm(b - a) * t; }

  function loadHS() {
    try { highScore = parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0; } catch (e) { highScore = 0; }
    el("hs-home").textContent = String(highScore);
  }
  function saveHS() {
    if (score > highScore) {
      highScore = score;
      try { localStorage.setItem(HS_KEY, String(highScore)); } catch (e) {}
    }
    el("hs-home").textContent = String(highScore);
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SET_KEY) || "{}");
      if (s.quality === "low" || s.quality === "medium" || s.quality === "high") quality = s.quality;
      if (typeof s.auto === "boolean") autoQuality = s.auto;
      if (typeof s.fps === "boolean") showFps = s.fps;
    } catch (e) {}
  }
  function saveSettings() {
    try { localStorage.setItem(SET_KEY, JSON.stringify({ quality: quality, auto: autoQuality, fps: showFps })); } catch (e) {}
  }

  function noiseTex(size, c1, c2, grain) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = Math.random();
        const w = 0.55 + 0.45 * n;
        const i = (y * size + x) * 4;
        d[i] = (c1[0] * w + c2[0] * (1 - w) * (0.7 + grain * n)) | 0;
        d[i + 1] = (c1[1] * w + c2[1] * (1 - w) * (0.7 + grain * n)) | 0;
        d[i + 2] = (c1[2] * w + c2[2] * (1 - w) * (0.7 + grain * n)) | 0;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = "rgba(8,8,10,0.55)";
    ctx.lineWidth = 1;
    for (let k = 0; k < 18; k++) {
      ctx.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += rand(-30, 30); y += rand(-30, 30);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function lavaTex(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1a0a04";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const gx = rand(0, size), gy = rand(0, size);
      const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, rand(8, 40));
      g.addColorStop(0, "rgba(255,200,80,0.9)");
      g.addColorStop(0.4, "rgba(255,80,16,0.6)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function canvasTex(c, repeat) {
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) tex.repeat.set(repeat, repeat);
    return tex;
  }

  function wetTileMaps(size) {
    const col = document.createElement("canvas");
    const rou = document.createElement("canvas");
    col.width = col.height = rou.width = rou.height = size;
    const c = col.getContext("2d");
    const r = rou.getContext("2d");
    c.fillStyle = "#c4b089";
    c.fillRect(0, 0, size, size);
    r.fillStyle = "#d8d8d8";
    r.fillRect(0, 0, size, size);
    const n = 8, pad = Math.floor(size * 0.025);
    const tw = Math.floor(size / n);
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const x = tx * tw + pad, y = ty * tw + pad;
        const w = tw - pad * 2, h = tw - pad * 2;
        const shade = ((tx * 13 + ty * 7) % 28);
        c.fillStyle = "rgb(" + (196 + shade) + "," + (168 + shade * 0.7) + "," + (118 + shade * 0.35) + ")";
        c.fillRect(x, y, w, h);
        const g = c.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, "rgba(255,248,230,0.28)");
        g.addColorStop(0.5, "rgba(255,255,255,0)");
        g.addColorStop(1, "rgba(150,110,70,0.12)");
        c.fillStyle = g;
        c.fillRect(x, y, w, h);
        c.strokeStyle = "rgba(255,250,235,0.35)";
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        r.fillStyle = (tx + ty) % 2 === 0 ? "#b0b0b0" : "#c4c4c4";
        r.fillRect(x, y, w, h);
      }
    }
    return { map: canvasTex(col, 10), rough: canvasTex(rou, 10) };
  }

  function mossTex(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#5a8a3a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i++) {
      const x = rand(0, size), y = rand(0, size), rad = rand(4, 16);
      ctx.fillStyle = "rgba(" + irand(70, 140) + "," + irand(130, 190) + "," + irand(40, 80) + "," + rand(0.35, 0.75) + ")";
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(10,14,10,0.4)";
    for (let k = 0; k < 12; k++) {
      ctx.beginPath();
      let x = rand(0, size), y = rand(0, size);
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += rand(-20, 20); y += rand(-20, 20); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    return canvasTex(c, 6);
  }

  function weatheredTex(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#c8b492";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.08; i++) {
      const x = irand(0, size - 1), y = irand(0, size - 1);
      const v = irand(150, 210);
      ctx.fillStyle = "rgb(" + v + "," + (v - 18) + "," + (v - 40) + ")";
      ctx.fillRect(x, y, irand(1, 3), irand(1, 3));
    }
    ctx.strokeStyle = "rgba(20,18,16,0.5)";
    ctx.lineWidth = 1.2;
    for (let k = 0; k < 24; k++) {
      ctx.beginPath();
      let x = rand(0, size), y = rand(0, size);
      ctx.moveTo(x, y);
      for (let s = 0; s < 8; s++) { x += rand(-28, 28); y += rand(-18, 18); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // lichen
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = "rgba(70,90,50," + rand(0.15, 0.35) + ")";
      ctx.beginPath(); ctx.arc(rand(0, size), rand(0, size), rand(4, 12), 0, Math.PI * 2); ctx.fill();
    }
    return canvasTex(c, 3);
  }

  function stormSkyTex() {
    const w = 512, h = 256;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#3a8adf");
    g.addColorStop(0.35, "#6bb4ef");
    g.addColorStop(0.62, "#a8d6f8");
    g.addColorStop(0.82, "#e8f2ff");
    g.addColorStop(0.92, "#f3e6c8");
    g.addColorStop(1, "#dceccc");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 16; i++) {
      const cx = rand(0, w), cy = rand(h * 0.18, h * 0.58), rx = rand(36, 110), ry = rand(10, 24);
      const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, rx);
      cg.addColorStop(0, "rgba(255,255,255,0.95)");
      cg.addColorStop(0.45, "rgba(240,248,255,0.55)");
      cg.addColorStop(1, "rgba(200,220,255,0)");
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  }

  function crackEmissive(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    ctx.lineCap = "round";
    for (let k = 0; k < 16; k++) {
      ctx.strokeStyle = "rgb(" + irand(220, 255) + "," + irand(40, 90) + ",10)";
      ctx.lineWidth = rand(1.5, 3.5);
      ctx.beginPath();
      let x = rand(0, size), y = rand(0, size);
      ctx.moveTo(x, y);
      for (let s = 0; s < 10; s++) { x += rand(-30, 30); y += rand(-30, 30); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function initMats() {
    const rock = noiseTex(256, [62, 64, 72], [28, 26, 30], 0.8);
    rock.repeat.set(8, 8);
    const rock2 = weatheredTex(256);
    const tiles = wetTileMaps(256);
    const moss = mossTex(256);
    const lavaMap = lavaTex(256);
    lavaMap.wrapS = lavaMap.wrapT = THREE.RepeatWrapping;
    lavaMap.repeat.set(4, 4);
    mats.ground = new THREE.MeshStandardMaterial({ map: rock, color: 0xd2c4a0, roughness: 0.92, metalness: 0.04 });
    mats.wetStone = new THREE.MeshStandardMaterial({
      map: tiles.map, roughnessMap: tiles.rough, color: 0xf0e2c4,
      roughness: 0.72, metalness: 0.06, envMapIntensity: 0.35,
    });
    mats.moss = new THREE.MeshStandardMaterial({ map: moss, color: 0x8ec85a, roughness: 0.9, metalness: 0.02 });
    mats.lavaGround = new THREE.MeshStandardMaterial({
      map: lavaMap, color: 0x8a5340, roughness: 0.78, metalness: 0.08,
      emissive: 0xff3a00, emissiveMap: lavaMap, emissiveIntensity: 0.55,
    });
    mats.stone = new THREE.MeshStandardMaterial({ map: rock2, color: 0xe8d5b0, roughness: 0.82, metalness: 0.06 });
    mats.mountain = new THREE.MeshStandardMaterial({ map: rock2, color: 0xd4c8b0, roughness: 0.95, metalness: 0.04, flatShading: true });
    mats.lava = new THREE.MeshStandardMaterial({ map: lavaMap, color: 0xff6a1a, emissive: 0xff3a00, emissiveIntensity: 1.6, roughness: 0.55 });
    mats.bark = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.9 });
    mats.pine = new THREE.MeshStandardMaterial({ color: 0x2f8a3e, roughness: 0.85, flatShading: true });
    mats.sky = new THREE.MeshBasicMaterial({ map: stormSkyTex(), side: THREE.BackSide, fog: false, depthWrite: false });
    const cracks = crackEmissive(256);
    mats.heroBlue = new THREE.MeshStandardMaterial({ color: 0x3a86ff, roughness: 0.42, metalness: 0.12, emissive: 0x123080, emissiveIntensity: 0.12 });
    mats.heroSpike = new THREE.MeshStandardMaterial({ color: 0x1d5ae0, roughness: 0.38, metalness: 0.16, emissive: 0x0a2060, emissiveIntensity: 0.1 });
    mats.heroBelly = new THREE.MeshStandardMaterial({ color: 0xc5d4f0, roughness: 0.55, metalness: 0.05 });
    mats.heroGold = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.35, metalness: 0.7 });
    mats.heroDark = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.5, metalness: 0.2 });
    mats.eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.3 });
    mats.eyeGold = new THREE.MeshStandardMaterial({ color: 0xf0b020, roughness: 0.25, emissive: 0xaa7700, emissiveIntensity: 0.35 });
    mats.eyeBlack = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.4 });
    mats.cyan = new THREE.MeshStandardMaterial({ color: 0x5ce1ff, emissive: 0x1ab0ff, emissiveIntensity: 0.8, roughness: 0.3 });
    mats.gun = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.35, metalness: 0.8 });
    mats.gunGlow = new THREE.MeshStandardMaterial({ color: 0x4ad0ff, emissive: 0x2aa0ff, emissiveIntensity: 1.2 });
    mats.sword = new THREE.MeshStandardMaterial({ color: 0xcfd6e6, roughness: 0.2, metalness: 0.85 });
    mats.bow = new THREE.MeshStandardMaterial({ color: 0x5a3214, roughness: 0.6, metalness: 0.1 });
    mats.bowLimb = new THREE.MeshStandardMaterial({ color: 0x8a5a22, roughness: 0.45, metalness: 0.25 });
    mats.arrowShaft = new THREE.MeshStandardMaterial({ color: 0x6b3a14, roughness: 0.6 });
    mats.arrowHead = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.25, metalness: 0.85 });
    mats.fletch = new THREE.MeshStandardMaterial({ color: 0x1e6a3a, roughness: 0.7, side: THREE.DoubleSide });
    mats.chargeArrow = new THREE.MeshStandardMaterial({ color: 0xffc44a, emissive: 0xff8010, emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.3 });
    mats.imp = new THREE.MeshStandardMaterial({ color: 0xff5a24, roughness: 0.48, emissive: 0x8a1400, emissiveIntensity: 0.12 });
    mats.impDark = new THREE.MeshStandardMaterial({ color: 0xb83210, roughness: 0.5 });
    mats.impGlow = new THREE.MeshStandardMaterial({ color: 0xffc44a, emissive: 0xff7a00, emissiveIntensity: 0.7 });
    mats.impWing = new THREE.MeshStandardMaterial({ color: 0x8a1a3a, roughness: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    mats.hound = new THREE.MeshStandardMaterial({ color: 0xa85a28, roughness: 0.7, metalness: 0.06 });
    mats.houndDark = new THREE.MeshStandardMaterial({ color: 0x6a3414, roughness: 0.72 });
    mats.houndEye = new THREE.MeshStandardMaterial({ color: 0xffee66, emissive: 0xaa8800, emissiveIntensity: 0.45 });
    mats.gobSkin = new THREE.MeshStandardMaterial({ color: 0x6aaa32, roughness: 0.62 });
    mats.gobDark = new THREE.MeshStandardMaterial({ color: 0x3a6a18, roughness: 0.65 });
    mats.gobArmor = new THREE.MeshStandardMaterial({ color: 0xc48a2a, roughness: 0.38, metalness: 0.7 });
    mats.gobLeather = new THREE.MeshStandardMaterial({ color: 0x6a3a18, roughness: 0.8 });
    mats.golem = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.78, metalness: 0.12, map: rock2 });
    mats.golemMoss = new THREE.MeshStandardMaterial({ color: 0x4a8a38, roughness: 0.9 });
    mats.golemRune = new THREE.MeshStandardMaterial({ color: 0x44e0c0, emissive: 0x1aa080, emissiveIntensity: 0.8 });
    mats.guard = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.85, metalness: 0.2, map: rock2 });
    mats.bossRock = new THREE.MeshStandardMaterial({ color: 0xb07a52, roughness: 0.68, metalness: 0.14, emissive: 0xff2a00, emissiveMap: cracks, emissiveIntensity: 0.5 });
    mats.bossLava = new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff2a00, emissiveIntensity: 1.85, roughness: 0.35 });
    mats.bossHorn = new THREE.MeshStandardMaterial({ color: 0xe8d6b0, roughness: 0.4, metalness: 0.25 });
    mats.voidBody = new THREE.MeshStandardMaterial({ color: 0x7a48c8, roughness: 0.42, metalness: 0.28, emissive: 0x4a00aa, emissiveIntensity: 0.35 });
    mats.voidGlow = new THREE.MeshStandardMaterial({ color: 0xb44aff, emissive: 0x8800ff, emissiveIntensity: 1.5 });
    mats.stormBody = new THREE.MeshStandardMaterial({ color: 0x4a7aaa, roughness: 0.4, metalness: 0.35, emissive: 0x1860a0, emissiveIntensity: 0.3 });
    mats.stormGlow = new THREE.MeshStandardMaterial({ color: 0x8ad4ff, emissive: 0x2090ff, emissiveIntensity: 1.5 });
    mats.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false });
    mats.bullet = new THREE.MeshBasicMaterial({ color: 0x7ae0ff });
    mats.ember = new THREE.MeshBasicMaterial({ color: 0xff6a20 });
    mats.pickupPower = new THREE.MeshStandardMaterial({ color: 0x80ffd0, emissive: 0x20c090, emissiveIntensity: 1.1, roughness: 0.3 });
    mats.cyanLine = new THREE.MeshStandardMaterial({ color: 0x5ce1ff, emissive: 0x1ab0ff, emissiveIntensity: 0.8 });
    geos.sphere = new THREE.SphereGeometry(1, 14, 12);
    geos.sphereLo = new THREE.SphereGeometry(1, 10, 8);
    geos.cone = new THREE.ConeGeometry(1, 2, 7);
    geos.cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
    geos.box = new THREE.BoxGeometry(1, 1, 1);
    geos.plane = new THREE.CircleGeometry(1, 16);
  }

  function mesh(geo, mat, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  function noCast(m) { m.castShadow = false; return m; }
  function blobShadow(r) {
    const s = mesh(geos.plane, mats.shadow, r, r, r);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.03;
    s.castShadow = false;
    s.receiveShadow = false;
    s.userData.blob = true;
    return s;
  }

  function zoneAt(x, z) {
    let best = ZONES[0], bestD = 1e9;
    for (let i = 0; i < ZONES.length; i++) {
      const zn = ZONES[i];
      const dx = (x - zn.x) / zn.rx, dz = (z - zn.z) / zn.rz;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = zn; }
    }
    return best;
  }

  function buildWorld() {
    const skyTex = mats.sky.map;
    scene.background = skyTex;
    scene.fog = new THREE.FogExp2(0xc5dff0, 0.0032);
    hemi = new THREE.HemisphereLight(0xc8e6ff, 0xc4a878, hemiBase);
    scene.add(hemi);
    sunLight = new THREE.DirectionalLight(0xfff4d2, sunBase);
    sunLight.position.set(-22, 36, 18);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.bias = -0.0006;
    sunLight.shadow.normalBias = 0.04;
    const sc = sunLight.shadow.camera;
    sc.near = 1; sc.far = 70;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20;
    scene.add(sunLight);
    scene.add(sunLight.target);
    scene.add(new THREE.AmbientLight(0xfff6e8, 0.58));
    lavaLight = new THREE.PointLight(0xff5510, 1.6, 28, 1.4);
    lavaLight.position.set(0, 2.2, -32);
    scene.add(lavaLight);
    const lava2 = new THREE.PointLight(0xff6a1a, 0.9, 18, 1.6);
    lava2.position.set(8, 1.6, -28);
    scene.add(lava2);

    const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 20, 12), mats.sky);
    sky.castShadow = sky.receiveShadow = false;
    sky.frustumCulled = false;
    scene.add(sky);

    const base = noCast(new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 1, 1), mats.ground));
    base.rotation.x = -Math.PI / 2;
    base.receiveShadow = true;
    scene.add(base);

    const ruinsG = noCast(new THREE.Mesh(new THREE.PlaneGeometry(56, 42, 1, 1), mats.wetStone));
    ruinsG.rotation.x = -Math.PI / 2;
    ruinsG.position.set(0, 0.03, 6);
    ruinsG.receiveShadow = true;
    scene.add(ruinsG);

    const lavaG = noCast(new THREE.Mesh(new THREE.CircleGeometry(24, 28), mats.lavaGround));
    lavaG.rotation.x = -Math.PI / 2;
    lavaG.position.set(0, 0.035, -32);
    lavaG.receiveShadow = true;
    scene.add(lavaG);

    const mistG = noCast(new THREE.Mesh(new THREE.CircleGeometry(24, 28), mats.moss));
    mistG.rotation.x = -Math.PI / 2;
    mistG.position.set(12, 0.03, 36);
    mistG.receiveShadow = true;
    scene.add(mistG);

    // lava veins + pools
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const r = rand(3, 12);
      const strip = noCast(new THREE.Mesh(new THREE.PlaneGeometry(rand(4, 9), 0.5), mats.lava));
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = a;
      strip.position.set(Math.cos(a) * r, 0.05, -32 + Math.sin(a) * r);
      scene.add(strip);
    }
    const pool = noCast(new THREE.Mesh(new THREE.CircleGeometry(3.2, 16), mats.lava));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.045, -32);
    scene.add(pool);

    // sunlit flagstones
    for (let i = 0; i < 5; i++) {
      const slab = noCast(mesh(geos.box, mats.stone, rand(1.6, 2.4), 0.08, rand(1.2, 2.0)));
      slab.position.set(rand(-12, 12), 0.06, rand(-2, 14));
      slab.rotation.y = rand(0, 0.5);
      slab.receiveShadow = true;
      scene.add(slab);
    }

    // ruins pillars
    const ruinSpots = [
      [-10, 2], [10, 3], [-7, 14], [8, 14], [-16, 8], [16, 7], [-4, -4], [5, -6],
      [-12, 18], [14, 16], [0, 18],
    ];
    ruinSpots.forEach((s, i) => {
      const pil = makePillar(i % 4 === 0);
      pil.position.set(s[0], 0, s[1]);
      pil.rotation.y = rand(0, Math.PI);
      scene.add(pil);
      pillars.push({ x: s[0], z: s[1], r: 1.35, mesh: pil });
    });

    // charred rocks in lava field
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      const r = rand(8, 18);
      const x = Math.cos(a) * r, z = -32 + Math.sin(a) * r;
      const pil = makePillar(true);
      pil.position.set(x, 0, z);
      scene.add(pil);
      pillars.push({ x: x, z: z, r: 1.35, mesh: pil });
    }

    // forest trees
    for (let i = 0; i < 20; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(5, 22);
      const x = 12 + Math.cos(a) * r;
      const z = 36 + Math.sin(a) * r * 0.75;
      if (len2(x - 18, z - 40) < 5) continue;
      const tr = makeTree();
      tr.position.set(x, 0, z);
      scene.add(tr);
      pillars.push({ x: x, z: z, r: 0.7, mesh: tr });
      worldProps.push(tr);
    }
    for (let i = 0; i < 28; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(3, 20);
      const x = 12 + Math.cos(a) * r, z = 36 + Math.sin(a) * r * 0.75;
      const blade = noCast(mesh(geos.cone, mats.moss, rand(0.12, 0.22), rand(0.25, 0.5), rand(0.12, 0.22)));
      blade.position.set(x, 0.2, z);
      blade.rotation.z = rand(-0.2, 0.2);
      scene.add(blade);
    }

    // lair rings
    LAIRS.forEach((L) => {
      const ring = makeLairRing(L.color === "#ff4a10" ? mats.lava : mats.voidGlow);
      ring.position.set(L.x, 0, L.z);
      scene.add(ring);
      L.ring = ring;
    });

    // mountains beyond the playable wilds
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + rand(-0.06, 0.06);
      const r = rand(78, 105);
      const h = rand(20, 42);
      const mtn = noCast(mesh(new THREE.ConeGeometry(rand(11, 22), h, 5), mats.mountain));
      mtn.position.set(Math.cos(a) * r, h * 0.35, Math.sin(a) * r);
      mtn.rotation.y = rand(0, 1);
      scene.add(mtn);
    }

    // cliff teeth along the bounds so the edge feels real
    function edgeRock(x, z) {
      const h = rand(2.5, 5.5);
      const rk = mesh(new THREE.BoxGeometry(rand(2.2, 3.6), h, rand(2.2, 3.6)), mats.stone);
      rk.position.set(x, h * 0.4, z);
      rk.rotation.y = rand(0, 1);
      scene.add(rk);
      pillars.push({ x: x, z: z, r: 1.6, mesh: rk });
    }
    for (let x = WORLD.minX + 2; x <= WORLD.maxX - 2; x += 6) {
      edgeRock(x + rand(-1, 1), WORLD.minZ + rand(0.5, 2));
      edgeRock(x + rand(-1, 1), WORLD.maxZ - rand(0.5, 2));
    }
    for (let z = WORLD.minZ + 4; z <= WORLD.maxZ - 4; z += 7) {
      edgeRock(WORLD.minX + rand(0.5, 2), z + rand(-1, 1));
      edgeRock(WORLD.maxX - rand(0.5, 2), z + rand(-1, 1));
    }

    const emberGeo = new THREE.BufferGeometry();
    const N = 160;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rand(-18, 18);
      pos[i * 3 + 1] = rand(0.4, 10);
      pos[i * 3 + 2] = rand(-44, -18);
    }
    emberGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    worldEmbers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      color: 0xff7a30, size: 0.13, transparent: true, opacity: 0.75, depthWrite: false
    }));
    worldEmbers.castShadow = worldEmbers.receiveShadow = false;
    scene.add(worldEmbers);

    const mistGeo = new THREE.BufferGeometry();
    const M = 140;
    const mp = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      mp[i * 3] = 12 + rand(-22, 22);
      mp[i * 3 + 1] = rand(0.3, 6);
      mp[i * 3 + 2] = 36 + rand(-16, 16);
    }
    mistGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
    worldMist = new THREE.Points(mistGeo, new THREE.PointsMaterial({
      color: 0xe8f6dc, size: 0.7, transparent: true, opacity: 0.18, depthWrite: false, sizeAttenuation: true
    }));
    scene.add(worldMist);
  }

  function makeTree() {
    const g = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.6, 6), mats.bark);
    trunk.position.y = 0.8;
    const leaves = mesh(new THREE.ConeGeometry(1.15, 2.8, 6), mats.pine);
    leaves.position.y = 2.5;
    const leaves2 = mesh(new THREE.ConeGeometry(0.85, 1.8, 6), mats.pine);
    leaves2.position.y = 3.5;
    g.add(trunk, leaves, leaves2, blobShadow(0.7));
    g.scale.setScalar(rand(0.85, 1.25));
    return g;
  }

  function makeLairRing(mat) {
    const g = new THREE.Group();
    const tor = noCast(new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.16, 8, 24), mat));
    tor.rotation.x = -Math.PI / 2;
    tor.position.y = 0.12;
    g.add(tor);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const st = mesh(new THREE.BoxGeometry(0.45, 1.8, 0.3), mats.stone);
      st.position.set(Math.cos(a) * 3.6, 0.9, Math.sin(a) * 3.6);
      st.lookAt(0, 0.9, 0);
      g.add(st);
    }
    return g;
  }

  function buildEnvMap() {
    try {
      const es = new THREE.Scene();
      es.add(new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.sky));
      const pmrem = new THREE.PMREMGenerator(renderer);
      envMap = pmrem.fromScene(es, 0.04).texture;
      pmrem.dispose();
      scene.environment = envMap;
    } catch (e) {
      envMap = null;
    }
  }

  function applyQuality(q) {
    if (q) quality = q;
    const dpr = window.devicePixelRatio || 1;
    const table = {
      low:    { pr: 1, shadows: false, map: 256, soft: false, particles: 0.4, env: 0.25 },
      medium: { pr: Math.min(dpr, 1.35), shadows: true, map: 512, soft: false, particles: 0.7, env: 0.8 },
      high:   { pr: Math.min(dpr, 2), shadows: true, map: 1024, soft: true, particles: 1, env: 1.15 },
    };
    const cfg = table[quality] || table.medium;
    gfx = cfg;
    if (renderer) {
      renderer.setPixelRatio(cfg.pr);
      renderer.shadowMap.enabled = cfg.shadows;
      renderer.shadowMap.type = cfg.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      renderer.toneMappingExposure = quality === "low" ? 1.05 : 1.12;
    }
    if (sunLight) {
      sunLight.castShadow = cfg.shadows;
      sunLight.shadow.mapSize.set(cfg.map, cfg.map);
      if (sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
      }
    }
    if (scene) {
      scene.environment = cfg.env > 0.3 ? envMap : null;
      if (mats.wetStone) mats.wetStone.envMapIntensity = cfg.env;
      scene.traverse(function (o) {
        if (o.userData && o.userData.blob) o.visible = !cfg.shadows;
      });
    }
    if (worldEmbers) worldEmbers.visible = cfg.particles > 0.35;
    if (worldMist) worldMist.visible = cfg.particles > 0.5;
    syncSettingsUI();
    saveSettings();
  }

  function syncSettingsUI() {
    const seg = el("quality-seg");
    if (seg) {
      Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
        b.classList.toggle("on", b.getAttribute("data-q") === quality);
      });
    }
    const ca = el("chk-auto"); if (ca) ca.checked = autoQuality;
    const cf = el("chk-fps"); if (cf) cf.checked = showFps;
    const meter = el("fps-meter");
    if (meter) meter.classList.toggle("show", showFps);
  }

  function updateFps(rawDt) {
    fpsFrames++;
    fpsAccum += rawDt;
    if (fpsAccum >= 0.4) {
      fps = fpsFrames / fpsAccum;
      fpsFrames = 0;
      fpsAccum = 0;
      const meter = el("fps-meter");
      if (meter && showFps) meter.textContent = "FPS " + Math.round(fps);
      if (autoQuality && autoGrace <= 0) {
        if (autoCd > 0) autoCd -= 0.4;
        if (fps < 26 && autoCd <= 0 && quality !== "low") {
          applyQuality(quality === "high" ? "medium" : "low");
          autoCd = 8;
          autoStable = 0;
          toast("QUALITY " + quality.toUpperCase());
        } else if (fps > 52 && autoCd <= 0 && quality !== "high") {
          autoStable += 0.4;
          if (autoStable > 10) {
            applyQuality(quality === "low" ? "medium" : "high");
            autoCd = 10;
            autoStable = 0;
          }
        } else autoStable = 0;
      }
    }
  }

  function updateShadowLight() {
    if (!sunLight || !player.group) return;
    const p = player.group.position;
    sunLight.position.set(p.x - 24, 28, p.z + 16);
    sunLight.target.position.set(p.x, 0, p.z);
    sunLight.target.updateMatrixWorld();
    sunLight.shadow.camera.updateProjectionMatrix();
  }

  function updateZoneFx() {
    if (!player.group || !scene.fog) return;
    const zn = zoneAt(player.group.position.x, player.group.position.z);
    if (zn.id !== currentZone) {
      currentZone = zn.id;
      const lab = el("minimap-label");
      if (lab) lab.textContent = zn.name;
    }
    const wantCol = zn.id === "lava" ? 0xe8d4b8 : zn.id === "mist" ? 0xd8eed0 : 0xc5dff0;
    const wantD = zn.id === "mist" ? 0.0052 : zn.id === "lava" ? 0.0036 : 0.0030;
    scene.fog.color.lerp(new THREE.Color(wantCol), 0.04);
    scene.fog.density += (wantD - scene.fog.density) * 0.04;
    for (let i = 0; i < worldProps.length; i++) {
      const pr = worldProps[i];
      const d = len2(pr.position.x - player.group.position.x, pr.position.z - player.group.position.z);
      pr.visible = d < 62;
    }
  }

  function makePillar(broken) {
    const g = new THREE.Group();
    const h = broken ? rand(2.2, 3.6) : rand(4.2, 6.4);
    const col = mesh(new THREE.CylinderGeometry(0.95, 1.15, h, 8), mats.stone);
    col.position.y = h / 2;
    g.add(col);
    const cap = mesh(geos.box, mats.stone, 2.2, 0.45, 2.2);
    cap.position.y = h + 0.1;
    cap.rotation.y = 0.3;
    if (broken) {
      cap.rotation.z = rand(0.4, 0.9);
      cap.position.x += 0.5;
      cap.position.y = h * 0.7;
    }
    g.add(cap);
    if (!broken && Math.random() > 0.5) {
      const chunk = mesh(geos.box, mats.stone, 0.8, 0.5, 0.7);
      chunk.position.set(rand(-1, 1), 0.25, rand(-1, 1));
      chunk.rotation.set(rand(0, 1), rand(0, 1), rand(0, 1));
      g.add(chunk);
    }
    g.add(blobShadow(1.6));
    return g;
  }

  function buildGunModel(s) {
    const g = new THREE.Group();
    const body = mesh(geos.box, mats.gun, 0.12 * s, 0.14 * s, 0.42 * s);
    const barrel = mesh(geos.cyl, mats.gun, 0.05 * s, 0.32 * s, 0.05 * s);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.32 * s;
    const glow = mesh(geos.cyl, mats.gunGlow, 0.035 * s, 0.06 * s, 0.035 * s);
    glow.rotation.x = Math.PI / 2;
    glow.position.z = 0.48 * s;
    const handle = mesh(geos.box, mats.heroDark, 0.08 * s, 0.2 * s, 0.1 * s);
    handle.position.set(0, -0.14 * s, -0.05 * s);
    g.add(body, barrel, glow, handle);
    return g;
  }

  function buildSwordModel(s) {
    const g = new THREE.Group();
    const blade = mesh(new THREE.BoxGeometry(0.07 * s, 0.9 * s, 0.02 * s), mats.sword);
    blade.position.y = 0.5 * s;
    const tip = mesh(geos.cone, mats.sword, 0.05 * s, 0.14 * s, 0.02 * s);
    tip.position.y = 1.02 * s;
    const guard = mesh(geos.box, mats.heroGold, 0.28 * s, 0.05 * s, 0.08 * s);
    const hilt = mesh(geos.cyl, mats.heroDark, 0.04 * s, 0.22 * s, 0.04 * s);
    hilt.position.y = -0.14 * s;
    const pommel = mesh(geos.sphere, mats.heroGold, 0.06 * s);
    pommel.position.y = -0.26 * s;
    g.add(blade, tip, guard, hilt, pommel);
    return g;
  }

  function buildBowModel(s) {
    const g = new THREE.Group();
    const grip = mesh(geos.cyl, mats.bow, 0.04 * s, 0.22 * s, 0.04 * s);
    const up = mesh(new THREE.CylinderGeometry(0.02 * s, 0.045 * s, 0.55 * s, 6), mats.bowLimb);
    up.position.y = 0.34 * s;
    up.rotation.z = 0.45;
    up.rotation.x = 0.15;
    const dn = mesh(new THREE.CylinderGeometry(0.02 * s, 0.045 * s, 0.55 * s, 6), mats.bowLimb);
    dn.position.y = -0.34 * s;
    dn.rotation.z = -0.45;
    dn.rotation.x = -0.15;
    const string = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0.16 * s, 0.55 * s, 0),
        new THREE.Vector3(0.02 * s, 0, 0),
        new THREE.Vector3(0.16 * s, -0.55 * s, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xe8d8b0 })
    );
    g.add(grip, up, dn, string);
    return g;
  }

  function buildArrowModel(charged) {
    const g = new THREE.Group();
    const shaft = mesh(geos.cyl, charged ? mats.chargeArrow : mats.arrowShaft, 0.025, 0.7, 0.025);
    shaft.rotation.x = Math.PI / 2;
    const head = mesh(geos.cone, charged ? mats.chargeArrow : mats.arrowHead, 0.05, 0.16, 0.05);
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.42;
    const f1 = mesh(new THREE.PlaneGeometry(0.1, 0.16), mats.fletch);
    f1.position.z = -0.3;
    const f2 = f1.clone();
    f2.rotation.z = Math.PI / 2;
    g.add(shaft, head, f1, f2);
    return g;
  }

  function buildHero() {
    const g = new THREE.Group();
    const parts = {};
    const body = mesh(geos.sphere, mats.heroBlue, 0.55, 0.5, 0.58);
    body.position.y = 0.72;
    g.add(body);
    parts.body = body;
    const belly = mesh(geos.sphere, mats.heroBelly, 0.36, 0.38, 0.2);
    belly.position.set(0, 0.66, 0.38);
    g.add(belly);
    const head = mesh(geos.sphere, mats.heroBlue, 0.42, 0.4, 0.42);
    head.position.set(0, 1.22, 0.08);
    g.add(head);
    parts.head = head;
    const core = mesh(geos.sphere, mats.cyan, 0.1, 0.1, 0.1);
    core.position.set(0, 0.78, 0.5);
    g.add(core);

    const spikeGroup = new THREE.Group();
    const back = [
      [0, 0.95, -0.15, 0.22, 1.15, 0, 1.05],
      [-0.28, 0.9, -0.05, 0.2, 1.0, 0.45, 0.9],
      [0.28, 0.9, -0.05, 0.2, 1.0, -0.45, 0.9],
      [-0.48, 0.78, 0.05, 0.16, 0.78, 0.85, 0.7],
      [0.48, 0.78, 0.05, 0.16, 0.78, -0.85, 0.7],
    ];
    back.forEach((s) => {
      const sp = mesh(geos.cone, mats.heroSpike, s[3], s[4] / 2, s[3]);
      sp.position.set(s[0], s[1], s[2]);
      sp.rotation.x = s[6];
      sp.rotation.z = s[5];
      spikeGroup.add(sp);
    });
    [[-0.12, 1.48, -0.02, -0.15], [0.12, 1.5, -0.05, 0.15], [0, 1.55, -0.1, 0]].forEach((s) => {
      const sp = mesh(geos.cone, mats.heroSpike, 0.11, 0.32, 0.11);
      sp.position.set(s[0], s[1], s[2]);
      sp.rotation.x = 0.35;
      sp.rotation.z = s[3];
      spikeGroup.add(sp);
    });
    g.add(spikeGroup);
    parts.spikes = spikeGroup;

    const earL = mesh(geos.cone, mats.heroBlue, 0.1, 0.16, 0.1);
    earL.position.set(-0.22, 1.48, 0.1);
    earL.rotation.z = 0.55;
    const earR = earL.clone();
    earR.position.x = 0.22;
    earR.rotation.z = -0.55;
    g.add(earL, earR);

    function eye(x) {
      const e = new THREE.Group();
      const w = mesh(geos.sphere, mats.eyeWhite, 0.11, 0.13, 0.08);
      const ir = mesh(geos.sphere, mats.eyeGold, 0.07, 0.07, 0.05);
      ir.position.z = 0.05;
      const pu = mesh(geos.sphere, mats.eyeBlack, 0.035, 0.035, 0.03);
      pu.position.z = 0.08;
      e.add(w, ir, pu);
      e.position.set(x, 1.26, 0.38);
      return e;
    }
    g.add(eye(-0.13), eye(0.13));
    const snout = mesh(geos.sphere, mats.heroBelly, 0.16, 0.12, 0.16);
    snout.position.set(0, 1.12, 0.4);
    g.add(snout);
    const nose = mesh(geos.sphere, mats.heroDark, 0.05, 0.04, 0.04);
    nose.position.set(0, 1.14, 0.54);
    g.add(nose);

    const aL = mesh(geos.cyl, mats.heroBlue, 0.1, 0.42, 0.1);
    aL.rotation.z = 0.3;
    aL.position.set(-0.52, 0.72, 0.08);
    const gloveL = mesh(geos.sphere, mats.heroDark, 0.13, 0.11, 0.13);
    gloveL.position.set(-0.68, 0.52, 0.1);
    const cuffL = mesh(geos.cyl, mats.heroGold, 0.12, 0.07, 0.12);
    cuffL.position.set(-0.62, 0.58, 0.1);
    g.add(aL, gloveL, cuffL);
    const aR = mesh(geos.cyl, mats.heroBlue, 0.1, 0.42, 0.1);
    aR.rotation.z = -0.3;
    aR.position.set(0.52, 0.72, 0.08);
    const gloveR = mesh(geos.sphere, mats.heroDark, 0.13, 0.11, 0.13);
    gloveR.position.set(0.68, 0.52, 0.1);
    const cuffR = mesh(geos.cyl, mats.heroGold, 0.12, 0.07, 0.12);
    cuffR.position.set(0.62, 0.58, 0.1);
    g.add(aR, gloveR, cuffR);

    function leg(x) {
      const lg = new THREE.Group();
      const thigh = mesh(geos.cyl, mats.heroBlue, 0.12, 0.28, 0.12);
      thigh.position.set(x, 0.38, 0);
      const boot = mesh(geos.sphere, mats.heroGold, 0.16, 0.11, 0.22);
      boot.position.set(x, 0.12, 0.08);
      const sole = mesh(geos.box, mats.heroDark, 0.16, 0.05, 0.26);
      sole.position.set(x, 0.04, 0.1);
      lg.add(thigh, boot, sole);
      return lg;
    }
    const legL = leg(-0.2), legR = leg(0.2);
    g.add(legL, legR);
    parts.legL = legL;
    parts.legR = legR;

    const gun = buildGunModel(0.9);
    gun.position.set(0.72, 0.48, 0.18);
    gun.rotation.set(-0.15, 0, -0.2);
    g.add(gun);
    parts.gun = gun;

    const sword = buildSwordModel(1.0);
    sword.position.set(-0.35, 0.95, -0.25);
    sword.rotation.set(-0.5, 0.2, 1.15);
    sword.visible = false;
    g.add(sword);
    parts.sword = sword;

    const bow = buildBowModel(1.15);
    bow.position.set(0.05, 0.95, -0.42);
    bow.rotation.set(0, 0, 0.15);
    bow.visible = false;
    g.add(bow);
    parts.bowBack = bow;

    const bowHeld = buildBowModel(1.25);
    bowHeld.position.set(0.15, 0.85, 0.55);
    bowHeld.rotation.set(0.1, 0.4, 0.2);
    bowHeld.visible = false;
    g.add(bowHeld);
    parts.bowHeld = bowHeld;

    g.add(blobShadow(0.85));
    const fill = new THREE.PointLight(0xc8d8ff, 1.35, 14, 1.6);
    fill.position.set(0, 2.2, 1.4);
    g.add(fill);
    g.userData.parts = parts;
    player.group = g;
    player.parts = parts;
    scene.add(g);
    return g;
  }

  function addEyes(parent, xOff, y, z, s, iris) {
    for (const sgn of [-1, 1]) {
      const w = mesh(geos.sphere, mats.eyeWhite, 0.10 * s, 0.11 * s, 0.08 * s);
      w.position.set(sgn * xOff, y, z);
      const ir = mesh(geos.sphere, iris || mats.eyeGold, 0.06 * s, 0.06 * s, 0.05 * s);
      ir.position.set(sgn * xOff, y, z + 0.04 * s);
      const pu = mesh(geos.sphere, mats.eyeBlack, 0.03 * s);
      pu.position.set(sgn * xOff, y, z + 0.07 * s);
      parent.add(w, ir, pu);
    }
  }
  function hitShell(sx, sy, sz) {
    const m = mesh(geos.sphere, new THREE.MeshBasicMaterial({
      color: 0xffeedd, transparent: true, opacity: 0, depthWrite: false
    }), sx, sy, sz);
    m.castShadow = m.receiveShadow = false;
    m.userData.hitShell = true;
    return m;
  }

  function buildImp() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(geos.sphere, mats.imp, 0.32, 0.38, 0.28));
    const belly = mesh(geos.sphere, mats.impGlow, 0.18, 0.2, 0.1);
    belly.position.set(0, -0.05, 0.22);
    body.add(belly);
    body.position.y = 0.95;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.imp, 0.24, 0.22, 0.24));
    addEyes(head, 0.09, 0.04, 0.16, 0.95, mats.impGlow);
    const brow = mesh(geos.box, mats.impDark, 0.22, 0.04, 0.06);
    brow.position.set(0, 0.1, 0.18);
    head.add(brow);
    const snout = mesh(geos.sphere, mats.imp, 0.1, 0.08, 0.12);
    snout.position.set(0, -0.04, 0.22);
    head.add(snout);
    for (const s of [-1, 1]) {
      const fang = mesh(geos.cone, mats.eyeWhite, 0.025, 0.08, 0.025);
      fang.position.set(s * 0.05, -0.1, 0.26);
      fang.rotation.x = Math.PI;
      head.add(fang);
      const ear = mesh(geos.cone, mats.impDark, 0.07, 0.22, 0.05);
      ear.position.set(s * 0.16, 0.16, -0.02);
      ear.rotation.z = s * -0.5;
      head.add(ear);
      const horn = mesh(geos.cone, mats.bossHorn, 0.05, 0.28, 0.05);
      horn.position.set(s * 0.1, 0.28, 0);
      horn.rotation.z = s * 0.35;
      head.add(horn);
    }
    head.position.set(0, 1.38, 0.06);
    parts.head = head;

    function arm(side) {
      const a = new THREE.Group();
      const up = mesh(geos.cyl, mats.imp, 0.055, 0.28, 0.055);
      up.position.y = -0.14;
      const hand = mesh(geos.sphere, mats.impDark, 0.07);
      hand.position.y = -0.3;
      const claw = mesh(geos.cone, mats.bossHorn, 0.03, 0.12, 0.03);
      claw.position.set(0, -0.38, 0.04);
      a.add(up, hand, claw);
      a.position.set(side * 0.34, 1.08, 0.04);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);

    function leg(side) {
      const a = new THREE.Group();
      const th = mesh(geos.cyl, mats.impDark, 0.06, 0.28, 0.06);
      th.position.y = -0.14;
      const ft = mesh(geos.sphere, mats.impDark, 0.07, 0.05, 0.1);
      ft.position.set(0, -0.3, 0.04);
      a.add(th, ft);
      a.position.set(side * 0.14, 0.62, 0);
      return a;
    }
    parts.legL = leg(-1);
    parts.legR = leg(1);

    function wing(side) {
      const w = new THREE.Group();
      const bone = mesh(geos.cyl, mats.impDark, 0.03, 0.7, 0.03);
      bone.rotation.z = side * 1.15;
      bone.position.set(side * 0.28, 0.15, -0.04);
      const mem = mesh(new THREE.PlaneGeometry(0.7, 0.55), mats.impWing);
      mem.position.set(side * 0.42, 0.05, -0.05);
      mem.rotation.y = side * 0.25;
      const mem2 = mesh(new THREE.PlaneGeometry(0.4, 0.35), mats.impWing);
      mem2.position.set(side * 0.55, -0.12, -0.02);
      w.add(bone, mem, mem2);
      w.position.set(side * 0.12, 1.05, -0.08);
      return w;
    }
    parts.wingL = wing(-1);
    parts.wingR = wing(1);

    const tail = new THREE.Group();
    const ts = mesh(geos.cyl, mats.impDark, 0.04, 0.45, 0.03);
    ts.rotation.x = 0.9;
    ts.position.set(0, 0, -0.2);
    const barb = mesh(geos.cone, mats.impGlow, 0.06, 0.14, 0.06);
    barb.position.set(0, -0.12, -0.4);
    tail.position.set(0, 0.85, -0.2);
    tail.add(ts, barb);
    parts.tail = tail;

    const shell = hitShell(0.55, 0.7, 0.5);
    shell.position.y = 1.0;
    g.add(body, head, parts.armL, parts.armR, parts.legL, parts.legR, parts.wingL, parts.wingR, tail, shell, blobShadow(0.5));
    g.userData.parts = parts;
    g.userData.wings = [parts.wingL, parts.wingR];
    g.userData.hitShell = shell;
    return g;
  }

  function buildHound() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(geos.sphere, mats.hound, 0.42, 0.32, 0.7));
    const chest = mesh(geos.sphere, mats.hound, 0.38, 0.32, 0.35);
    chest.position.set(0, 0.05, 0.4);
    body.add(chest);
    for (let i = 0; i < 4; i++) {
      const sp = mesh(geos.cone, mats.houndDark, 0.08, 0.22, 0.08);
      sp.position.set(0, 0.28, 0.3 - i * 0.22);
      sp.rotation.x = -0.5;
      body.add(sp);
    }
    body.position.y = 0.72;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.hound, 0.26, 0.22, 0.3));
    addEyes(head, 0.1, 0.08, 0.18, 1.05, mats.houndEye);
    const snout = mesh(geos.box, mats.hound, 0.2, 0.12, 0.28);
    snout.position.set(0, -0.02, 0.28);
    head.add(snout);
    const jaw = new THREE.Group();
    jaw.add(mesh(geos.box, mats.houndDark, 0.18, 0.07, 0.24));
    jaw.position.set(0, -0.1, 0.22);
    parts.jaw = jaw;
    head.add(jaw);
    for (const s of [-1, 1]) {
      const horn = mesh(geos.cone, mats.bossHorn, 0.07, 0.42, 0.07);
      horn.position.set(s * 0.16, 0.28, -0.02);
      horn.rotation.z = s * 0.35;
      horn.rotation.x = -0.25;
      head.add(horn);
      const tusk = mesh(geos.cone, mats.eyeWhite, 0.03, 0.14, 0.03);
      tusk.position.set(s * 0.1, -0.06, 0.38);
      tusk.rotation.x = 1.9;
      head.add(tusk);
      const ear = mesh(geos.cone, mats.houndDark, 0.06, 0.18, 0.04);
      ear.position.set(s * 0.16, 0.2, -0.08);
      ear.rotation.z = s * -0.3;
      head.add(ear);
    }
    head.position.set(0, 0.95, 0.72);
    parts.head = head;

    function leg(x, z, name) {
      const a = new THREE.Group();
      const up = mesh(geos.cyl, mats.houndDark, 0.08, 0.38, 0.08);
      up.position.y = -0.16;
      const paw = mesh(geos.sphere, mats.houndDark, 0.09, 0.06, 0.12);
      paw.position.set(0, -0.36, 0.04);
      a.add(up, paw);
      a.position.set(x, 0.42, z);
      parts[name] = a;
      return a;
    }
    const tail = new THREE.Group();
    tail.add(mesh(geos.cone, mats.houndDark, 0.09, 0.6, 0.05));
    tail.rotation.x = 1.05;
    tail.position.set(0, 0.75, -0.7);
    parts.tail = tail;

    const shell = hitShell(0.7, 0.55, 1.0);
    shell.position.set(0, 0.7, 0.15);
    g.add(body, head, leg(-0.26, 0.38, "legFL"), leg(0.26, 0.38, "legFR"),
      leg(-0.26, -0.32, "legBL"), leg(0.26, -0.32, "legBR"), tail, shell, blobShadow(0.75));
    parts.legL = parts.legFL;
    parts.legR = parts.legFR;
    g.userData.parts = parts;
    g.userData.hitShell = shell;
    return g;
  }

  function buildGuard() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(geos.sphere, mats.gobSkin, 0.32, 0.36, 0.26));
    const plate = mesh(geos.box, mats.gobArmor, 0.42, 0.32, 0.18);
    plate.position.set(0, 0.02, 0.14);
    body.add(plate);
    for (const s of [-1, 1]) {
      const sh = mesh(geos.sphere, mats.gobArmor, 0.14, 0.1, 0.14);
      sh.position.set(s * 0.28, 0.16, 0);
      body.add(sh);
    }
    body.position.y = 0.95;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.gobSkin, 0.22, 0.2, 0.2));
    addEyes(head, 0.08, 0.04, 0.14, 0.9, mats.houndEye);
    const nose = mesh(geos.cone, mats.gobDark, 0.05, 0.12, 0.05);
    nose.rotation.x = 1.3;
    nose.position.set(0, -0.02, 0.2);
    head.add(nose);
    const helm = mesh(geos.sphere, mats.gobArmor, 0.24, 0.16, 0.22);
    helm.position.y = 0.1;
    head.add(helm);
    for (const s of [-1, 1]) {
      const ear = mesh(geos.cone, mats.gobSkin, 0.06, 0.2, 0.04);
      ear.position.set(s * 0.18, 0.1, -0.02);
      ear.rotation.z = s * -0.7;
      head.add(ear);
      const tusk = mesh(geos.cone, mats.eyeWhite, 0.025, 0.1, 0.025);
      tusk.position.set(s * 0.06, -0.1, 0.16);
      tusk.rotation.x = 2.2;
      head.add(tusk);
    }
    head.position.set(0, 1.42, 0.04);
    parts.head = head;

    function arm(side) {
      const a = new THREE.Group();
      const up = mesh(geos.cyl, mats.gobSkin, 0.06, 0.32, 0.06);
      up.position.y = -0.16;
      const hand = mesh(geos.sphere, mats.gobDark, 0.07);
      hand.position.y = -0.34;
      a.add(up, hand);
      if (side > 0) {
        const axe = new THREE.Group();
        const haft = mesh(geos.cyl, mats.gobLeather, 0.03, 0.55, 0.03);
        const blade = mesh(geos.box, mats.gobArmor, 0.22, 0.16, 0.04);
        blade.position.set(0.12, 0.22, 0);
        axe.add(haft, blade);
        axe.position.set(0.05, -0.35, 0);
        a.add(axe);
        parts.weapon = axe;
      }
      a.position.set(side * 0.36, 1.12, 0);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);

    function leg(side) {
      const a = new THREE.Group();
      a.add(mesh(geos.cyl, mats.gobLeather, 0.07, 0.34, 0.07));
      const boot = mesh(geos.box, mats.gobLeather, 0.12, 0.08, 0.18);
      boot.position.set(0, -0.22, 0.04);
      a.children[0].position.y = -0.05;
      a.add(boot);
      a.position.set(side * 0.12, 0.55, 0);
      return a;
    }
    parts.legL = leg(-1);
    parts.legR = leg(1);
    const shell = hitShell(0.5, 0.8, 0.45);
    shell.position.y = 1.0;
    g.add(body, head, parts.armL, parts.armR, parts.legL, parts.legR, shell, blobShadow(0.55));
    g.userData.parts = parts;
    g.userData.hitShell = shell;
    return g;
  }

  function buildGolem() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(geos.box, mats.golem, 0.9, 1.1, 0.6));
    const rune = mesh(geos.box, mats.golemRune, 0.28, 0.36, 0.04);
    rune.position.set(0, 0.1, 0.32);
    body.add(rune);
    const moss = mesh(geos.box, mats.golemMoss, 0.4, 0.18, 0.2);
    moss.position.set(0.2, 0.4, 0.22);
    body.add(moss);
    body.position.y = 1.15;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.box, mats.golem, 0.5, 0.42, 0.45));
    addEyes(head, 0.12, 0.06, 0.22, 1.15, mats.golemRune);
    const brow = mesh(geos.box, mats.golem, 0.48, 0.08, 0.1);
    brow.position.set(0, 0.16, 0.2);
    head.add(brow);
    const jaw = mesh(geos.box, mats.golem, 0.36, 0.1, 0.2);
    jaw.position.set(0, -0.2, 0.12);
    head.add(jaw);
    parts.jaw = jaw;
    head.position.set(0, 1.95, 0.05);
    parts.head = head;

    function arm(side) {
      const a = new THREE.Group();
      const up = mesh(geos.box, mats.golem, 0.28, 0.8, 0.28);
      up.position.y = -0.3;
      const fist = mesh(geos.box, mats.golem, 0.34, 0.28, 0.34);
      fist.position.y = -0.75;
      a.add(up, fist);
      a.position.set(side * 0.7, 1.45, 0);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);
    function leg(side) {
      const a = new THREE.Group();
      const th = mesh(geos.box, mats.golem, 0.28, 0.7, 0.28);
      th.position.y = -0.2;
      const ft = mesh(geos.box, mats.golem, 0.32, 0.16, 0.4);
      ft.position.set(0, -0.58, 0.06);
      a.add(th, ft);
      a.position.set(side * 0.24, 0.7, 0);
      return a;
    }
    parts.legL = leg(-1);
    parts.legR = leg(1);
    const shell = hitShell(0.85, 1.1, 0.7);
    shell.position.y = 1.2;
    g.add(body, head, parts.armL, parts.armR, parts.legL, parts.legR, shell, blobShadow(0.95));
    g.userData.parts = parts;
    g.userData.hitShell = shell;
    return g;
  }

  function buildEmberhorn() {
    const g = new THREE.Group();
    const parts = {};

    function leg(side) {
      const a = new THREE.Group();
      const th = mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.05, 6), mats.bossRock);
      th.position.y = -0.35;
      const ft = mesh(geos.sphere, mats.bossRock, 0.28, 0.16, 0.38);
      ft.position.set(0, -0.88, 0.1);
      const hoof = mesh(geos.box, mats.bossHorn, 0.22, 0.1, 0.3);
      hoof.position.set(0, -0.98, 0.12);
      a.add(th, ft, hoof);
      a.position.set(side * 0.58, 1.05, 0.08);
      return a;
    }
    parts.legL = leg(-1);
    parts.legR = leg(1);

    const body = new THREE.Group();
    const torso = mesh(new THREE.SphereGeometry(1.15, 12, 10), mats.bossRock);
    torso.scale.set(1.08, 1.12, 0.85);
    body.add(torso);
    const belly = mesh(geos.sphere, mats.bossLava, 0.55, 0.62, 0.3);
    belly.position.set(0, -0.08, 0.82);
    body.add(belly);
    for (let i = 0; i < 3; i++) {
      const cr = mesh(geos.box, mats.bossLava, 0.07, 0.55, 0.05);
      cr.position.set((i - 1) * 0.22, 0.12, 0.92);
      cr.rotation.z = (i - 1) * 0.18;
      body.add(cr);
    }
    body.position.y = 1.9;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.bossRock, 0.72, 0.62, 0.72));
    addEyes(head, 0.2, 0.12, 0.52, 1.2, mats.bossLava);
    const brow = mesh(geos.box, mats.bossRock, 0.7, 0.14, 0.18);
    brow.position.set(0, 0.28, 0.5);
    head.add(brow);
    const snout = mesh(geos.box, mats.bossRock, 0.42, 0.22, 0.36);
    snout.position.set(0, -0.1, 0.62);
    head.add(snout);
    const jaw = new THREE.Group();
    jaw.add(mesh(geos.box, mats.bossHorn, 0.38, 0.12, 0.3));
    jaw.position.set(0, -0.28, 0.5);
    parts.jaw = jaw;
    head.add(jaw);
    for (const s of [-1, 1]) {
      const h1 = mesh(new THREE.ConeGeometry(0.18, 1.55, 6), mats.bossHorn);
      h1.position.set(s * 0.48, 1.0, 0.02);
      h1.rotation.z = s * 0.42;
      h1.rotation.x = -0.18;
      head.add(h1);
      const h2 = mesh(new THREE.ConeGeometry(0.1, 0.65, 6), mats.bossHorn);
      h2.position.set(s * 0.62, 0.42, 0.1);
      h2.rotation.z = s * 0.85;
      head.add(h2);
    }
    head.position.set(0, 3.15, 0.42);
    parts.head = head;

    function arm(side) {
      const a = new THREE.Group();
      const up = mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.15, 6), mats.bossRock);
      up.position.y = -0.45;
      const claw = mesh(geos.cone, mats.bossHorn, 0.14, 0.4, 0.14);
      claw.position.set(0, -1.1, 0.12);
      claw.rotation.x = 0.4;
      a.add(up, claw);
      a.position.set(side * 1.2, 2.2, 0.2);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);

    function wing(side) {
      const w = new THREE.Group();
      const bone = mesh(new THREE.CylinderGeometry(0.07, 0.05, 1.55, 6), mats.bossHorn);
      bone.rotation.z = side * 1.05;
      bone.position.set(side * 0.7, 0.35, -0.08);
      const fin = mesh(geos.box, mats.bossRock, 1.15, 0.1, 0.65);
      fin.position.set(side * 0.85, 0.12, -0.12);
      fin.rotation.y = side * 0.3;
      fin.rotation.z = side * 0.22;
      const glow = mesh(geos.box, mats.bossLava, 0.85, 0.05, 0.14);
      glow.position.set(side * 0.85, 0.14, -0.06);
      glow.rotation.y = side * 0.3;
      w.add(bone, fin, glow);
      w.position.set(side * 0.55, 2.25, -0.35);
      return w;
    }
    parts.wingL = wing(-1);
    parts.wingR = wing(1);

    const tail = mesh(new THREE.CylinderGeometry(0.06, 0.22, 1.8, 6), mats.bossRock);
    tail.position.set(0, 1.25, -1.15);
    tail.rotation.x = 1.05;
    parts.tail = tail;
    const shell = hitShell(1.55, 2.0, 1.35);
    shell.position.y = 1.85;
    const light = new THREE.PointLight(0xff3a10, 1.15, 11, 1.5);
    light.position.set(0, 2.0, 1.0);
    g.add(body, head, parts.wingL, parts.wingR, parts.armL, parts.armR, parts.legL, parts.legR, tail, shell, light, blobShadow(2.0));
    g.userData.parts = parts;
    g.userData.wings = [parts.wingL, parts.wingR];
    g.userData.hitShell = shell;
    return g;
  }

  function buildVoidmaw() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(new THREE.SphereGeometry(1.5, 12, 10), mats.voidBody));
    body.position.y = 2.1;
    for (let i = 0; i < 7; i++) {
      const sp = mesh(geos.cone, mats.voidGlow, 0.18, 1.1, 0.18);
      const a = (i / 7) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 1.2, 0.3, Math.sin(a) * 1.2);
      sp.lookAt(0, 4, 0);
      body.add(sp);
    }
    const core = mesh(geos.sphere, mats.voidGlow, 0.45);
    core.position.y = 0.1;
    body.add(core);
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.voidBody, 0.95, 0.7, 1.05));
    addEyes(head, 0.28, 0.15, 0.7, 1.4, mats.voidGlow);
    const maw = new THREE.Group();
    const jaw = mesh(geos.cone, mats.voidGlow, 0.4, 0.7, 0.4);
    jaw.rotation.x = Math.PI / 2;
    maw.add(jaw);
    maw.position.set(0, -0.2, 0.85);
    parts.jaw = maw;
    head.add(maw);
    for (const s of [-1, 1]) {
      const tusk = mesh(geos.cone, mats.eyeWhite, 0.08, 0.4, 0.08);
      tusk.position.set(s * 0.28, -0.25, 0.7);
      tusk.rotation.x = 2.2;
      head.add(tusk);
    }
    head.position.set(0, 3.55, 0.7);
    parts.head = head;

    function wing(side) {
      const w = new THREE.Group();
      const bone = mesh(new THREE.CylinderGeometry(0.07, 0.04, 2.8, 6), mats.voidGlow);
      bone.rotation.z = side * 1.0;
      bone.position.set(side * 1.3, 0.4, -0.1);
      const mem = mesh(new THREE.PlaneGeometry(2.4, 1.5), mats.voidBody.clone());
      mem.material.side = THREE.DoubleSide;
      mem.position.set(side * 1.7, 0.15, -0.1);
      mem.rotation.y = side * 0.4;
      w.add(bone, mem);
      w.position.set(side * 0.7, 2.5, -0.2);
      return w;
    }
    parts.wingL = wing(-1);
    parts.wingR = wing(1);
    function arm(side) {
      const a = new THREE.Group();
      a.add(mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.5, 6), mats.voidBody));
      a.children[0].position.y = -0.5;
      const claw = mesh(geos.cone, mats.voidGlow, 0.12, 0.4, 0.12);
      claw.position.y = -1.2;
      a.add(claw);
      a.position.set(side * 1.3, 2.2, 0.3);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);
    const shell = hitShell(1.8, 2.2, 1.8);
    shell.position.y = 2.3;
    const light = new THREE.PointLight(0xaa44ff, 1.6, 14, 1.5);
    light.position.set(0, 2.4, 0);
    g.add(body, head, parts.wingL, parts.wingR, parts.armL, parts.armR, shell, light, blobShadow(2.2));
    g.userData.parts = parts;
    g.userData.wings = [parts.wingL, parts.wingR];
    g.userData.hitShell = shell;
    return g;
  }

  function buildStormrend() {
    const g = new THREE.Group();
    const parts = {};
    const body = new THREE.Group();
    body.add(mesh(new THREE.CylinderGeometry(1.05, 1.45, 2.8, 8), mats.stormBody));
    const plate = mesh(geos.box, mats.stormGlow, 0.7, 0.16, 0.12);
    plate.position.set(0, 0.4, 1.15);
    body.add(plate);
    body.position.y = 2.1;
    parts.body = body;

    const head = new THREE.Group();
    head.add(mesh(geos.sphere, mats.stormBody, 0.85, 0.75, 0.9));
    addEyes(head, 0.22, 0.1, 0.62, 1.35, mats.stormGlow);
    const jaw = mesh(geos.box, mats.stormBody, 0.55, 0.16, 0.4);
    jaw.position.set(0, -0.35, 0.4);
    head.add(jaw);
    parts.jaw = jaw;
    const crown = mesh(new THREE.ConeGeometry(0.45, 1.1, 5), mats.stormGlow);
    crown.position.y = 0.95;
    head.add(crown);
    head.position.set(0, 3.85, 0.2);
    parts.head = head;

    function arm(side) {
      const a = new THREE.Group();
      const up = mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.8, 6), mats.stormBody);
      up.position.y = -0.6;
      const fist = mesh(geos.sphere, mats.stormGlow, 0.28);
      fist.position.y = -1.5;
      a.add(up, fist);
      a.position.set(side * 1.5, 2.5, 0.15);
      return a;
    }
    parts.armL = arm(-1);
    parts.armR = arm(1);
    function leg(side) {
      const a = new THREE.Group();
      const th = mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 6), mats.stormBody);
      th.position.y = -0.4;
      const ft = mesh(geos.box, mats.stormBody, 0.36, 0.18, 0.5);
      ft.position.set(0, -1.1, 0.08);
      a.add(th, ft);
      a.position.set(side * 0.4, 1.15, 0);
      return a;
    }
    parts.legL = leg(-1);
    parts.legR = leg(1);
    const shell = hitShell(1.7, 2.4, 1.4);
    shell.position.y = 2.2;
    const light = new THREE.PointLight(0x40a0ff, 1.6, 14, 1.5);
    light.position.set(0, 3, 0);
    g.add(body, head, parts.armL, parts.armR, parts.legL, parts.legR, shell, light, blobShadow(2.0));
    g.userData.parts = parts;
    g.userData.hitShell = shell;
    return g;
  }

  function animateEnemy(e, dt, moving, attacking) {
    const g = e.mesh;
    const p = g.userData.parts || {};
    const shell = g.userData.hitShell;
    if (shell && shell.material) shell.material.opacity = e.hitT > 0 ? 0.45 : 0;

    if (e.dying) {
      e.deathT -= dt;
      const k = Math.max(0, e.deathT / 0.7);
      g.rotation.x = lerp(g.rotation.x, 1.25, 0.12);
      g.position.y = Math.max(0, g.position.y - dt * 0.8);
      g.scale.setScalar(0.55 + 0.45 * k);
      if (e.deathT <= 0) finishDead(e);
      return;
    }

    const bob = moving ? Math.sin(time * 10) * 0.04 : Math.sin(time * 2.5) * 0.02;
    if (p.body) p.body.position.y += (bob - (p.body.userData._bob || 0));
    if (p.body) p.body.userData._bob = bob;
    const swing = moving ? Math.sin(time * 9) * 0.55 : 0;
    if (p.legL) p.legL.rotation.x = swing;
    if (p.legR) p.legR.rotation.x = -swing;
    if (p.legFL) p.legFL.rotation.x = swing;
    if (p.legFR) p.legFR.rotation.x = -swing;
    if (p.legBL) p.legBL.rotation.x = -swing;
    if (p.legBR) p.legBR.rotation.x = swing;
    if (p.armL) p.armL.rotation.x = attacking ? 0.4 : (moving ? -swing * 0.5 : Math.sin(time * 2) * 0.08);
    if (p.armR) p.armR.rotation.x = attacking ? -1.15 : (moving ? swing * 0.5 : Math.sin(time * 2 + 1) * 0.08);
    if (p.head) p.head.rotation.x = attacking ? 0.2 : Math.sin(time * 2.2) * 0.06;
    if (p.jaw) p.jaw.rotation.x = attacking ? 0.35 : Math.max(0, Math.sin(time * 3) * 0.1);
    if (p.tail) p.tail.rotation.y = Math.sin(time * 4) * 0.25;
    if (p.wingL) p.wingL.rotation.z = Math.sin(time * (e.typ === "imp" ? 12 : 2.4)) * (e.typ === "imp" ? 0.45 : 0.18);
    if (p.wingR) p.wingR.rotation.z = -Math.sin(time * (e.typ === "imp" ? 12 : 2.4)) * (e.typ === "imp" ? 0.45 : 0.18);
    if (e.hitT > 0) g.scale.setScalar(0.94);
    else g.scale.setScalar(1);
  }

  function finishDead(e) {
    if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh);
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
  }

  function aliveCount() {
    let n = 0;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].dying) n++;
    return n;
  }

  function buildPickupMesh(type) {
    const g = new THREE.Group();
    if (type === "sword") {
      const s = buildSwordModel(0.85);
      s.rotation.z = -0.4;
      g.add(s);
    } else if (type === "gun") {
      const s = buildGunModel(1.3);
      s.rotation.y = 0.4;
      g.add(s);
    } else if (type === "bow") {
      const s = buildBowModel(1.1);
      s.rotation.y = 0.3;
      g.add(s);
    } else {
      const orb = mesh(geos.sphere, mats.pickupPower, 0.38);
      g.add(orb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 16), mats.cyanLine);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.add(blobShadow(0.45));
    return g;
  }

  function burst(x, y, z, color, n, speed, life) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geos.sphereLo, new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 1, depthWrite: false,
      }));
      m.scale.setScalar(rand(0.05, 0.16));
      m.position.set(x, y, z);
      m.userData.v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).setLength(rand(2, speed));
      m.userData.life = life;
      m.userData.max = life;
      scene.add(m);
      particles.push(m);
    }
  }

  function floater(text, x, y, z, color) {
    const node = document.createElement("div");
    node.textContent = text;
    node.style.cssText = "position:fixed;pointer-events:none;font-weight:800;font-size:14px;text-shadow:0 1px 3px #000;z-index:6";
    node.style.color = color || "#fff4d0";
    document.body.appendChild(node);
    floaters.push({ el: node, x, y, z, t: 0.85 });
  }

  function projectFloater(f) {
    const v = new THREE.Vector3(f.x, f.y, f.z).project(camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    f.el.style.transform = "translate(" + sx + "px," + (sy - (1 - f.t) * 28) + "px)";
    f.el.style.opacity = String(Math.max(0, f.t * 1.4));
  }

  function edgePos(clearR) {
    let x = 0, z = 0, ok = false, guard = 0;
    const zn = ZONES[irand(0, ZONES.length - 1)];
    while (!ok && guard++ < 24) {
      const a = Math.random() * Math.PI * 2;
      x = zn.x + Math.cos(a) * rand(4, zn.rx - 2);
      z = zn.z + Math.sin(a) * rand(4, zn.rz - 2);
      x = clamp(x, WORLD.minX + 4, WORLD.maxX - 4);
      z = clamp(z, WORLD.minZ + 4, WORLD.maxZ - 4);
      ok = true;
      if (player.group && len2(x - player.group.position.x, z - player.group.position.z) < (clearR || 10)) ok = false;
      for (const p of pillars) if (len2(x - p.x, z - p.z) < 3) ok = false;
    }
    return { x: x, z: z };
  }

  function spawnEnemy(kind) {
    const pos = edgePos(12);
    let meshG, hp, spd, dmg, radius, scoreV;
    const typ = kind || (Math.random() < 0.25 ? "imp" : Math.random() < 0.5 ? "hound" : Math.random() < 0.75 ? "guard" : "golem");
    if (typ === "imp") {
      meshG = buildImp(); hp = 22 + wave * 6; spd = 5.5 + wave * 0.15; dmg = 7; radius = 0.6; scoreV = 100;
    } else if (typ === "hound") {
      meshG = buildHound(); hp = 34 + wave * 8; spd = 7.2 + wave * 0.2; dmg = 10; radius = 0.85; scoreV = 150;
    } else if (typ === "golem") {
      meshG = buildGolem(); hp = 95 + wave * 16; spd = 2.8 + wave * 0.06; dmg = 16; radius = 1.05; scoreV = 300;
    } else {
      meshG = buildGuard(); hp = 55 + wave * 12; spd = 4.2 + wave * 0.1; dmg = 12; radius = 0.7; scoreV = 200;
    }
    meshG.position.set(pos.x, 0, pos.z);
    scene.add(meshG);
    const e = { mesh: meshG, typ, hp, maxHp: hp, spd, dmg, radius, score: scoreV, atkCd: rand(0.4, 1.2), hitT: 0, yaw: 0, boss: false, phase: 0, homeX: pos.x, homeZ: pos.z };
    enemies.push(e);
    return e;
  }

  const BOSS_DEFS = [
    { name: "EMBERHORN", build: buildEmberhorn, hp: 900, typ: "emberhorn" },
    { name: "VOIDMAW", build: buildVoidmaw, hp: 1100, typ: "voidmaw" },
    { name: "STORMREND", build: buildStormrend, hp: 1300, typ: "stormrend" },
  ];

  function spawnBoss(idx) {
    const def = BOSS_DEFS[(idx != null ? idx : Math.floor((wave / 3) - 1) + 3) % BOSS_DEFS.length];
    const meshG = def.build();
    const px = player.group ? player.group.position.x : 0;
    const pz = player.group ? player.group.position.z : 8;
    const lair = (idx != null) ? LAIRS.find((L) => L.bossIdx === idx) : null;
    let bx, bz;
    if (lair) { bx = lair.x; bz = lair.z; }
    else {
      const yaw = player.yaw || 0;
      bx = clamp(px + Math.sin(yaw) * 12, WORLD.minX + 6, WORLD.maxX - 6);
      bz = clamp(pz + Math.cos(yaw) * 12, WORLD.minZ + 6, WORLD.maxZ - 6);
    }
    const face = Math.atan2(px - bx, pz - bz);
    meshG.position.set(bx, 0, bz);
    meshG.rotation.y = face;
    scene.add(meshG);
    const hp = def.hp + Math.max(0, wave - 3) * 220;
    const e = {
      mesh: meshG, typ: def.typ, name: def.name, hp, maxHp: hp,
      spd: 3.6, dmg: 18, radius: 2.4, score: 2500, atkCd: 1.6,
      hitT: 0, yaw: face, boss: true, phase: 0, addSpawned: false,
      _lair: lair || null,
    };
    enemies.push(e);
    bossRef = e;
    el("boss-name").textContent = def.name;
    el("boss-wrap").classList.add("show");
    updateBossBar();
    toast(def.name);
    if (window.AudioFX) AudioFX.boss();
    return e;
  }

  function spawnPickup(type, x, z) {
    const types = ["sword", "gun", "bow", "heal", "shield", "overdrive", "nova"];
    const typ = type || types[irand(0, types.length - 1)];
    const isPower = typ === "heal" || typ === "shield" || typ === "overdrive" || typ === "nova";
    const meshG = buildPickupMesh(isPower ? "power" : typ);
    meshG.position.set(x, 0.7, z);
    scene.add(meshG);
    pickups.push({ mesh: meshG, typ, t: 0, life: 22 });
  }

  function addScore(n, x, y, z) {
    const mul = 1 + Math.min(combo, 8) * 0.15;
    const got = Math.round(n * mul);
    score += got;
    combo++;
    comboT = 2.1;
    el("score-v").textContent = String(score);
    const cEl = el("combo");
    if (combo >= 2) {
      cEl.textContent = "COMBO x" + combo;
      cEl.classList.add("show");
    }
    if (x != null) floater("+" + got, x, y, z, "#ffd36a");
  }

  function hurtPlayer(dmg) {
    if (player.invuln > 0) return;
    if (activePower === "shield") {
      activePower = null;
      powerT = 0;
      updatePowerTag();
      burst(player.group.position.x, 1, player.group.position.z, 0x66ddff, 10, 5, 0.4);
      if (window.AudioFX) AudioFX.power();
      player.invuln = 0.5;
      return;
    }
    player.hp -= dmg;
    player.invuln = 0.85;
    if (window.AudioFX) AudioFX.hurt();
    flashT = 0.12;
    updateHP();
    if (player.hp <= 0) {
      player.hp = 0;
      updateHP();
      gameOver();
    }
  }

  function hurtEnemy(e, dmg, hx, hy, hz) {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.hitT = 0.12;
    if (window.AudioFX) AudioFX.hit();
    floater(String(Math.round(dmg)), hx, hy, hz, e.boss ? "#ff9a4a" : "#fff");
    if (e.boss) updateBossBar();
    if (e.hp <= 0) killEnemy(e);
  }

  function dropFrom(e) {
    const chance = e.boss ? 1 : e.typ === "guard" ? 0.45 : 0.28;
    if (Math.random() > chance) return;
    if (e.boss) {
      const pos = e.mesh.position;
      spawnPickup("sword", pos.x + 1.2, pos.z);
      spawnPickup("gun", pos.x - 1.2, pos.z);
      spawnPickup("bow", pos.x, pos.z + 1.4);
      spawnPickup(["heal", "shield", "overdrive", "nova"][irand(0, 3)], pos.x, pos.z - 1.4);
    } else {
      spawnPickup(["sword", "gun", "bow", "heal", "shield", "overdrive", "nova"][irand(0, 6)], e.mesh.position.x, e.mesh.position.z);
    }
  }

  function killEnemy(e) {
    if (e.dying) return;
    e.dying = true;
    e.deathT = e.boss ? 0.9 : 0.7;
    e.hp = 0;
    const p = e.mesh.position;
    addScore((e.score || 100) * wave, p.x, p.y + 1.4, p.z);
    kills++;
    burst(p.x, p.y + 1, p.z, e.boss ? 0xff5510 : 0xffaa66, e.boss ? 22 : 10, e.boss ? 9 : 5, 0.55);
    if (window.AudioFX) e.boss ? AudioFX.explode() : AudioFX.die();
    dropFrom(e);
    if (e.boss) {
      if (e._lair) e._lair.defeated = true;
      bossRef = null;
      el("boss-wrap").classList.remove("show");
    }
  }

  function fireGun() {
    if (player.gunCd > 0 || !player.group) return;
    const rate = (activePower === "overdrive" ? 0.09 : 0.2) - (player.gunLv - 1) * 0.018;
    player.gunCd = Math.max(0.08, rate);
    const origin = new THREE.Vector3();
    player.parts.gun.getWorldPosition(origin);
    let dirx = Math.sin(player.yaw), dirz = Math.cos(player.yaw);
    let best = null, bestDot = 0.55, bestD = 22;
    for (const e of enemies) {
      if (e.dying) continue;
      const dx = e.mesh.position.x - player.group.position.x;
      const dz = e.mesh.position.z - player.group.position.z;
      const d = len2(dx, dz);
      const dot = (dx * dirx + dz * dirz) / (d || 1);
      if (dot > bestDot && d < bestD) { bestDot = dot; bestD = d; best = e; }
    }
    if (best) {
      const dx = best.mesh.position.x - origin.x;
      const dz = best.mesh.position.z - origin.z;
      const d = len2(dx, dz) || 1;
      dirx = dx / d; dirz = dz / d;
    }
    const b = mesh(geos.sphere, mats.bullet, 0.11);
    b.position.copy(origin);
    scene.add(b);
    const dmg = (10 + player.gunLv * 4) * (activePower === "overdrive" ? 1.4 : 1);
    bullets.push({ mesh: b, vx: dirx * 38, vy: 0, vz: dirz * 38, life: 0.9, dmg, from: "player" });
    if (window.AudioFX) AudioFX.shoot();
  }

  function doSlash() {
    if (player.swordLv <= 0 || player.slashCd > 0) return;
    player.slashCd = 0.55 - player.swordLv * 0.04;
    if (window.AudioFX) AudioFX.slash();
    const reach = 2.3 + player.swordLv * 0.2;
    const dmg = 18 + player.swordLv * 8;
    const px = player.group.position.x, pz = player.group.position.z;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.6, reach, 10, 1, 0, Math.PI * 0.7),
      new THREE.MeshBasicMaterial({ color: 0xa0d8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = -player.yaw + 0.6;
    arc.position.set(px + fx * 0.4, 0.9, pz + fz * 0.4);
    scene.add(arc);
    particles.push(Object.assign(arc, { userData: { v: new THREE.Vector3(), life: 0.18, max: 0.18, fade: true } }));
    for (const e of enemies.slice()) {
      if (e.dying) continue;
      const dx = e.mesh.position.x - px, dz = e.mesh.position.z - pz;
      const d = len2(dx, dz);
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (d < reach + e.radius && dot > 0.15) {
        hurtEnemy(e, dmg, e.mesh.position.x, e.mesh.position.y + 1.2, e.mesh.position.z);
      }
    }
    if (player.parts.sword) {
      player.parts.sword.visible = true;
      player._slashVis = 0.25;
    }
  }

  function fireArrow(charge) {
    if (player.bowLv <= 0 || !player.group) return;
    const c = clamp(charge, 0, 1);
    if (c < 0.12) return;
    const origin = player.group.position.clone();
    origin.y = 1.05;
    origin.x += Math.sin(player.yaw) * 0.6;
    origin.z += Math.cos(player.yaw) * 0.6;
    let dirx = Math.sin(player.yaw), dirz = Math.cos(player.yaw);
    let best = null, bestDot = 0.6, bestD = 16 + c * 28;
    for (const e of enemies) {
      if (e.dying) continue;
      const dx = e.mesh.position.x - player.group.position.x;
      const dz = e.mesh.position.z - player.group.position.z;
      const d = len2(dx, dz);
      const dot = (dx * dirx + dz * dirz) / (d || 1);
      if (dot > bestDot && d < bestD) { bestDot = dot; bestD = d; best = e; }
    }
    if (best) {
      const dx = best.mesh.position.x - origin.x;
      const dz = best.mesh.position.z - origin.z;
      const d = len2(dx, dz) || 1;
      dirx = dx / d; dirz = dz / d;
    }
    const speed = 16 + c * 30 + player.bowLv * 1.5;
    const loft = 3.2 + c * 6.5;
    const g = buildArrowModel(c > 0.7);
    g.position.copy(origin);
    scene.add(g);
    const dmg = 16 + c * 52 + player.bowLv * 10;
    arrows.push({
      mesh: g, vx: dirx * speed, vy: loft, vz: dirz * speed,
      life: 3.2, dmg, charge: c, stuck: false, grav: 22 + (1 - c) * 8,
    });
    if (window.AudioFX) { AudioFX.bowDrawStop(); AudioFX.arrowFly(c); }
  }

  function activatePower() {
    if (!pendingPower) return;
    const p = pendingPower;
    pendingPower = null;
    if (p === "heal") {
      player.hp = Math.min(player.maxHp, player.hp + 40);
      updateHP();
      burst(player.group.position.x, 1, player.group.position.z, 0x44ff88, 14, 5, 0.5);
      if (window.AudioFX) AudioFX.power();
    } else if (p === "shield") {
      activePower = "shield";
      powerT = 9;
    } else if (p === "overdrive") {
      activePower = "overdrive";
      powerT = 8;
    } else if (p === "nova") {
      const px = player.group.position.x, pz = player.group.position.z;
      burst(px, 1, pz, 0xcc66ff, 28, 12, 0.6);
      if (window.AudioFX) AudioFX.explode();
      for (const e of enemies.slice()) {
        const d = len2(e.mesh.position.x - px, e.mesh.position.z - pz);
        if (d < 10) hurtEnemy(e, 55 + wave * 4, e.mesh.position.x, e.mesh.position.y + 1, e.mesh.position.z);
      }
    }
    updatePowerTag();
    updateSkillLocks();
  }

  function collectPickup(pk) {
    const t = pk.typ;
    const p = pk.mesh.position;
    if (t === "sword") {
      player.swordLv = Math.min(5, player.swordLv + 1);
      if (player.parts.sword) player.parts.sword.visible = true;
      floater("SWORD +" + player.swordLv, p.x, p.y + 0.8, p.z, "#c0d8ff");
    } else if (t === "gun") {
      player.gunLv = Math.min(5, player.gunLv + 1);
      floater("GUN +" + player.gunLv, p.x, p.y + 0.8, p.z, "#7ae0ff");
    } else if (t === "bow") {
      player.bowLv = Math.min(5, player.bowLv + 1);
      if (player.parts.bowBack) player.parts.bowBack.visible = true;
      floater("BOW +" + player.bowLv, p.x, p.y + 0.8, p.z, "#ffc44a");
    } else {
      pendingPower = t;
      floater(t.toUpperCase(), p.x, p.y + 0.8, p.z, "#80ffd0");
    }
    if (window.AudioFX) AudioFX.pickup();
    scene.remove(pk.mesh);
    const i = pickups.indexOf(pk);
    if (i >= 0) pickups.splice(i, 1);
    updateSkillLocks();
    updatePowerTag();
  }

  function resolveCircle(x, z, rad) {
    let px = clamp(x, WORLD.minX + rad, WORLD.maxX - rad);
    let pz = clamp(z, WORLD.minZ + rad, WORLD.maxZ - rad);
    for (const p of pillars) {
      const dx = px - p.x, dz = pz - p.z;
      const d = len2(dx, dz);
      const need = rad + p.r;
      if (d < need && d > 0.0001) {
        px = p.x + (dx / d) * need;
        pz = p.z + (dz / d) * need;
      }
    }
    px = clamp(px, WORLD.minX + rad, WORLD.maxX - rad);
    pz = clamp(pz, WORLD.minZ + rad, WORLD.maxZ - rad);
    return { x: px, z: pz };
  }

  function toast(msg) {
    const node = el("toast");
    node.textContent = msg;
    node.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => node.classList.remove("show"), 1400);
  }

  function beginWave(n) {
    wave = n;
    el("wave-v").textContent = String(wave);
    if (wave % 3 === 0) {
      wavePhase = "bossin";
      waveTimer = 25;
      const L = LAIRS[(Math.floor(wave / 3) - 1) % LAIRS.length];
      L.defeated = false;
      toast("LAIR STIRS");
    } else {
      wavePhase = "spawn";
      toSpawn = 4 + wave * 2;
      waveTimer = 0.4;
      toast("WAVE " + wave);
    }
    if (window.AudioFX) AudioFX.wave();
  }

  function tryEnterLair() {
    if (!player.group || bossRef) return false;
    for (let i = 0; i < LAIRS.length; i++) {
      const L = LAIRS[i];
      if (L.defeated) continue;
      if (len2(player.group.position.x - L.x, player.group.position.z - L.z) < 8) {
        const defIdx = L.bossIdx;
        const e = spawnBoss(defIdx);
        if (e) {
          e.mesh.position.set(L.x, 0, L.z);
          e._lair = L;
        }
        return true;
      }
    }
    return false;
  }

  function updateWaves(dt) {
    if (mode !== "play") return;
    waveTimer -= dt;
    if (wavePhase === "spawn") {
      if (toSpawn > 0 && waveTimer <= 0) {
        spawnEnemy(wave >= 5 && Math.random() < 0.2 ? "guard" : null);
        toSpawn--;
        waveTimer = Math.max(0.28, 0.85 - wave * 0.04);
      }
      if (toSpawn <= 0 && enemies.length === 0) {
        wavePhase = "clear";
        waveTimer = 2.0;
      }
    } else if (wavePhase === "bossin") {
      if (tryEnterLair()) wavePhase = "boss";
      else if (waveTimer <= 0) {
        toast("SEEK THE LAIR");
        waveTimer = 18;
      }
    } else if (wavePhase === "boss") {
      if (!bossRef && enemies.length === 0) {
        wavePhase = "clear";
        waveTimer = 2.2;
      } else if (bossRef && !bossRef.addSpawned && bossRef.hp < bossRef.maxHp * 0.5) {
        bossRef.addSpawned = true;
        spawnEnemy("imp");
        spawnEnemy("hound");
      }
    } else if (wavePhase === "clear") {
      if (waveTimer <= 0) beginWave(wave + 1);
    }
  }

  function updatePlayer(dt) {
    if (!player.group || mode !== "play") return;
    const drawing = input.bowHeld && player.bowLv > 0;
    const spd = player.speed * (drawing ? 0.45 : 1) * (activePower === "overdrive" ? 1.35 : 1);
    const ix = input.x, iz = input.z;
    const il = len2(ix, iz);
    let mx = 0, mz = 0;
    if (il > 0.12) {
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      mx = right.x * ix + fwd.x * iz;
      mz = right.z * ix + fwd.z * iz;
      const ml = len2(mx, mz) || 1;
      mx /= ml; mz /= ml;
      player.yaw = lerpAng(player.yaw, Math.atan2(mx, mz), 1 - Math.pow(0.001, dt));
    }
    const r = resolveCircle(player.group.position.x + mx * spd * dt, player.group.position.z + mz * spd * dt, player.radius);
    player.group.position.x = r.x;
    player.group.position.z = r.z;
    player.group.rotation.y = player.yaw;

    const moving = il > 0.12;
    const bob = moving ? Math.sin(time * 14) * 0.05 : Math.sin(time * 2.2) * 0.02;
    if (player.parts.body) player.parts.body.position.y = 0.72 + bob;
    if (player.parts.head) player.parts.head.position.y = 1.22 + bob * 0.6;
    if (player.parts.legL) player.parts.legL.rotation.x = moving ? Math.sin(time * 14) * 0.6 : 0;
    if (player.parts.legR) player.parts.legR.rotation.x = moving ? Math.sin(time * 14 + Math.PI) * 0.6 : 0;
    if (player.parts.bowBack) player.parts.bowBack.visible = player.bowLv > 0 && !drawing;
    if (player.parts.bowHeld) player.parts.bowHeld.visible = drawing;
    if (player.parts.gun) player.parts.gun.visible = !drawing;
    if (player.parts.sword) player.parts.sword.visible = player.swordLv > 0;
    if (player._slashVis > 0) player._slashVis -= dt;

    if (activePower === "shield") {
      if (!player._bubble) {
        player._bubble = mesh(geos.sphere, new THREE.MeshBasicMaterial({
          color: 0x44ccff, transparent: true, opacity: 0.22, depthWrite: false,
        }), 1.15, 1.3, 1.15);
        player.group.add(player._bubble);
      }
      player._bubble.visible = true;
    } else if (player._bubble) player._bubble.visible = false;

    player.group.visible = player.invuln <= 0 || Math.sin(time * 40) > 0;
    player.gunCd = Math.max(0, player.gunCd - dt);
    player.slashCd = Math.max(0, player.slashCd - dt);
    player.invuln = Math.max(0, player.invuln - dt);

    if (input.firing && !drawing) fireGun();
    if (input.slashQueued) { input.slashQueued = false; doSlash(); }
    if (input.powerQueued) { input.powerQueued = false; activatePower(); }

    const ring = el("bow-ring");
    if (drawing) {
      if (!input.bowStarted) {
        input.bowStarted = true;
        if (window.AudioFX) AudioFX.bowDrawStart();
      }
      input.bowCharge = Math.min(1, input.bowCharge + dt / 1.12);
    } else {
      if (input.bowStarted) {
        fireArrow(input.bowCharge);
        input.bowCharge = 0;
        input.bowStarted = false;
      }
      input.bowCharge = 0;
    }
    if (ring) {
      const C = 207.3;
      ring.setAttribute("stroke-dashoffset", String(C * (1 - input.bowCharge)));
      ring.setAttribute("stroke", input.bowCharge > 0.85 ? "#ff6a2a" : "#ffd36a");
    }
    el("btn-bow").classList.toggle("held", drawing);

    for (const pk of pickups.slice()) {
      const d = len2(pk.mesh.position.x - player.group.position.x, pk.mesh.position.z - player.group.position.z);
      if (d < 1.5) collectPickup(pk);
    }
  }

  function updateEnemies(dt) {
    if (mode !== "play" || !player.group) return;
    const px = player.group.position.x, pz = player.group.position.z;
    for (const e of enemies) {
      if (e.dying || e._held) { animateEnemy(e, dt, false, false); continue; }
      const p = e.mesh.position;
      const dx = px - p.x, dz = pz - p.z;
      const dist = len2(dx, dz) || 1;
      let tx = px, tz = pz, chase = dist < 20 || e.boss;
      if (!chase && e.homeX != null) {
        const wa = time * 0.4 + (e.homeX || 0);
        tx = e.homeX + Math.cos(wa) * 6;
        tz = e.homeZ + Math.sin(wa * 0.8) * 6;
      }
      const tdx = tx - p.x, tdz = tz - p.z;
      const tdist = len2(tdx, tdz) || 1;
      const want = Math.atan2(chase ? dx : tdx, chase ? dz : tdz);
      e.yaw = lerpAng(e.yaw || 0, want, 0.12);
      e.mesh.rotation.y = e.yaw;
      e.atkCd -= dt;
      e.hitT = Math.max(0, e.hitT - dt);

      if (e.typ === "imp") {
        p.y = 0.15 + Math.sin(time * 3 + p.x) * 0.25;
        if (e.mesh.userData.wings) {
          const fl = Math.sin(time * 10) * 0.35;
          e.mesh.userData.wings[0].rotation.z = fl;
          e.mesh.userData.wings[1].rotation.z = -fl;
        }
        if (!chase || dist > 7) {
          const n = resolveCircle(p.x + (tdx / tdist) * e.spd * dt, p.z + (tdz / tdist) * e.spd * dt, e.radius);
          p.x = n.x; p.z = n.z;
        } else if (e.atkCd <= 0) {
          e.atkCd = 1.6;
          e.attacking = 0.3;
          const b = mesh(geos.sphere, mats.ember, 0.14);
          b.position.set(p.x, 1.2, p.z);
          scene.add(b);
          bullets.push({ mesh: b, vx: (dx / dist) * 14, vy: 0.4, vz: (dz / dist) * 14, life: 2.2, dmg: e.dmg, from: "enemy" });
        }
      } else if (e.typ === "hound" || e.typ === "guard" || e.typ === "golem") {
        const stop = e.radius + player.radius + 0.15;
        if (!chase || dist > stop) {
          const n = resolveCircle(p.x + (tdx / tdist) * e.spd * (chase ? 1 : 0.55) * dt, p.z + (tdz / tdist) * e.spd * (chase ? 1 : 0.55) * dt, e.radius);
          p.x = n.x; p.z = n.z;
        } else if (e.atkCd <= 0) {
          e.atkCd = e.typ === "golem" ? 1.6 : e.typ === "guard" ? 1.2 : 0.9;
          e.attacking = 0.35;
          hurtPlayer(e.dmg);
        }
      } else if (e.boss) {
        if (e.mesh.userData.wings) {
          const fl = Math.sin(time * 2.2) * 0.18;
          e.mesh.userData.wings[0].rotation.z = fl;
        }
        const stop = e.radius + player.radius + 0.4;
        if (dist > stop + 1.5) {
          const n = resolveCircle(p.x + (dx / dist) * e.spd * dt, p.z + (dz / dist) * e.spd * dt, e.radius);
          p.x = n.x; p.z = n.z;
        }
        if (e.atkCd <= 0) {
          e.phase = (e.phase + 1) % 3;
          e.atkCd = 2.1;
          e.attacking = 0.45;
          if (e.phase === 0) {
            for (let i = -2; i <= 2; i++) {
              const ang = want + i * 0.22;
              const mat = e.typ === "voidmaw" ? mats.voidGlow : e.typ === "stormrend" ? mats.stormGlow : mats.bossLava;
              const b = mesh(geos.sphereLo, mat, 0.28);
              b.position.set(p.x, 2.2, p.z);
              scene.add(b);
              bullets.push({ mesh: b, vx: Math.sin(ang) * 16, vy: 0.2, vz: Math.cos(ang) * 16, life: 2.4, dmg: e.dmg, from: "enemy" });
            }
            if (window.AudioFX) AudioFX.shoot();
          } else if (e.phase === 1) {
            if (dist < 8) hurtPlayer(e.dmg + 6);
            burst(p.x, 0.4, p.z, e.typ === "voidmaw" ? 0xaa44ff : 0xff5510, 16, 8, 0.45);
            if (window.AudioFX) AudioFX.explode();
          } else {
            e.atkCd = 0.9;
            const n = resolveCircle(p.x + (dx / dist) * e.spd * 8 * dt, p.z + (dz / dist) * e.spd * 8 * dt, e.radius);
            p.x = n.x; p.z = n.z;
            if (dist < stop + 1) hurtPlayer(e.dmg);
          }
        }
      }
      if (e.attacking > 0) e.attacking -= dt;
      const moving = tdist > 0.15;
      animateEnemy(e, dt, moving, e.attacking > 0);
    }
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += (b.vy || 0) * dt;
      b.mesh.position.z += b.vz * dt;
      let dead = b.life <= 0 || b.mesh.position.y < 0;
      const bx = b.mesh.position.x, by = b.mesh.position.y, bz = b.mesh.position.z;
      for (const p of pillars) {
        if (len2(bx - p.x, bz - p.z) < p.r + 0.15 && by < 4) { dead = true; break; }
      }
      if (!dead && b.from === "player") {
        for (const e of enemies.slice()) {
          if (e.dying) continue;
          const ey = e.boss ? 2.0 : (e.typ === "imp" ? 1.1 : 0.8);
          if (len2(bx - e.mesh.position.x, bz - e.mesh.position.z) < e.radius + 0.2 && Math.abs(by - ey) < 1.6 + (e.boss ? 2 : 0)) {
            hurtEnemy(e, b.dmg, e.mesh.position.x, ey + 0.6, e.mesh.position.z);
            dead = true;
            break;
          }
        }
      } else if (!dead && b.from === "enemy" && player.group) {
        if (len2(bx - player.group.position.x, bz - player.group.position.z) < player.radius + 0.2 && by < 2) {
          hurtPlayer(b.dmg);
          dead = true;
        }
      }
      if (dead) {
        scene.remove(b.mesh);
        bullets.splice(i, 1);
      }
    }
  }

  function updateArrows(dt) {
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i];
      if (a.stuck) {
        a.life -= dt;
        if (a.life <= 0) {
          scene.remove(a.mesh);
          arrows.splice(i, 1);
        } else if (a.life < 0.3) {
          a.mesh.traverse((ch) => {
            if (ch.material && ch.material.opacity != null) {
              ch.material.transparent = true;
              ch.material.opacity = a.life / 0.3;
            }
          });
        }
        continue;
      }
      a.vy -= a.grav * dt;
      a.mesh.position.x += a.vx * dt;
      a.mesh.position.y += a.vy * dt;
      a.mesh.position.z += a.vz * dt;
      a.mesh.lookAt(a.mesh.position.x + a.vx, a.mesh.position.y + a.vy, a.mesh.position.z + a.vz);
      a.life -= dt;

      if (Math.random() < 0.5) {
        const tr = mesh(geos.sphereLo, a.charge > 0.7 ? mats.chargeArrow : mats.arrowHead, 0.04);
        tr.position.copy(a.mesh.position);
        scene.add(tr);
        particles.push(Object.assign(tr, { userData: { v: new THREE.Vector3(), life: 0.2, max: 0.2, fade: true } }));
      }

      let stick = false, hitE = null;
      if (a.mesh.position.y <= 0.08) {
        a.mesh.position.y = 0.08;
        stick = true;
      }
      for (const p of pillars) {
        if (len2(a.mesh.position.x - p.x, a.mesh.position.z - p.z) < p.r + 0.1 && a.mesh.position.y < 5) {
          stick = true;
          break;
        }
      }
      for (const e of enemies.slice()) {
        if (e.dying) continue;
        const ey = e.boss ? 2.2 : 0.9;
        if (len2(a.mesh.position.x - e.mesh.position.x, a.mesh.position.z - e.mesh.position.z) < e.radius + 0.15 &&
            Math.abs(a.mesh.position.y - ey) < 1.8 + (e.boss ? 2.2 : 0)) {
          hitE = e;
          break;
        }
      }
      if (hitE) {
        hurtEnemy(hitE, a.dmg, a.mesh.position.x, a.mesh.position.y, a.mesh.position.z);
        a.stuck = true;
        a.life = 1.1;
        if (window.AudioFX) AudioFX.arrowStick();
        if (hitE.hp <= 0 || !hitE.mesh.parent) {
          scene.remove(a.mesh);
          arrows.splice(i, 1);
        } else {
          hitE.mesh.attach(a.mesh);
        }
        continue;
      }
      if (stick || a.life <= 0) {
        if (stick) {
          a.stuck = true;
          a.life = 1.6 + a.charge * 0.7;
          a.vx = a.vy = a.vz = 0;
          if (window.AudioFX) AudioFX.arrowStick();
        } else {
          scene.remove(a.mesh);
          arrows.splice(i, 1);
        }
      }
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      pk.t += dt;
      pk.life -= dt;
      pk.mesh.position.y = 0.7 + Math.sin(pk.t * 3) * 0.15;
      pk.mesh.rotation.y += dt * 1.6;
      if (pk.life <= 0) {
        scene.remove(pk.mesh);
        pickups.splice(i, 1);
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const m = particles[i];
      const u = m.userData;
      u.life -= dt;
      if (u.v) m.position.addScaledVector(u.v, dt);
      if (u.v) u.v.y -= 8 * dt;
      const k = u.max ? u.life / u.max : 0;
      if (m.material && m.material.opacity != null) m.material.opacity = Math.max(0, k);
      if (u.life <= 0) {
        scene.remove(m);
        particles.splice(i, 1);
      }
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t -= dt;
      f.y += dt * 0.8;
      projectFloater(f);
      if (f.t <= 0) {
        f.el.remove();
        floaters.splice(i, 1);
      }
    }
    if (worldEmbers && worldEmbers.visible) {
      const pos = worldEmbers.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.7;
        if (y > 11) y = 0.3;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    if (worldMist && worldMist.visible) {
      const pos = worldMist.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.25;
        let x = pos.getX(i) + Math.sin(time + i) * dt * 0.15;
        if (y > 7) y = 0.3;
        pos.setY(i, y);
        pos.setX(i, x);
      }
      pos.needsUpdate = true;
    }
  }

  function snapPlayerCam() {
    if (!player.group) return;
    const p = player.group.position;
    const back = 8.2, height = 3.9, look = 1.2;
    const tx = p.x - Math.sin(player.yaw) * back;
    const tz = p.z - Math.cos(player.yaw) * back;
    camera.position.set(tx, p.y + height, tz);
    _look.set(p.x + Math.sin(player.yaw) * 2.2, p.y + look, p.z + Math.cos(player.yaw) * 2.2);
    camera.lookAt(_look);
  }

  function updateCamera(dt) {
    if (!player.group) return;
    const p = player.group.position;
    const back = 7.4, height = 3.6, look = 1.15;
    const tx = p.x - Math.sin(player.yaw) * back;
    const tz = p.z - Math.cos(player.yaw) * back;
    const ty = p.y + height;
    const k = 1 - Math.pow(0.0008, dt);
    camera.position.x = lerp(camera.position.x, tx, k);
    camera.position.y = lerp(camera.position.y, ty, k);
    camera.position.z = lerp(camera.position.z, tz, k);
    const lx = p.x + Math.sin(player.yaw) * 2.2;
    const ly = p.y + look;
    const lz = p.z + Math.cos(player.yaw) * 2.2;
    _look.lerp(new THREE.Vector3(lx, ly, lz), k);
    camera.lookAt(_look);
  }

  function maybeLightning(dt) {
    flashT = Math.max(0, flashT - dt);
    if (Math.random() < dt * 0.015) flashT = 0.06;
    if (hemi) hemi.intensity = hemiBase + (flashT > 0 ? 0.12 : 0);
    if (sunLight) sunLight.intensity = sunBase + (flashT > 0 ? 0.15 : 0);
  }

  function updateHomeCam(dt) {
    time += dt;
    const ha = time * 0.16;
    camera.position.set(Math.sin(ha) * 2.6, 2.45, 3.0 + Math.cos(ha) * 0.8);
    camera.lookAt(0, 1.15, 7.0);
    if (player.group) {
      player.group.position.set(0, 0, 6);
      player.group.rotation.y = time * 0.25;
      player.group.visible = true;
      if (player.parts.body) player.parts.body.position.y = 0.72 + Math.sin(time * 2) * 0.03;
    }
    if (worldEmbers) updateParticles(dt);
    maybeLightning(dt);
    updateShadowLight();
    renderer.render(scene, camera);
  }

  function updateHP() {
    const r = Math.max(0, player.hp) / player.maxHp;
    const fill = el("hp-fill");
    fill.style.width = (r * 100).toFixed(1) + "%";
    fill.classList.toggle("low", r < 0.4 && r >= 0.2);
    fill.classList.toggle("crit", r < 0.2);
    el("hp-text").textContent = Math.max(0, Math.ceil(player.hp)) + " / " + player.maxHp;
  }
  function updateBossBar() {
    if (!bossRef) { el("boss-wrap").classList.remove("show"); return; }
    el("boss-wrap").classList.add("show");
    el("boss-fill").style.width = (Math.max(0, bossRef.hp) / bossRef.maxHp * 100).toFixed(1) + "%";
  }
  function updateSkillLocks() {
    el("btn-slash").classList.toggle("locked", player.swordLv <= 0);
    el("btn-bow").classList.toggle("locked", player.bowLv <= 0);
    el("btn-power").classList.toggle("locked", !pendingPower);
    el("gun-lvl").textContent = String(player.gunLv);
    el("gun-lvl").classList.add("show");
    el("sword-lvl").textContent = String(player.swordLv);
    el("sword-lvl").classList.toggle("show", player.swordLv > 0);
    el("bow-lvl").textContent = String(player.bowLv);
    el("bow-lvl").classList.toggle("show", player.bowLv > 0);
  }
  function updatePowerTag() {
    const node = el("power-tag");
    if (activePower) {
      node.textContent = activePower.toUpperCase() + "  " + Math.ceil(powerT) + "s";
      node.classList.add("show");
    } else if (pendingPower) {
      node.textContent = "POWER READY: " + pendingPower.toUpperCase();
      node.classList.add("show");
    } else {
      node.classList.remove("show");
    }
  }

  function drawMinimap() {
    const ctx = minimapCtx;
    if (!ctx || !player.group) return;
    const W = 216, R = W / 2;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#d5e4f2";
    ctx.fillRect(0, 0, W, W);
    const scale = (R - 8) / 48;
    const px = player.group.position.x, pz = player.group.position.z;
    function map(x, z) { return [R + (x - px) * scale, R + (z - pz) * scale]; }
    function clampEdge(x, y) {
      const dx = x - R, dy = y - R, d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > R - 8) { return [R + dx / d * (R - 8), R + dy / d * (R - 8), true]; }
      return [x, y, false];
    }
    // zones
    const zcols = { ruins: "rgba(210,180,110,0.55)", lava: "rgba(210,90,40,0.45)", mist: "rgba(90,170,70,0.45)" };
    for (let i = 0; i < ZONES.length; i++) {
      const zn = ZONES[i];
      const c0 = map(zn.x, zn.z);
      ctx.fillStyle = zcols[zn.id] || "rgba(80,80,80,0.3)";
      ctx.beginPath();
      ctx.ellipse(c0[0], c0[1], zn.rx * scale, zn.rz * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // world bounds
    ctx.strokeStyle = "rgba(140,110,50,0.65)";
    ctx.lineWidth = 2;
    const b1 = map(WORLD.minX, WORLD.minZ), b2 = map(WORLD.maxX, WORLD.maxZ);
    ctx.strokeRect(b1[0], b1[1], b2[0] - b1[0], b2[1] - b1[1]);
    ctx.fillStyle = "rgba(120,110,90,0.7)";
    for (const p of pillars) {
      const m = map(p.x, p.z);
      ctx.beginPath(); ctx.arc(m[0], m[1], 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const pk of pickups) {
      const m = map(pk.mesh.position.x, pk.mesh.position.z);
      ctx.fillStyle = pk.typ === "bow" ? "#ffc44a" : pk.typ === "sword" ? "#c0d8ff" : pk.typ === "gun" ? "#7ae0ff" : "#80ffd0";
      ctx.beginPath(); ctx.arc(m[0], m[1], 3.2, 0, Math.PI * 2); ctx.fill();
    }
    for (const e of enemies) {
      const m = map(e.mesh.position.x, e.mesh.position.z);
      ctx.fillStyle = e.boss ? "#ff6a20" : "#e23a3a";
      ctx.beginPath(); ctx.arc(m[0], m[1], e.boss ? 6 : 3.4, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < LAIRS.length; i++) {
      const L = LAIRS[i];
      const raw = map(L.x, L.z);
      const c = clampEdge(raw[0], raw[1]);
      ctx.fillStyle = L.defeated ? "#667" : L.color;
      ctx.beginPath();
      const s = 5;
      ctx.moveTo(c[0], c[1] - s);
      ctx.lineTo(c[0] + s, c[1]);
      ctx.lineTo(c[0], c[1] + s);
      ctx.lineTo(c[0] - s, c[1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff4d0";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = "#3a8aff";
    ctx.beginPath(); ctx.arc(R, R, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff4d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.lineTo(R + Math.sin(player.yaw) * 11, R + Math.cos(player.yaw) * 11);
    ctx.stroke();
    ctx.restore();
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function showScreen(id) {
    ["home", "howto", "pause", "gameover", "settings"].forEach((s) => el(s).classList.toggle("show", s === id));
  }
  function hideScreens() {
    ["home", "howto", "pause", "gameover", "settings"].forEach((s) => el(s).classList.remove("show"));
  }

  function clearEntities() {
    for (const arr of [enemies, bullets, arrows, pickups, particles]) {
      for (const o of arr) {
        const m = o.mesh || o;
        if (m && m.parent) m.parent.remove(m);
        else if (m) scene.remove(m);
      }
      arr.length = 0;
    }
    for (const f of floaters) f.el.remove();
    floaters.length = 0;
    bossRef = null;
    el("boss-wrap").classList.remove("show");
  }

  function resetPlayer() {
    player.hp = MAX_HP;
    player.maxHp = MAX_HP;
    player.yaw = 0;
    player.invuln = 0;
    player.gunCd = 0;
    player.slashCd = 0;
    player.gunLv = 1;
    player.swordLv = 0;
    player.bowLv = 0;
    pendingPower = null;
    activePower = null;
    powerT = 0;
    if (player.group) {
      player.group.position.set(0, 0, 6);
      player.group.rotation.y = 0;
      player.group.visible = true;
    }
    if (player.parts) {
      if (player.parts.sword) player.parts.sword.visible = false;
      if (player.parts.bowBack) player.parts.bowBack.visible = false;
      if (player.parts.bowHeld) player.parts.bowHeld.visible = false;
      if (player.parts.gun) player.parts.gun.visible = true;
    }
    input.x = input.z = 0;
    input.firing = input.bowHeld = false;
    input.bowCharge = 0;
    input.bowStarted = false;
    resetJoyKnob();
    updateHP();
    updateSkillLocks();
    updatePowerTag();
  }

  function startGame() {
    if (window.AudioFX) AudioFX.unlock();
    clearEntities();
    resetPlayer();
    score = 0; kills = 0; combo = 0; comboT = 0;
    el("score-v").textContent = "0";
    el("combo").classList.remove("show");
    mode = "play";
    hideScreens();
    el("hud").classList.remove("hidden");
    camera.position.set(0, 5, 14);
    _look.set(0, 1.2, 6);
    player.group.position.set(0, 0, 6);
    LAIRS.forEach(function (L) { L.defeated = false; });
    spawnPickup("sword", 2.5, 6);
    spawnPickup("bow", -2.5, 6);
    spawnPickup("gun", 0, 5);
    spawnPickup("heal", -8, 12);
    spawnPickup("shield", 14, -8);
    spawnPickup("gun", 4, -26);
    spawnPickup("sword", -10, -28);
    spawnPickup("bow", 16, 34);
    spawnPickup("overdrive", 8, 30);
    beginWave(1);
    if (window.AudioFX) AudioFX.ui();
  }

  function pauseGame() {
    if (mode !== "play") return;
    mode = "pause";
    showScreen("pause");
    if (window.AudioFX) AudioFX.bowDrawStop();
  }
  function resumeGame() {
    if (mode !== "pause") return;
    mode = "play";
    hideScreens();
    el("hud").classList.remove("hidden");
  }
  function quitToHome() {
    mode = "home";
    clearEntities();
    el("hud").classList.add("hidden");
    showScreen("home");
    loadHS();
    if (player.group) player.group.position.set(0, 0, 4);
    if (window.AudioFX) AudioFX.bowDrawStop();
  }
  function gameOver() {
    if (mode !== "play") return;
    mode = "over";
    saveHS();
    el("over-score").textContent = String(score);
    el("over-wave").textContent = String(wave);
    el("over-best").textContent = String(highScore);
    showScreen("gameover");
    if (window.AudioFX) { AudioFX.bowDrawStop(); AudioFX.die(); }
  }

  function resetJoyKnob() {
    el("joy-knob").style.transform = "translate(-50%, -50%)";
    input.x = 0; input.z = 0;
  }
  function joyAt(clientX, clientY) {
    const base = el("joy-base");
    const r = base.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const max = r.width * 0.42;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    el("joy-knob").style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))";
    input.x = dx / max;
    input.z = -dy / max;
  }

  function unlockAudio() {
    if (window.AudioFX) AudioFX.unlock();
  }

  function bindInput() {
    const base = el("joy-base");
    base.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      input.joyId = e.pointerId;
      joyAt(e.clientX, e.clientY);
      unlockAudio();
    });
    base.addEventListener("pointermove", (e) => {
      if (input.joyId !== e.pointerId) return;
      e.preventDefault();
      joyAt(e.clientX, e.clientY);
    });
    function joyEnd(e) {
      if (input.joyId !== e.pointerId) return;
      input.joyId = null;
      resetJoyKnob();
    }
    base.addEventListener("pointerup", joyEnd);
    base.addEventListener("pointercancel", joyEnd);

    function holdBtn(node, on, off) {
      node.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { node.setPointerCapture(e.pointerId); } catch (err) {}
        unlockAudio();
        on(e);
      });
      const end = (e) => { e.preventDefault(); off(e); };
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", end);
    }
    holdBtn(el("btn-fire"), () => { input.firing = true; }, () => { input.firing = false; });
    el("btn-slash").addEventListener("pointerdown", (e) => {
      e.preventDefault(); unlockAudio();
      input.slashQueued = true;
    });
    holdBtn(el("btn-bow"), () => {
      if (player.bowLv > 0 && mode === "play") input.bowHeld = true;
    }, () => { input.bowHeld = false; });
    el("btn-power").addEventListener("pointerdown", (e) => {
      e.preventDefault(); unlockAudio();
      input.powerQueued = true;
    });

    el("btn-play").addEventListener("click", (e) => { e.preventDefault(); unlockAudio(); startGame(); });
    el("btn-howto").addEventListener("click", (e) => { e.preventDefault(); unlockAudio(); if (window.AudioFX) AudioFX.ui(); showScreen("howto"); });
    el("btn-howto-ok").addEventListener("click", (e) => { e.preventDefault(); showScreen("home"); });
    el("btn-pause").addEventListener("click", (e) => { e.preventDefault(); pauseGame(); });
    el("btn-resume").addEventListener("click", (e) => { e.preventDefault(); resumeGame(); });
    el("btn-quit").addEventListener("click", (e) => { e.preventDefault(); quitToHome(); });
    el("btn-again").addEventListener("click", (e) => { e.preventDefault(); startGame(); });
    el("btn-over-home").addEventListener("click", (e) => { e.preventDefault(); quitToHome(); });
    el("btn-mute").addEventListener("click", (e) => {
      e.preventDefault();
      muted = !muted;
      if (window.AudioFX) AudioFX.setMuted(muted);
      el("btn-mute").textContent = muted ? "\uD83D\uDD07" : "\u266A";
    });
    el("btn-settings-home").addEventListener("click", (e) => { e.preventDefault(); unlockAudio(); openSettings("home"); });
    el("btn-settings-pause").addEventListener("click", (e) => { e.preventDefault(); openSettings("pause"); });
    el("btn-settings-hud").addEventListener("click", (e) => { e.preventDefault(); openSettings(mode === "play" ? "play" : "pause"); });
    el("btn-settings-back").addEventListener("click", (e) => { e.preventDefault(); closeSettings(); });
    el("quality-seg").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      e.preventDefault();
      applyQuality(b.getAttribute("data-q"));
    });
    el("chk-auto").addEventListener("change", (e) => { autoQuality = e.target.checked; saveSettings(); });
    el("chk-fps").addEventListener("change", (e) => {
      showFps = e.target.checked;
      el("fps-meter").classList.toggle("show", showFps);
      saveSettings();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && mode === "play") pauseGame();
    });

    const prevent = (e) => e.preventDefault();
    document.addEventListener("touchmove", prevent, { passive: false });
    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    document.addEventListener("gestureend", prevent, { passive: false });
    let lastTouchEnd = 0;
    document.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, { passive: false });
    document.addEventListener("dblclick", prevent, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" || e.code === "KeyF") input.firing = true;
      if (e.code === "KeyJ") input.slashQueued = true;
      if (e.code === "KeyK") input.bowHeld = true;
      if (e.code === "KeyL") input.powerQueued = true;
      if (e.code === "Escape" && mode === "play") pauseGame();
      if (e.code === "KeyP" && mode === "play") pauseGame();
      if (e.code === "ArrowUp" || e.code === "KeyW") input.z = 1;
      if (e.code === "ArrowDown" || e.code === "KeyS") input.z = -1;
      if (e.code === "ArrowLeft" || e.code === "KeyA") input.x = -1;
      if (e.code === "ArrowRight" || e.code === "KeyD") input.x = 1;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "KeyF") input.firing = false;
      if (e.code === "KeyK") input.bowHeld = false;
      if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ArrowDown" || e.code === "KeyS") input.z = 0;
      if (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "ArrowRight" || e.code === "KeyD") input.x = 0;
    });
  }

  function tick() {
    requestAnimationFrame(tick);
    const rawDt = clock.getDelta();
    updateFps(rawDt);
    if (autoGrace > 0) autoGrace -= rawDt;
    if (autoCd > 0) autoCd = Math.max(0, autoCd - rawDt);
    const dt = Math.min(0.05, rawDt);
    if (mode === "home" || mode === "howto" || mode === "settings") {
      if (mode === "settings" && settingsFrom === "pause") {
        time += dt;
        maybeLightning(dt);
        updateParticles(dt);
        updateCamera(dt);
        updateShadowLight();
        drawMinimap();
        renderer.render(scene, camera);
      } else {
        updateHomeCam(dt);
      }
      return;
    }
    time += dt;
    maybeLightning(dt);
    if (mode === "play") {
      if (comboT > 0) {
        comboT -= dt;
        if (comboT <= 0) { combo = 0; el("combo").classList.remove("show"); }
      }
      if (activePower && powerT > 0) {
        powerT -= dt;
        if (powerT <= 0) { activePower = null; updatePowerTag(); }
        else updatePowerTag();
      }
      updatePlayer(dt);
      updateEnemies(dt);
      updateBullets(dt);
      updateArrows(dt);
      updatePickups(dt);
      updateWaves(dt);
    }
    updateParticles(dt);
    updateCamera(dt);
    updateShadowLight();
    if (mode === "play") updateZoneFx();
    if (mode === "play" || mode === "pause" || mode === "over") drawMinimap();
    renderer.render(scene, camera);
  }

  function openSettings(from) {
    settingsFrom = from || "home";
    if (from === "play") {
      pauseGame();
      settingsFrom = "pause";
    }
    syncSettingsUI();
    showScreen("settings");
    if (window.AudioFX) AudioFX.ui();
  }
  function closeSettings() {
    if (settingsFrom === "pause") showScreen("pause");
    else if (settingsFrom === "howto") showScreen("howto");
    else showScreen("home");
  }

  function init() {
    loadHS();
    loadSettings();
    const canvas = el("c");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 240);
    camera.position.set(0, 7.5, 18);
    scene = new THREE.Scene();
    clock = new THREE.Clock();
    initMats();
    buildWorld();
    buildEnvMap();
    buildHero();
    player.group.position.set(0, 0, 4);
    applyQuality(quality);
    syncSettingsUI();
    minimapCtx = el("minimap").getContext("2d");
    bindInput();
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", () => setTimeout(resize, 200));

    const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (!standalone) {
      el("install-hint").textContent = "iPhone: open in Safari, then Share \u2192 Add to Home Screen. Full screen, works offline.";
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {});
    }

    tick();

    window.__CAS = {
      version: VERSION,
      start: startGame,
      pause: pauseGame,
      resume: resumeGame,
      home: quitToHome,
      openSettings: openSettings,
      spawnBoss: function (i) { if (mode !== "play") startGame(); spawnBoss(i || 0); },
      clearMobs: function () {
        enemies.slice().forEach((e) => { if (e.mesh && e.mesh.parent) e.mesh.parent.remove(e.mesh); });
        enemies.length = 0;
        bossRef = null;
        toSpawn = 0;
        el("boss-wrap").classList.remove("show");
      },
      spawnEnemy: function (typ) { return spawnEnemy(typ); },
      spawnAt: function (typ, x, z) {
        const e = spawnEnemy(typ);
        e.mesh.position.set(x, typ === "imp" ? 0.2 : 0, z);
        e.homeX = x; e.homeZ = z;
        if (player.group) {
          e.yaw = Math.atan2(player.group.position.x - x, player.group.position.z - z);
          e.mesh.rotation.y = e.yaw;
        }
        e._held = true;
        return e;
      },
      spawnPickup: function (typ, x, z) { spawnPickup(typ, x == null ? 1 : x, z == null ? 6 : z); },
      killPlayer: function () { player.hp = 0; updateHP(); gameOver(); },
      giveAll: function () {
        player.swordLv = 3; player.bowLv = 3; player.gunLv = 3;
        pendingPower = "nova";
        if (player.parts.sword) player.parts.sword.visible = true;
        if (player.parts.bowBack) player.parts.bowBack.visible = true;
        updateSkillLocks(); updatePowerTag();
      },
      setWave: function (n) { beginWave(n); },
      setQuality: function (q) { applyQuality(q); },
      setShowFps: function (v) { showFps = !!v; el("fps-meter").classList.toggle("show", showFps); saveSettings(); },
      setAutoQuality: function (v) { autoQuality = !!v; saveSettings(); },
      teleport: function (x, z, yaw) {
        if (!player.group) return;
        const r = resolveCircle(x, z, player.radius);
        player.group.position.set(r.x, 0, r.z);
        if (yaw != null) player.yaw = yaw;
        snapPlayerCam();
      },
      gotoLair: function (i) {
        const L = LAIRS[i || 0];
        if (!L || !player.group) return;
        const z = L.z + 12;
        player.group.position.set(L.x, 0, z);
        player.yaw = Math.atan2(L.x - L.x, L.z - z);
        snapPlayerCam();
      },
      getState: function () {
        return {
          version: VERSION, mode: mode, score: score, wave: wave, hp: player.hp,
          gunLv: player.gunLv, swordLv: player.swordLv, bowLv: player.bowLv,
          quality: quality, fps: Math.round(fps), showFps: showFps, shadows: !!(gfx && gfx.shadows),
          zone: currentZone, pos: player.group ? { x: player.group.position.x, z: player.group.position.z } : null,
          boss: bossRef ? { name: bossRef.name, hp: bossRef.hp, maxHp: bossRef.maxHp } : null,
          enemies: enemies.length, pickups: pickups.map((pk) => pk.typ),
        };
      },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
