/* Collect and Shoot — landscape 3D arena PWA */
(function () {
  "use strict";

  const HS_KEY = "cas_highscore_v1";
  const ARENA_R = 42;
  const MAX_HP = 100;
  function el(id) { return document.getElementById(id); }

  let renderer, scene, camera, clock, sunLight, hemi, lavaLight, worldEmbers;
  let flashT = 0, mode = "home", score = 0, wave = 1, combo = 0, comboT = 0, highScore = 0, kills = 0, time = 0;
  let pendingPower = null, activePower = null, powerT = 0;
  let wavePhase = "idle", waveTimer = 0, toSpawn = 0, muted = false;

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

  function initMats() {
    const rock = noiseTex(256, [62, 64, 72], [28, 26, 30], 0.8);
    rock.repeat.set(8, 8);
    const rock2 = noiseTex(128, [80, 78, 84], [30, 28, 32], 0.6);
    mats.ground = new THREE.MeshStandardMaterial({ map: rock, color: 0xb0b4bc, roughness: 0.96, metalness: 0.04 });
    mats.stone = new THREE.MeshStandardMaterial({ map: rock2, color: 0x8a8c94, roughness: 0.9, metalness: 0.05 });
    mats.mountain = new THREE.MeshStandardMaterial({ color: 0x3a3e4a, roughness: 1, metalness: 0, flatShading: true });
    mats.lava = new THREE.MeshStandardMaterial({ map: lavaTex(128), color: 0xff6a1a, emissive: 0xff3a00, emissiveIntensity: 1.4, roughness: 0.6 });
    mats.heroBlue = new THREE.MeshStandardMaterial({ color: 0x3a78ff, roughness: 0.4, metalness: 0.16, emissive: 0x0a2266, emissiveIntensity: 0.45 });
    mats.heroSpike = new THREE.MeshStandardMaterial({ color: 0x1a4ad0, roughness: 0.36, metalness: 0.22, emissive: 0x071850, emissiveIntensity: 0.35 });
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
    mats.imp = new THREE.MeshStandardMaterial({ color: 0x4a1a10, roughness: 0.5, emissive: 0x3a0800, emissiveIntensity: 0.4 });
    mats.impGlow = new THREE.MeshStandardMaterial({ color: 0xff5510, emissive: 0xff3300, emissiveIntensity: 1.3 });
    mats.hound = new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.7, metalness: 0.1 });
    mats.houndEye = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff0022, emissiveIntensity: 1.2 });
    mats.guard = new THREE.MeshStandardMaterial({ color: 0x5a5c62, roughness: 0.85, metalness: 0.2, map: rock2 });
    mats.bossRock = new THREE.MeshStandardMaterial({ color: 0x1c1412, roughness: 0.8, metalness: 0.15 });
    mats.bossLava = new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff2a00, emissiveIntensity: 1.6, roughness: 0.4 });
    mats.bossHorn = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.45, metalness: 0.3 });
    mats.voidBody = new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.45, metalness: 0.35, emissive: 0x1a0040, emissiveIntensity: 0.4 });
    mats.voidGlow = new THREE.MeshStandardMaterial({ color: 0xb44aff, emissive: 0x8800ff, emissiveIntensity: 1.5 });
    mats.stormBody = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.4, metalness: 0.5, emissive: 0x003050, emissiveIntensity: 0.35 });
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
    return m;
  }
  function blobShadow(r) {
    const s = mesh(geos.plane, mats.shadow, r, r, r);
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.03;
    return s;
  }

  function buildWorld() {
    scene.background = new THREE.Color(0x151926);
    scene.fog = new THREE.FogExp2(0x151926, 0.008);
    hemi = new THREE.HemisphereLight(0x8a9bb8, 0x2a2018, 1.05);
    scene.add(hemi);
    sunLight = new THREE.DirectionalLight(0xd8deea, 1.15);
    sunLight.position.set(-20, 40, 16);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x3a4458, 0.45));
    lavaLight = new THREE.PointLight(0xff5510, 2.2, 38, 1.4);
    lavaLight.position.set(0, 1.4, 0);
    scene.add(lavaLight);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 48), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const lavaGroup = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const r = rand(4, 14);
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(rand(4, 9), 0.55), mats.lava);
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = a;
      strip.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      lavaGroup.add(strip);
    }
    const core = new THREE.Mesh(new THREE.CircleGeometry(2.4, 16), mats.lava);
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.015;
    lavaGroup.add(core);
    scene.add(lavaGroup);

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rand(-0.1, 0.1);
      const r = rand(16, 28);
      const p = makePillar();
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      p.rotation.y = rand(0, Math.PI);
      scene.add(p);
      pillars.push({ x: p.position.x, z: p.position.z, r: 1.35, mesh: p });
    }
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(34, 40);
      const p = makePillar(true);
      p.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      p.rotation.y = rand(0, Math.PI);
      scene.add(p);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rand(-0.08, 0.08);
      const r = rand(70, 95);
      const h = rand(18, 38);
      const mtn = mesh(new THREE.ConeGeometry(rand(10, 20), h, 5), mats.mountain);
      mtn.position.set(Math.cos(a) * r, h * 0.4, Math.sin(a) * r);
      mtn.rotation.y = rand(0, 1);
      scene.add(mtn);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 0.6, 0.7, 6, 48), mats.stone);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    scene.add(ring);

    const emberGeo = new THREE.BufferGeometry();
    const N = 120;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 50;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rand(0.4, 10);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    emberGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    worldEmbers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      color: 0xff7a30, size: 0.12, transparent: true, opacity: 0.7, depthWrite: false
    }));
    scene.add(worldEmbers);
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

  function buildImp() {
    const g = new THREE.Group();
    const body = mesh(geos.sphereLo, mats.imp, 0.38, 0.32, 0.34);
    body.position.y = 0.9;
    const head = mesh(geos.sphereLo, mats.imp, 0.26, 0.22, 0.24);
    head.position.set(0, 1.22, 0.05);
    const hornL = mesh(geos.cone, mats.impGlow, 0.06, 0.16, 0.06);
    hornL.position.set(-0.12, 1.4, 0);
    hornL.rotation.z = 0.4;
    const hornR = hornL.clone();
    hornR.position.x = 0.12;
    hornR.rotation.z = -0.4;
    const wingL = mesh(new THREE.PlaneGeometry(0.7, 0.45), mats.imp);
    wingL.position.set(-0.4, 0.95, -0.05);
    wingL.rotation.y = 0.5;
    const wingR = wingL.clone();
    wingR.position.x = 0.4;
    wingR.rotation.y = -0.5;
    const glow = mesh(geos.sphereLo, mats.impGlow, 0.12);
    glow.position.set(0, 0.85, 0.28);
    g.add(body, head, hornL, hornR, wingL, wingR, glow, blobShadow(0.45));
    g.userData.wings = [wingL, wingR];
    return g;
  }

  function buildHound() {
    const g = new THREE.Group();
    const body = mesh(geos.sphereLo, mats.hound, 0.55, 0.32, 0.8);
    body.position.set(0, 0.55, 0);
    const head = mesh(geos.sphereLo, mats.hound, 0.28, 0.24, 0.36);
    head.position.set(0, 0.7, 0.7);
    const jaw = mesh(geos.box, mats.hound, 0.28, 0.12, 0.3);
    jaw.position.set(0, 0.5, 0.82);
    const earL = mesh(geos.cone, mats.hound, 0.08, 0.22, 0.08);
    earL.position.set(-0.16, 0.92, 0.6);
    const earR = earL.clone(); earR.position.x = 0.16;
    const eyeL = mesh(geos.sphereLo, mats.houndEye, 0.06);
    eyeL.position.set(-0.12, 0.76, 0.95);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.12;
    const tail = mesh(geos.cone, mats.hound, 0.1, 0.5, 0.1);
    tail.position.set(0, 0.6, -0.85);
    tail.rotation.x = 1.2;
    g.add(body, head, jaw, earL, earR, eyeL, eyeR, tail, blobShadow(0.7));
    for (const x of [-0.28, 0.28]) {
      for (const z of [-0.35, 0.35]) {
        const lg = mesh(geos.cyl, mats.hound, 0.08, 0.4, 0.08);
        lg.position.set(x, 0.2, z);
        g.add(lg);
      }
    }
    return g;
  }

  function buildGuard() {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.3, 8), mats.guard);
    body.position.y = 0.9;
    const head = mesh(geos.box, mats.guard, 0.55, 0.5, 0.5);
    head.position.y = 1.7;
    const eye = mesh(geos.box, mats.impGlow, 0.32, 0.08, 0.06);
    eye.position.set(0, 1.74, 0.26);
    const armL = mesh(geos.box, mats.guard, 0.22, 0.8, 0.22);
    armL.position.set(-0.8, 1.0, 0);
    const armR = armL.clone(); armR.position.x = 0.8;
    const hammer = mesh(geos.box, mats.stone, 0.5, 0.5, 0.5);
    hammer.position.set(0.95, 0.55, 0.2);
    g.add(body, head, eye, armL, armR, hammer, blobShadow(0.9));
    return g;
  }

  function buildEmberhorn() {
    const g = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(1.8, 12, 10), mats.bossRock);
    body.scale.set(1, 1.15, 0.85);
    body.position.y = 2.2;
    g.add(body);
    for (let i = 0; i < 8; i++) {
      const cr = mesh(geos.box, mats.bossLava, 0.08, rand(0.8, 1.8), 0.08);
      const a = (i / 8) * Math.PI * 2;
      cr.position.set(Math.cos(a) * 1.55, 2.1 + rand(-0.4, 0.6), Math.sin(a) * 1.2);
      cr.rotation.z = rand(-0.4, 0.4);
      g.add(cr);
    }
    const belly = mesh(geos.sphereLo, mats.bossLava, 0.7);
    belly.position.set(0, 1.9, 1.3);
    g.add(belly);
    const hL = mesh(new THREE.ConeGeometry(0.28, 2.2, 6), mats.bossHorn);
    hL.position.set(-0.7, 4.3, 0.2);
    hL.rotation.z = 0.45;
    hL.rotation.x = -0.3;
    const hR = hL.clone();
    hR.position.x = 0.7;
    hR.rotation.z = -0.45;
    g.add(hL, hR);
    const head = mesh(geos.sphereLo, mats.bossRock, 1.05, 0.85, 1.0);
    head.position.set(0, 3.6, 0.5);
    g.add(head);
    const eyeL = mesh(geos.sphereLo, mats.bossLava, 0.16);
    eyeL.position.set(-0.35, 3.7, 1.3);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.35;
    g.add(eyeL, eyeR);
    const wMat = mats.bossRock.clone();
    wMat.side = THREE.DoubleSide;
    const wingL = new THREE.Group();
    const w1 = mesh(new THREE.PlaneGeometry(3.4, 2.2), wMat);
    w1.position.set(-2.4, 2.6, -0.2);
    w1.rotation.y = 0.55;
    w1.rotation.z = 0.25;
    const w1b = mesh(new THREE.PlaneGeometry(2.0, 1.3), wMat);
    w1b.position.set(-3.4, 1.6, -0.1);
    w1b.rotation.y = 0.7;
    wingL.add(w1, w1b);
    const wingR = wingL.clone();
    wingR.scale.x = -1;
    g.add(wingL, wingR);
    g.userData.wings = [wingL, wingR];
    const armL = mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.8, 6), mats.bossRock);
    armL.position.set(-1.6, 1.8, 0.4);
    armL.rotation.z = 0.5;
    const armR = armL.clone(); armR.position.x = 1.6; armR.rotation.z = -0.5;
    const clawL = mesh(geos.cone, mats.bossHorn, 0.2, 0.6, 0.2);
    clawL.position.set(-2.2, 0.9, 0.6);
    const clawR = clawL.clone(); clawR.position.x = 2.2;
    g.add(armL, armR, clawL, clawR);
    const tail = mesh(new THREE.CylinderGeometry(0.08, 0.35, 2.4, 6), mats.bossRock);
    tail.position.set(0, 1.2, -1.8);
    tail.rotation.x = 1.1;
    g.add(tail, blobShadow(2.4));
    const light = new THREE.PointLight(0xff3a10, 2.6, 16, 1.5);
    light.position.set(0, 2.4, 1.2);
    g.add(light);
    return g;
  }

  function buildVoidmaw() {
    const g = new THREE.Group();
    const body = mesh(new THREE.OctahedronGeometry(1.8, 1), mats.voidBody);
    body.position.y = 2.2;
    body.scale.set(1, 1.3, 1);
    g.add(body);
    for (let i = 0; i < 6; i++) {
      const sp = mesh(geos.cone, mats.voidGlow, 0.2, 1.4, 0.2);
      const a = (i / 6) * Math.PI * 2;
      sp.position.set(Math.cos(a) * 1.4, 2.4, Math.sin(a) * 1.4);
      sp.lookAt(0, 4, 0);
      g.add(sp);
    }
    const core = mesh(geos.sphereLo, mats.voidGlow, 0.7);
    core.position.y = 2.2;
    g.add(core);
    const head = mesh(geos.sphereLo, mats.voidBody, 1.0, 0.7, 1.1);
    head.position.set(0, 3.5, 0.6);
    g.add(head);
    const maw = mesh(geos.cone, mats.voidGlow, 0.5, 0.8, 0.5);
    maw.rotation.x = Math.PI / 2;
    maw.position.set(0, 3.2, 1.4);
    g.add(maw);
    const wMat = mats.voidBody.clone();
    wMat.side = THREE.DoubleSide;
    const wingL = mesh(new THREE.PlaneGeometry(3.2, 1.8), wMat);
    wingL.position.set(-2.2, 2.8, -0.2);
    wingL.rotation.y = 0.5;
    const wingR = wingL.clone(); wingR.position.x = 2.2; wingR.rotation.y = -0.5;
    g.add(wingL, wingR);
    g.userData.wings = [wingL, wingR];
    g.add(blobShadow(2.2));
    const light = new THREE.PointLight(0xaa44ff, 2.4, 16, 1.5);
    light.position.set(0, 2.4, 0);
    g.add(light);
    return g;
  }

  function buildStormrend() {
    const g = new THREE.Group();
    const body = mesh(new THREE.CylinderGeometry(1.1, 1.5, 3.2, 8), mats.stormBody);
    body.position.y = 2.1;
    g.add(body);
    const head = mesh(geos.sphereLo, mats.stormBody, 0.9);
    head.position.y = 4.0;
    g.add(head);
    const eye = mesh(geos.sphereLo, mats.stormGlow, 0.22);
    eye.position.set(0, 4.05, 0.8);
    g.add(eye);
    for (const x of [-1.6, 1.6]) {
      const arm = mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.2, 6), mats.stormBody);
      arm.position.set(x, 2.2, 0.2);
      arm.rotation.z = x > 0 ? -0.5 : 0.5;
      g.add(arm);
    }
    const crown = mesh(new THREE.ConeGeometry(0.5, 1.3, 5), mats.stormGlow);
    crown.position.y = 4.9;
    g.add(crown, blobShadow(2.0));
    const light = new THREE.PointLight(0x40a0ff, 2.6, 16, 1.5);
    light.position.set(0, 3, 0);
    g.add(light);
    return g;
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
    let x, z, ok = false, guard = 0;
    while (!ok && guard++ < 20) {
      const a = Math.random() * Math.PI * 2;
      const r = ARENA_R - rand(3, 8);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      ok = true;
      if (player.group && len2(x - player.group.position.x, z - player.group.position.z) < (clearR || 10)) ok = false;
      for (const p of pillars) if (len2(x - p.x, z - p.z) < 3) ok = false;
    }
    return { x, z };
  }

  function spawnEnemy(kind) {
    const pos = edgePos(12);
    let meshG, hp, spd, dmg, radius, scoreV;
    const typ = kind || (Math.random() < 0.4 ? "imp" : Math.random() < 0.55 ? "hound" : "guard");
    if (typ === "imp") {
      meshG = buildImp(); hp = 22 + wave * 6; spd = 5.5 + wave * 0.15; dmg = 7; radius = 0.55; scoreV = 100;
    } else if (typ === "hound") {
      meshG = buildHound(); hp = 34 + wave * 8; spd = 7.2 + wave * 0.2; dmg = 10; radius = 0.7; scoreV = 150;
    } else {
      meshG = buildGuard(); hp = 70 + wave * 14; spd = 3.4 + wave * 0.08; dmg = 14; radius = 0.9; scoreV = 250;
    }
    meshG.position.set(pos.x, 0, pos.z);
    scene.add(meshG);
    const e = { mesh: meshG, typ, hp, maxHp: hp, spd, dmg, radius, score: scoreV, atkCd: rand(0.4, 1.2), hitT: 0, yaw: 0, boss: false, phase: 0 };
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
    const yaw = player.yaw || 0;
    let bx = px + Math.sin(yaw) * 11;
    let bz = pz + Math.cos(yaw) * 11;
    const bd = len2(bx, bz);
    if (bd > ARENA_R - 6) { bx = (bx / bd) * (ARENA_R - 6); bz = (bz / bd) * (ARENA_R - 6); }
    meshG.position.set(bx, 0, bz);
    scene.add(meshG);
    const hp = def.hp + Math.max(0, wave - 3) * 220;
    const e = {
      mesh: meshG, typ: def.typ, name: def.name, hp, maxHp: hp,
      spd: 3.6, dmg: 18, radius: 2.4, score: 2500, atkCd: 1.6,
      hitT: 0, yaw: 0, boss: true, phase: 0, addSpawned: false,
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
    const p = e.mesh.position;
    addScore((e.score || 100) * wave, p.x, p.y + 1.4, p.z);
    kills++;
    burst(p.x, p.y + 1, p.z, e.boss ? 0xff5510 : 0xffaa66, e.boss ? 28 : 12, e.boss ? 10 : 6, 0.6);
    if (window.AudioFX) e.boss ? AudioFX.explode() : AudioFX.die();
    dropFrom(e);
    scene.remove(e.mesh);
    e.hp = 0;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    if (e.boss) {
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
    let px = x, pz = z;
    const d0 = len2(px, pz);
    const maxR = ARENA_R - rad;
    if (d0 > maxR) { px = (px / d0) * maxR; pz = (pz / d0) * maxR; }
    for (const p of pillars) {
      const dx = px - p.x, dz = pz - p.z;
      const d = len2(dx, dz);
      const need = rad + p.r;
      if (d < need && d > 0.0001) {
        px = p.x + (dx / d) * need;
        pz = p.z + (dz / d) * need;
      }
    }
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
      waveTimer = 1.2;
      toast("BOSS");
    } else {
      wavePhase = "spawn";
      toSpawn = 4 + wave * 2;
      waveTimer = 0.4;
      toast("WAVE " + wave);
    }
    if (window.AudioFX) AudioFX.wave();
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
      if (waveTimer <= 0) { spawnBoss(); wavePhase = "boss"; }
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
      const p = e.mesh.position;
      const dx = px - p.x, dz = pz - p.z;
      const dist = len2(dx, dz) || 1;
      const want = Math.atan2(dx, dz);
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
        if (dist > 7) {
          const n = resolveCircle(p.x + (dx / dist) * e.spd * dt, p.z + (dz / dist) * e.spd * dt, e.radius);
          p.x = n.x; p.z = n.z;
        } else if (e.atkCd <= 0) {
          e.atkCd = 1.6;
          const b = mesh(geos.sphere, mats.ember, 0.14);
          b.position.set(p.x, 1.2, p.z);
          scene.add(b);
          bullets.push({ mesh: b, vx: (dx / dist) * 14, vy: 0.4, vz: (dz / dist) * 14, life: 2.2, dmg: e.dmg, from: "enemy" });
        }
      } else if (e.typ === "hound" || e.typ === "guard") {
        const stop = e.radius + player.radius + 0.15;
        if (dist > stop) {
          const n = resolveCircle(p.x + (dx / dist) * e.spd * dt, p.z + (dz / dist) * e.spd * dt, e.radius);
          p.x = n.x; p.z = n.z;
        } else if (e.atkCd <= 0) {
          e.atkCd = e.typ === "guard" ? 1.4 : 0.9;
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
          const ey = e.boss ? 2.0 : (e.typ === "imp" ? 1.0 : 0.7);
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
        const ey = e.boss ? 2.2 : 0.8;
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
    if (worldEmbers) {
      const pos = worldEmbers.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * 0.7;
        if (y > 11) y = 0.3;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
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
    if (Math.random() < dt * 0.08) flashT = 0.12;
    if (hemi) hemi.intensity = 1.05 + (flashT > 0 ? 1.2 : 0);
    if (sunLight) sunLight.intensity = 1.15 + (flashT > 0 ? 0.7 : 0);
  }

  function updateHomeCam(dt) {
    time += dt;
    const ha = time * 0.18;
    camera.position.set(Math.sin(ha) * 3.4 + 0.4, 2.55, 7.4 + Math.cos(ha) * 1.2);
    camera.lookAt(0, 1.15, 4);
    if (player.group) {
      player.group.position.set(0, 0, 4);
      player.group.rotation.y = time * 0.25;
      player.group.visible = true;
      if (player.parts.body) player.parts.body.position.y = 0.72 + Math.sin(time * 2) * 0.03;
    }
    if (worldEmbers) updateParticles(dt);
    maybeLightning(dt);
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
    ctx.fillStyle = "#12151c";
    ctx.fillRect(0, 0, W, W);
    const scale = (R - 8) / ARENA_R;
    const px = player.group.position.x, pz = player.group.position.z;
    function map(x, z) { return [R + (x - px) * scale, R + (z - pz) * scale]; }
    ctx.strokeStyle = "rgba(212,184,106,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    const c0 = map(0, 0);
    ctx.arc(c0[0], c0[1], ARENA_R * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(160,160,170,0.55)";
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
    ["home", "howto", "pause", "gameover"].forEach((s) => el(s).classList.toggle("show", s === id));
  }
  function hideScreens() {
    ["home", "howto", "pause", "gameover"].forEach((s) => el(s).classList.remove("show"));
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
      player.group.position.set(0, 0, 8);
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
    camera.position.set(0, 5, 16);
    _look.set(0, 1.2, 8);
    spawnPickup("sword", 2.5, 6);
    spawnPickup("bow", -2.5, 6);
    spawnPickup("gun", 0, 5);
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
    const dt = Math.min(0.05, clock.getDelta());
    if (mode === "home" || mode === "howto") {
      updateHomeCam(dt);
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
    if (mode === "play" || mode === "pause" || mode === "over") drawMinimap();
    renderer.render(scene, camera);
  }

  function init() {
    loadHS();
    const canvas = el("c");
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.28;
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 200);
    camera.position.set(0, 7.5, 18);
    scene = new THREE.Scene();
    clock = new THREE.Clock();
    initMats();
    buildWorld();
    buildHero();
    player.group.position.set(0, 0, 4);
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
      start: startGame,
      pause: pauseGame,
      resume: resumeGame,
      home: quitToHome,
      spawnBoss: function (i) { if (mode !== "play") startGame(); spawnBoss(i || 0); },
      spawnEnemy: function (t) { return spawnEnemy(t); },
      spawnPickup: function (t, x, z) { spawnPickup(t, x == null ? 1 : x, z == null ? 6 : z); },
      killPlayer: function () { player.hp = 0; updateHP(); gameOver(); },
      giveAll: function () {
        player.swordLv = 3; player.bowLv = 3; player.gunLv = 3;
        pendingPower = "nova";
        if (player.parts.sword) player.parts.sword.visible = true;
        if (player.parts.bowBack) player.parts.bowBack.visible = true;
        updateSkillLocks(); updatePowerTag();
      },
      setWave: function (n) { beginWave(n); },
      getState: function () {
        return {
          mode: mode, score: score, wave: wave, hp: player.hp,
          gunLv: player.gunLv, swordLv: player.swordLv, bowLv: player.bowLv,
          boss: bossRef ? { name: bossRef.name, hp: bossRef.hp, maxHp: bossRef.maxHp } : null,
          enemies: enemies.length, pickups: pickups.map((p) => p.typ),
        };
      },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
