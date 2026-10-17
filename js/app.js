/* ==========================================================================
   Pelican Point
   A little seaside world built with three.js — no external assets required.
   ========================================================================== */
(() => {
  "use strict";

  const canvas = document.getElementById("world");
  const experience = document.getElementById("experience");
  const loader = document.getElementById("loader");
  const lapNumberEl = document.getElementById("lapNumber");
  const progressFillEl = document.getElementById("progressFill");
  const progressPelicanEl = document.getElementById("progressPelican");
  const playButton = document.getElementById("playButton");
  const resetButton = document.getElementById("resetButton");

  if (!window.THREE) {
    loader.innerHTML = '<div class="loader-inner"><p class="loader-copy">three.js 没有加载成功，请刷新页面再试一次。</p></div>';
    return;
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pageParams = new URLSearchParams(window.location.search);
  const previewMode = pageParams.has("preview");
  const stillMode = pageParams.has("still");
  const compactScreen = window.matchMedia("(max-width: 720px)").matches;
  const math = Math;
  const PI = math.PI;
  const TAU = PI * 2;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });
  } catch (error) {
    loader.innerHTML = '<div class="loader-inner"><p class="loader-copy">这片海需要 WebGL 才能出现，请换一个支持 WebGL 的浏览器。</p></div>';
    return;
  }

  renderer.setPixelRatio(previewMode ? 1 : math.min(window.devicePixelRatio || 1, compactScreen ? 1.6 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.01;
  renderer.shadowMap.enabled = !previewMode;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xecc3ac);
  scene.fog = new THREE.Fog(0xedc4a8, 56, 185);

  const camera = new THREE.PerspectiveCamera(
    38,
    window.innerWidth / window.innerHeight,
    0.1,
    420
  );

  /* ========================================================================
     Small utilities
     ====================================================================== */
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rng = mulberry32(19780607);
  const rand = (min = 0, max = 1) => min + rng() * (max - min);
  const pick = (arr) => arr[math.floor(rng() * arr.length)];
  const clamp = THREE.MathUtils.clamp;
  const lerp = THREE.MathUtils.lerp;

  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V3(0, 1, 0);

  function std(options) {
    return new THREE.MeshStandardMaterial(
      Object.assign({ roughness: 0.84, metalness: 0.0 }, options)
    );
  }

  function basic(options) {
    return new THREE.MeshBasicMaterial(Object.assign({}, options));
  }

  function shadowify(object, cast = true, receive = true) {
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = cast;
        child.receiveShadow = receive;
      }
    });
    return object;
  }

  function addMesh(parent, geometry, material, position, opts = {}) {
    const mesh = new THREE.Mesh(geometry, material);
    if (position) mesh.position.copy(position);
    if (opts.rotation) mesh.rotation.set(opts.rotation.x || 0, opts.rotation.y || 0, opts.rotation.z || 0);
    if (opts.scale) {
      if (typeof opts.scale === "number") mesh.scale.setScalar(opts.scale);
      else mesh.scale.copy(opts.scale);
    }
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    parent.add(mesh);
    return mesh;
  }

  function meshBetween(a, b, radius, material, radialSegments = 8, parent = null) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geometry = new THREE.CylinderGeometry(radius, radius, len, radialSegments, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (parent) parent.add(mesh);
    return mesh;
  }

  function capsuleBetween(a, b, radius, material, parent = null, capSeg = 4, radial = 10) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geometry = new THREE.CapsuleGeometry(radius, len, capSeg, radial);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (parent) parent.add(mesh);
    return mesh;
  }

  function tubeFromPoints(points, radius, material, closed = false, tubularSeg = 32, radialSeg = 8) {
    const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.42);
    const geometry = new THREE.TubeGeometry(curve, tubularSeg, radius, radialSeg, closed);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function canvasTexture(width, height, draw) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d");
    draw(ctx, width, height);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function radialTexture(stops) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      if (stops) {
        stops.forEach(([offset, color]) => g.addColorStop(offset, color));
      } else {
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.28, "rgba(255,255,255,.7)");
        g.addColorStop(1, "rgba(255,255,255,0)");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }

  /* ========================================================================
     Palette & shared materials
     ====================================================================== */
  const inkMat = std({ color: 0x31463a, roughness: 0.8 });
  const creamMat = std({ color: 0xf4e6cf, roughness: 0.9 });
  const stoneMat = std({ color: 0xcbb495, roughness: 0.98 });
  const darkStoneMat = std({ color: 0x7d6b5c, roughness: 1 });
  const woodMat = std({ color: 0x93684d, roughness: 0.9 });
  const woodLightMat = std({ color: 0xb8865e, roughness: 0.88 });
  const metalMat = std({ color: 0x716c5d, roughness: 0.4, metalness: 0.65 });
  const chromeMat = std({ color: 0xe7dcc4, roughness: 0.24, metalness: 0.64 });
  const leatherMat = std({ color: 0x8e5b42, roughness: 0.72 });
  const rootMat = std({ color: 0x745341, roughness: 1 });
  const coralMat = std({ color: 0xd9755b, roughness: 0.86 });
  const creamPaintMat = std({ color: 0xf7e7cd, roughness: 0.66 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffdca2,
    emissive: 0xff9e43,
    emissiveIntensity: 1.25,
    roughness: 0.2,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  });

  /* ========================================================================
     Lighting
     ====================================================================== */
  const sunDirection = V3(-0.52, 0.115, -0.85).normalize();

  const hemi = new THREE.HemisphereLight(0xb3bdd8, 0x767654, 0.72);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(0xffc795, 3.35);
  sunLight.position.set(-28, 25, -32);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(compactScreen ? 1024 : 2048, compactScreen ? 1024 : 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 80;
  sunLight.shadow.camera.left = -19;
  sunLight.shadow.camera.right = 19;
  sunLight.shadow.camera.top = 19;
  sunLight.shadow.camera.bottom = -19;
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.035;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fillLight = new THREE.DirectionalLight(0x89aebe, 0.34);
  fillLight.position.set(20, 11, 24);
  scene.add(fillLight);

  const warmBounce = new THREE.PointLight(0xffb67a, 1.8, 18, 2);
  warmBounce.position.set(0, 1.5, 0);
  scene.add(warmBounce);

  /* ========================================================================
     Sky
     ====================================================================== */
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(0x6f80ad) },
      uUpper: { value: new THREE.Color(0xbb91ae) },
      uHorizon: { value: new THREE.Color(0xffcb9f) },
      uSunColor: { value: new THREE.Color(0xffd49d) },
      uSunDir: { value: sunDirection.clone() }
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uUpper;
      uniform vec3 uHorizon;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uUpper, smoothstep(0.0, 0.34, pow(h, 0.75)));
        col = mix(col, uZenith, smoothstep(0.22, 0.92, h));

        float haze = exp(-max(d.y, 0.0) * 10.0);
        col = mix(col, vec3(1.0, 0.73, 0.55), haze * 0.12);

        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * pow(sd, 12.0) * 0.3;
        col += uSunColor * pow(sd, 70.0) * 0.38;
        col += uSunColor * pow(sd, 380.0) * 0.75;
        float disc = smoothstep(0.999, 0.99972, sd);
        col = mix(col, vec3(1.0, 0.93, 0.78) * 1.2, disc * 0.96);

        float below = smoothstep(0.02, -0.08, d.y);
        col = mix(col, vec3(0.91, 0.67, 0.58), below);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 48, 26), skyMaterial);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const sunGlowTexture = radialTexture([
    [0, "rgba(255,242,214,0.95)"],
    [0.12, "rgba(255,218,170,0.58)"],
    [0.42, "rgba(255,190,143,0.17)"],
    [1, "rgba(255,190,143,0)"]
  ]);
  const sunGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunGlowTexture,
      color: 0xffcf9d,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false
    })
  );
  sunGlow.position.copy(sunDirection).multiplyScalar(210);
  sunGlow.scale.set(54, 54, 1);
  sunGlow.renderOrder = -8;
  scene.add(sunGlow);

  /* ========================================================================
     Pastel clouds
     ====================================================================== */
  const clouds = [];
  const cloudTints = [0xffe2d4, 0xffd8c8, 0xf7d6d2, 0xffe9dc];
  const cloudGeometry = new THREE.SphereGeometry(1, 20, 14);

  function createCloud(x, y, z, scale, rotation, tintIndex, phase) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = rotation;
    group.rotation.z = rand(-0.04, 0.04);

    const blobLayout = [
      [0, 0.2, 0, 1.0, 0.58, 0.7],
      [-0.82, -0.02, 0.08, 0.7, 0.45, 0.56],
      [0.78, -0.06, -0.04, 0.78, 0.46, 0.58],
      [0.18, 0.62, 0.02, 0.61, 0.42, 0.48],
      [-0.28, 0.52, -0.1, 0.54, 0.35, 0.42],
      [1.38, -0.01, 0.06, 0.52, 0.32, 0.4]
    ];

    blobLayout.forEach((blob, index) => {
      const color = new THREE.Color(cloudTints[(tintIndex + index) % cloudTints.length]);
      color.offsetHSL(rand(-0.01, 0.01), rand(-0.02, 0.02), rand(-0.025, 0.025));
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        fog: false
      });
      const puff = new THREE.Mesh(cloudGeometry, material);
      puff.position.set(blob[0], blob[1], blob[2]);
      puff.scale.set(blob[3], blob[4], blob[5]);
      puff.renderOrder = -5;
      group.add(puff);
    });

    group.scale.set(scale, scale * 0.68, scale);
    group.userData.baseX = x;
    group.userData.phase = phase;
    scene.add(group);
    clouds.push(group);
    return group;
  }


  /* ========================================================================
     Sea
     ====================================================================== */
  const seaUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDirection.clone() },
    uSunColor: { value: new THREE.Color(0xffd5a3) },
    uDeep: { value: new THREE.Color(0x386d77) },
    uShallow: { value: new THREE.Color(0x7fa19b) },
    uHorizon: { value: new THREE.Color(0xf2b99f) }
  };

  const seaMaterial = new THREE.ShaderMaterial({
    uniforms: seaUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWave;
      varying float vDistance;

      void main() {
        vec3 p = position;
        float d = length(p.xy);
        float openWater = smoothstep(10.0, 28.0, d);
        float waveA = sin(p.x * 0.31 + uTime * 0.74) * 0.055;
        float waveB = sin(p.y * 0.24 - uTime * 0.51) * 0.048;
        float waveC = sin((p.x + p.y) * 0.16 + uTime * 0.94) * 0.032;
        p.z += (waveA + waveB + waveC) * openWater;
        vWave = waveA + waveB + waveC;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorldPos = world.xyz;
        vDistance = length(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uHorizon;
      varying vec3 vWorldPos;
      varying float vWave;
      varying float vDistance;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 2.2);
        float heightMix = clamp(0.3 + vWave * 2.2, 0.0, 1.0);
        vec3 col = mix(uDeep, uShallow, heightMix * 0.7);
        col = mix(col, uHorizon, fresnel * 0.42);

        // Long, soft ribbons of movement instead of noisy white sparkles.
        float bands = sin(vWorldPos.x * 0.085 + vWorldPos.z * 0.11 + uTime * 0.34) * 0.5 + 0.5;
        col += vec3(0.016, 0.026, 0.024) * smoothstep(0.52, 0.98, bands);

        vec2 sunXZ = normalize(uSunDir.xz);
        vec2 pointXZ = normalize(vWorldPos.xz + vec2(0.0001));
        float towardSun = max(dot(pointXZ, sunXZ), 0.0);
        float corridor = pow(towardSun, 11.0);
        float slowRipple = sin(vWorldPos.x * 0.19 + vWorldPos.z * 0.12 + uTime * 0.52) * 0.5 + 0.5;
        col += uSunColor * corridor * smoothstep(0.58, 1.0, slowRipple) * 0.14;

        float fogFactor = smoothstep(78.0, 225.0, vDistance);
        col = mix(col, uHorizon, fogFactor);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  });

  const sea = new THREE.Mesh(new THREE.PlaneGeometry(520, 520, 96, 96), seaMaterial);
  sea.rotation.x = -PI / 2;
  sea.position.y = -1.58;
  sea.receiveShadow = false;
  scene.add(sea);

  /* Distant islands on the horizon */
  const distantIslandColors = [0x8b7c80, 0x80757d, 0x958287, 0x796e79];
  const distantIslands = new THREE.Group();
  scene.add(distantIslands);

  function addDistantIsland(x, z, scale, rotation, color) {
    const group = new THREE.Group();
    group.position.set(x, -1.6, z);
    group.rotation.y = rotation;
    const mat = basic({ color, fog: true });
    const mounds = [
      [0, 0.5, 0, 1.6, 0.6, 1.0],
      [-0.85, 1.15, 0.2, 0.82, 1.25, 0.72],
      [0.95, 0.8, -0.35, 0.7, 0.72, 0.85],
      [-1.7, 0.4, 0.7, 0.75, 0.33, 0.9]
    ];
    mounds.forEach(([mx, h, mz, sx, sy, sz]) => {
      const mound = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat);
      mound.position.set(mx, h, mz);
      mound.scale.set(sx, sy, sz);
      group.add(mound);
    });
    group.scale.setScalar(scale);
    distantIslands.add(group);
  }

  addDistantIsland(-105, -142, 3.8, 0.6, distantIslandColors[0]);
  addDistantIsland(96, -180, 4.6, -0.3, distantIslandColors[1]);
  addDistantIsland(160, 44, 3.0, 0.8, distantIslandColors[2]);
  addDistantIsland(-165, 45, 3.4, -0.8, distantIslandColors[3]);
  addDistantIsland(28, 160, 3.6, 2.3, distantIslandColors[1]);

  /* ========================================================================
     Island
     ====================================================================== */
  const world = new THREE.Group();
  scene.add(world);

  const RIDER_RADIUS = 7.25;
  const PATH_INNER = 6.12;
  const PATH_OUTER = 8.38;

  const grassTexture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#95a978";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 3600; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const c = pick(["#a4b585", "#8ca06f", "#b0bd92", "#7f9768", "#9caf7d"]);
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.24 + rng() * 0.45;
      ctx.lineWidth = rng() * 1.4 + 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rand(-2.5, 2.5), y - rand(2, 8));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 70; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = rand(10, 48);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(243,225,176,${rand(0.025, 0.09)})`);
      g.addColorStop(1, "rgba(243,225,176,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  grassTexture.wrapS = grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(9, 9);

  const sandTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#d9c19c";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = pick(["#cbb18a", "#e7d2ae", "#c4a77f", "#eedab7"]);
      ctx.globalAlpha = rand(0.14, 0.5);
      const s = rand(0.5, 2.2);
      ctx.fillRect(rng() * w, rng() * h, s, s);
    }
    ctx.globalAlpha = 1;
  });
  sandTexture.wrapS = sandTexture.wrapT = THREE.RepeatWrapping;
  sandTexture.repeat.set(8, 8);

  const grassMaterial = std({ map: grassTexture, color: 0xffffff, roughness: 1 });
  const sandMaterial = std({ map: sandTexture, color: 0xffffff, roughness: 1 });
  const pathMaterial = std({ color: 0xd3bd99, roughness: 1 });

  // Green top of the island
  const islandTop = new THREE.Mesh(new THREE.CircleGeometry(12.25, 96), grassMaterial);
  islandTop.rotation.x = -PI / 2;
  islandTop.position.y = 0;
  islandTop.receiveShadow = true;
  world.add(islandTop);

  // Sandy rim
  const islandSand = new THREE.Mesh(new THREE.RingGeometry(11.7, 12.55, 96), sandMaterial);
  islandSand.rotation.x = -PI / 2;
  islandSand.position.y = 0.006;
  islandSand.receiveShadow = true;
  world.add(islandSand);

  // A thin grassy lip at the rim
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(12.25, 12.38, 0.2, 96, 1, true),
    std({ color: 0x93a677, roughness: 1, flatShading: true })
  );
  lip.position.y = -0.1;
  lip.receiveShadow = true;
  world.add(lip);

  /* Rocky cliff built from irregular rings */
  function createCliff() {
    const rings = [
      { y: -0.05, r: 12.36 },
      { y: -0.55, r: 12.16 },
      { y: -1.05, r: 11.7 },
      { y: -1.58, r: 10.9 },
      { y: -2.25, r: 9.45 },
      { y: -3.0, r: 7.45 },
      { y: -3.75, r: 4.8 },
      { y: -4.4, r: 1.6 }
    ];
    const segments = 64;
    const positions = [];
    const colors = [];
    const indices = [];
    const rockLight = new THREE.Color(0xa97a61);
    const rockMid = new THREE.Color(0x8c6655);
    const rockDark = new THREE.Color(0x625052);

    for (let ring = 0; ring < rings.length; ring++) {
      const level = rings[ring];
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * TAU;
        const wobble = 1 + 0.055 * math.sin(a * 7 + ring * 1.12) + 0.025 * math.sin(a * 13 - ring * 2.3);
        const r = level.r * wobble;
        const jitterY = 0.09 * math.sin(a * 9 + ring * 2.4) + rand(-0.08, 0.08);
        positions.push(math.sin(a) * r, level.y + jitterY, math.cos(a) * r);
        const color = rockLight.clone().lerp(rockMid, clamp(-level.y / 4.2, 0, 1));
        if (ring > 3) color.lerp(rockDark, (level.y + 1.7) * -0.2);
        color.offsetHSL(rand(-0.012, 0.012), rand(-0.02, 0.02), rand(-0.045, 0.045));
        colors.push(color.r, color.g, color.b);
      }
    }

    for (let ring = 0; ring < rings.length - 1; ring++) {
      const base = ring * segments;
      const next = (ring + 1) * segments;
      for (let j = 0; j < segments; j++) {
        const jn = (j + 1) % segments;
        indices.push(base + j, next + j, base + jn);
        indices.push(base + jn, next + j, next + jn);
      }
    }

    // close the underside
    const centerIndex = positions.length / 3;
    positions.push(0, -4.6, 0);
    colors.push(rockDark.r, rockDark.g, rockDark.b);
    const last = (rings.length - 1) * segments;
    for (let j = 0; j < segments; j++) {
      indices.push(last + j, centerIndex, last + ((j + 1) % segments));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      flatShading: true
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    return mesh;
  }

  world.add(createCliff());

  // A few boulders peeking from the cliff
  const boulderMaterial = std({ color: 0x846c5c, roughness: 1, flatShading: true });
  const boulders = [
    [10.9, -1.25, 4.7, 0.62, 0.42, 0.5],
    [-8.2, -1.5, 7.9, 0.8, 0.52, 0.64],
    [4.6, -1.75, -10.2, 0.5, 0.34, 0.45],
    [-10.9, -1.1, -3.1, 0.46, 0.4, 0.34]
  ];
  boulders.forEach(([x, y, z, sx, sy, sz], i) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), boulderMaterial);
    rock.position.set(x, y, z);
    rock.scale.set(sx, sy, sz);
    rock.rotation.set(rand(0, 1), rand(0, 3), rand(0, 1));
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
  });

  // Foam rings around the waterline
  const foamGroup = new THREE.Group();
  foamGroup.position.y = -1.54;
  world.add(foamGroup);
  const foamMaterial = basic({
    color: 0xfff2dd,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const foamMaterial2 = basic({
    color: 0xfff7ea,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  [11.05, 11.45, 11.9].forEach((radius, i) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + (i === 2 ? 0.18 : 0.32), 96),
      i === 1 ? foamMaterial2 : foamMaterial
    );
    ring.rotation.x = -PI / 2;
    ring.renderOrder = 1;
    foamGroup.add(ring);
  });

  /* ========================================================================
     Circular path
     ====================================================================== */
  const pathBase = new THREE.Mesh(
    new THREE.RingGeometry(PATH_INNER, PATH_OUTER, 96),
    pathMaterial
  );
  pathBase.rotation.x = -PI / 2;
  pathBase.position.y = 0.038;
  pathBase.receiveShadow = true;
  world.add(pathBase);

  // Concentric ring borders
  [PATH_INNER, PATH_OUTER].forEach((radius, index) => {
    const border = new THREE.Mesh(
      new THREE.TorusGeometry(radius, index === 0 ? 0.06 : 0.075, 6, 128),
      std({ color: 0xb8a17e, roughness: 0.95 })
    );
    border.rotation.x = PI / 2;
    border.position.y = 0.055;
    border.castShadow = true;
    border.receiveShadow = true;
    world.add(border);
  });

  // Cobblestones, laid in concentric courses
  (() => {
    const rows = 9;
    const rowWidth = (PATH_OUTER - 0.25 - PATH_INNER - 0.15) / rows;
    const stoneGeometry = new THREE.BoxGeometry(1, 1, 1);
    const stoneMaterial = std({ color: 0xffffff, roughness: 0.9 });
    const palette = [0xe2d0ad, 0xd7c099, 0xead9ba, 0xcbb18d, 0xdfcaa6, 0xd0bb9d];
    const positions = [];
    for (let row = 0; row < rows; row++) {
      const radius = PATH_INNER + 0.3 + rowWidth * (row + 0.5);
      const count = math.max(16, math.floor((TAU * radius) / 0.38));
      const offset = row % 2 === 0 ? 0 : TAU / count / 2;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + offset + rand(-0.012, 0.012);
        const arc = (TAU * radius) / count;
        positions.push({
          x: math.sin(angle) * radius,
          z: math.cos(angle) * radius,
          angle,
          sx: arc * rand(0.72, 0.83),
          sz: rowWidth * rand(0.63, 0.75),
          sy: rand(0.026, 0.042),
          color: new THREE.Color(pick(palette)).offsetHSL(0, rand(-0.015, 0.015), rand(-0.035, 0.045))
        });
      }
    }

    const stones = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((stone, i) => {
      dummy.position.set(stone.x, 0.076 + stone.sy / 2, stone.z);
      dummy.rotation.set(0, stone.angle, 0);
      dummy.scale.set(stone.sx, stone.sy, stone.sz);
      dummy.updateMatrix();
      stones.setMatrixAt(i, dummy.matrix);
      stones.setColorAt(i, stone.color);
    });
    stones.instanceMatrix.needsUpdate = true;
    if (stones.instanceColor) stones.instanceColor.needsUpdate = true;
    stones.receiveShadow = true;
    stones.castShadow = false;
    world.add(stones);
  })();

  // A lighter central garden apron
  const gardenApron = new THREE.Mesh(
    new THREE.CircleGeometry(6.08, 96),
    std({ color: 0xa9ba87, roughness: 1 })
  );
  gardenApron.rotation.x = -PI / 2;
  gardenApron.position.y = 0.018;
  gardenApron.receiveShadow = true;
  world.add(gardenApron);

  // A shallow stone border around the garden
  const gardenBorder = new THREE.Mesh(
    new THREE.TorusGeometry(6.1, 0.1, 6, 128),
    std({ color: 0xb49d7c, roughness: 0.92 })
  );
  gardenBorder.rotation.x = PI / 2;
  gardenBorder.position.y = 0.063;
  gardenBorder.castShadow = true;
  gardenBorder.receiveShadow = true;
  world.add(gardenBorder);

  /* ========================================================================
     Central lighthouse
     ====================================================================== */
  const lighthouse = new THREE.Group();
  lighthouse.position.y = 0.05;
  lighthouse.scale.setScalar(0.88);
  world.add(lighthouse);

  const lighthouseCreamMat = std({ color: 0xf4e4cd, roughness: 0.8 });
  const lighthouseCoralMat = std({ color: 0xcb6f5b, roughness: 0.8 });
  const lighthouseMetalMat = std({ color: 0x384f4a, roughness: 0.55, metalness: 0.45 });

  const lighthouseBase = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.2, 0.22, 48), stoneMat);
  lighthouseBase.position.y = 0.08;
  lighthouseBase.receiveShadow = true;
  lighthouseBase.castShadow = true;
  lighthouse.add(lighthouseBase);

  const flowerBed = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.8, 0.17, 48),
    std({ color: 0x836751, roughness: 1 })
  );
  flowerBed.position.y = 0.22;
  flowerBed.receiveShadow = true;
  flowerBed.castShadow = true;
  lighthouse.add(flowerBed);

  const bedRim = new THREE.Mesh(
    new THREE.TorusGeometry(1.78, 0.12, 7, 64),
    std({ color: 0xcab596, roughness: 0.9 })
  );
  bedRim.rotation.x = PI / 2;
  bedRim.position.y = 0.33;
  bedRim.castShadow = true;
  bedRim.receiveShadow = true;
  lighthouse.add(bedRim);

  const towerSegments = 7;
  const towerBottom = 0.33;
  const towerHeight = 4.1;
  const segmentHeight = (towerHeight - towerBottom) / towerSegments;
  for (let i = 0; i < towerSegments; i++) {
    const t = i / towerSegments;
    const bottomRadius = 0.93 - t * 0.32;
    const topRadius = 0.93 - ((i + 1) / towerSegments) * 0.32;
    const material = i % 2 === 0 ? lighthouseCoralMat : lighthouseCreamMat;
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(topRadius, bottomRadius, segmentHeight + 0.008, 30, 1),
      material
    );
    segment.position.y = towerBottom + segmentHeight * (i + 0.5);
    segment.castShadow = true;
    segment.receiveShadow = true;
    lighthouse.add(segment);
  }

  // Arched door facing the sea
  const doorShape = new THREE.Shape();
  doorShape.moveTo(-0.19, 0);
  doorShape.lineTo(0.19, 0);
  doorShape.lineTo(0.19, 0.4);
  doorShape.quadraticCurveTo(0.19, 0.58, 0, 0.63);
  doorShape.quadraticCurveTo(-0.19, 0.58, -0.19, 0.4);
  doorShape.closePath();
  const door = new THREE.Mesh(new THREE.ShapeGeometry(doorShape), std({ color: 0x355350, roughness: 0.8 }));
  door.position.set(0, 0.4, 0.915);
  door.rotation.x = -0.045;
  door.castShadow = false;
  lighthouse.add(door);

  const doorStep = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.34), stoneMat);
  doorStep.position.set(0, 0.36, 1.04);
  doorStep.castShadow = true;
  doorStep.receiveShadow = true;
  lighthouse.add(doorStep);

  // Tiny porthole windows
  const windowPositions = [
    [1.9, 0.58, 0.03],
    [2.9, 0.5, 2.2],
    [3.45, 0.46, 4.15]
  ];
  windowPositions.forEach(([y, radius, angle]) => {
    const windowGroup = new THREE.Group();
    windowGroup.position.set(math.sin(angle) * radius, y, math.cos(angle) * radius);
    windowGroup.rotation.y = angle;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.29), std({ color: 0x355350, roughness: 0.75 }));
    frame.position.z = 0.008;
    const glowPane = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.2), basic({ color: 0xffd18c }));
    glowPane.position.z = 0.012;
    windowGroup.add(frame, glowPane);
    lighthouse.add(windowGroup);
  });

  // Balcony
  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.02, 0.14, 32), lighthouseCreamMat);
  balcony.position.y = 4.18;
  balcony.castShadow = true;
  balcony.receiveShadow = true;
  lighthouse.add(balcony);

  const railingTop = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.028, 5, 40),
    lighthouseMetalMat
  );
  railingTop.rotation.x = PI / 2;
  railingTop.position.y = 4.7;
  railingTop.castShadow = true;
  lighthouse.add(railingTop);

  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.5, 5), lighthouseMetalMat);
    post.position.set(math.sin(a) * 0.98, 4.46, math.cos(a) * 0.98);
    post.castShadow = true;
    lighthouse.add(post);
  }

  // Lantern room
  const lanternGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.57, 0.64, 16, 1, true), glassMat);
  lanternGlass.position.y = 4.58;
  lighthouse.add(lanternGlass);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const mullion = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.67, 4), lighthouseMetalMat);
    mullion.position.set(math.sin(a) * 0.55, 4.58, math.cos(a) * 0.55);
    mullion.castShadow = true;
    lighthouse.add(mullion);
  }

  const lampCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 12),
    basic({ color: 0xffedb0 })
  );
  lampCore.position.y = 4.55;
  lighthouse.add(lampCore);

  const lanternGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunGlowTexture,
      color: 0xffc574,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  lanternGlow.position.set(0, 4.58, 0);
  lanternGlow.scale.set(2.2, 2.2, 1);
  lighthouse.add(lanternGlow);

  const lighthouseLight = new THREE.PointLight(0xffb56c, 8, 13, 2);
  lighthouseLight.position.set(0, 4.62, 0);
  lighthouse.add(lighthouseLight);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.73, 0.62, 22), lighthouseCoralMat);
  roof.position.y = 5.21;
  roof.castShadow = true;
  roof.receiveShadow = true;
  lighthouse.add(roof);

  const roofTrim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 5, 30), lighthouseMetalMat);
  roofTrim.rotation.x = PI / 2;
  roofTrim.position.y = 4.92;
  roofTrim.castShadow = true;
  lighthouse.add(roofTrim);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), chromeMat);
  finial.position.y = 5.6;
  finial.castShadow = true;
  lighthouse.add(finial);

  // Little striped pennant
  const pennantGroup = new THREE.Group();
  pennantGroup.position.set(0, 5.58, 0);
  const pennantPole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.56, 5), lighthouseMetalMat);
  pennantPole.position.y = 0.2;
  pennantGroup.add(pennantPole);
  const pennantShape = new THREE.Shape();
  pennantShape.moveTo(0, 0.15);
  pennantShape.lineTo(0.5, 0.03);
  pennantShape.lineTo(0, -0.1);
  pennantShape.closePath();
  const pennant = new THREE.Mesh(
    new THREE.ShapeGeometry(pennantShape),
    basic({ color: 0xe4795d, side: THREE.DoubleSide })
  );
  pennant.position.set(0.01, 0.38, 0);
  pennantGroup.add(pennant);
  lighthouse.add(pennantGroup);

  /* ========================================================================
     Trees, palms and greenery
     ====================================================================== */
  const swaying = [];

  const trunkMaterial = std({ color: 0x7f5b46, roughness: 0.96 });
  const branchMaterial = std({ color: 0x75523f, roughness: 0.96 });
  const leafPalettes = [
    [0x78966d, 0x8da97d, 0x668764, 0x9eb68a],
    [0x849a70, 0x9aad7f, 0x738d65, 0xa9ba90],
    [0xad9271, 0xc2a37e, 0x987c61, 0xbaa586],
    [0x8ba08f, 0x9eb19d, 0x7b9484, 0xabbca8]
  ];

  function addTree(x, z, scale, palette, seed) {
    const tree = new THREE.Group();
    tree.position.set(x, 0.08, z);
    tree.rotation.y = rand(0, TAU);
    tree.scale.setScalar(scale);

    const leanX = rand(-0.3, 0.32);
    const leanZ = rand(-0.25, 0.25);
    const trunkTop = V3(leanX, 2.15, leanZ);
    const trunk = meshBetween(V3(0, 0, 0), trunkTop, 0.17, trunkMaterial, 7);
    trunk.scale.x = 0.88;
    tree.add(trunk);

    const branchA = meshBetween(V3(leanX * 0.5, 1.25, leanZ * 0.4), V3(leanX - 0.62, 2.35, leanZ + 0.25), 0.08, branchMaterial, 5);
    const branchB = meshBetween(V3(leanX * 0.6, 1.5, leanZ * 0.5), V3(leanX + 0.64, 2.4, leanZ - 0.2), 0.075, branchMaterial, 5);
    tree.add(branchA, branchB);

    const canopy = new THREE.Group();
    canopy.position.set(leanX, 2.48, leanZ);
    const blobPositions = [
      [0, 0.12, 0, 1.14, 0.88, 1.06],
      [-0.8, -0.1, 0.18, 0.82, 0.7, 0.76],
      [0.82, -0.17, -0.14, 0.88, 0.68, 0.8],
      [0.08, 0.74, -0.04, 0.72, 0.62, 0.7],
      [-0.12, 0.05, 0.8, 0.68, 0.56, 0.62],
      [0.2, -0.12, -0.74, 0.7, 0.58, 0.66]
    ];
    blobPositions.forEach((b, i) => {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        std({
          color: palette[i % palette.length],
          roughness: 0.95,
          flatShading: true
        })
      );
      m.position.set(b[0], b[1], b[2]);
      m.scale.set(b[3], b[4], b[5]);
      m.rotation.set(rand(0, 1.5), rand(0, TAU), rand(0, 1.5));
      m.castShadow = true;
      m.receiveShadow = true;
      canopy.add(m);
    });

    // tiny warm blossoms tucked in the foliage
    for (let i = 0; i < 4; i++) {
      const blossom = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.065, 0),
        basic({ color: i % 2 === 0 ? 0xf4d5a4 : 0xe9a188 })
      );
      const a = rand(0, TAU);
      const r = rand(0.45, 1.05);
      blossom.position.set(math.sin(a) * r, rand(-0.25, 0.75), math.cos(a) * r);
      canopy.add(blossom);
    }

    tree.add(canopy);
    tree.userData.canopy = canopy;
    tree.userData.sway = rand(0.008, 0.018);
    tree.userData.phase = seed;
    world.add(tree);
    swaying.push(tree);
    return tree;
  }

  addTree(3.65, 2.2, 1.08, leafPalettes[0], 0.4);
  addTree(1.85, -3.9, 1.28, leafPalettes[1], 1.9);
  addTree(-3.9, -2.4, 0.98, leafPalettes[3], 3.1);
  addTree(-3.4, 2.9, 0.76, leafPalettes[2], 4.6);
  addTree(0.2, 4.75, 0.62, leafPalettes[0], 5.4);
  addTree(-1.0, -4.35, 0.7, leafPalettes[2], 2.8);

  // Palms: tall, slender and a little theatrical
  function createPalm(x, z, scale, rotation) {
    const palm = new THREE.Group();
    palm.position.set(x, 0.1, z);
    palm.rotation.y = rotation;
    palm.scale.setScalar(scale);

    const points = [
      V3(0, 0, 0),
      V3(0.12, 0.7, 0.05),
      V3(0.32, 1.45, 0.1),
      V3(0.58, 2.2, 0.06),
      V3(0.9, 2.9, 0)
    ];
    const trunkCurve = new THREE.CatmullRomCurve3(points);
    const trunk = new THREE.Mesh(
      new THREE.TubeGeometry(trunkCurve, 16, 0.105, 7, false),
      std({ color: 0x9a7858, roughness: 0.96, flatShading: true })
    );
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    palm.add(trunk);

    const crown = points[points.length - 1];
    const frondMaterial = std({ color: 0x6f9269, roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
    const frondLight = std({ color: 0x84a47b, roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + 0.25;
      const length = 1.7 + (i % 3) * 0.15;
      const dir = V3(math.sin(a), 0.22 - (i % 2) * 0.1, math.cos(a)).normalize();
      const end = crown.clone().addScaledVector(dir, length);
      const mid = crown.clone().addScaledVector(dir, length * 0.58);
      mid.y += 0.12;
      const curve = new THREE.CatmullRomCurve3([crown, mid, end]);
      const geo = new THREE.TubeGeometry(curve, 8, 0.115, 3, false);
      const frond = new THREE.Mesh(geo, i % 2 ? frondMaterial : frondLight);
      frond.scale.z = 0.18;
      frond.castShadow = true;
      frond.receiveShadow = true;
      palm.add(frond);

      // fan tip, flattened
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 4), i % 2 ? frondLight : frondMaterial);
      tip.position.copy(end);
      tip.quaternion.setFromUnitVectors(UP, dir);
      tip.scale.z = 0.35;
      tip.castShadow = true;
      palm.add(tip);
    }

    // Coconuts
    for (let i = 0; i < 3; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), std({ color: 0x7d5d43, roughness: 1 }));
      const a = i * 2.1 + 0.4;
      nut.position.set(crown.x + math.sin(a) * 0.14, crown.y - 0.18, crown.z + math.cos(a) * 0.14);
      nut.castShadow = true;
      palm.add(nut);
    }

    palm.userData.sway = 0.012;
    palm.userData.phase = rotation;
    world.add(palm);
    swaying.push(palm);
    return palm;
  }

  createPalm(9.7, 1.1, 1.0, -0.3);
  createPalm(-8.4, -6.7, 0.82, 2.4);

  // Low bushes
  const bushPalettes = [
    [0x708d65, 0x819b74, 0x637f5d],
    [0x869a6f, 0x9aac80, 0x718b64],
    [0x7d9586, 0x90a796, 0x6d8677]
  ];
  const bushPositions = [
    [8.9, -5.8, 0.8], [-9.6, -4.0, 0.65], [-6.5, 8.0, 0.58],
    [6.9, 8.3, 0.48], [10.6, 3.0, 0.55], [-10.9, 4.1, 0.62],
    [4.6, -9.1, 0.52], [-4.2, -9.8, 0.44], [2.8, 10.0, 0.62]
  ];
  bushPositions.forEach(([x, z, s], index) => {
    const bush = new THREE.Group();
    bush.position.set(x, 0.08, z);
    const palette = bushPalettes[index % bushPalettes.length];
    for (let i = 0; i < 4; i++) {
      const blob = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        std({ color: palette[i % 3], roughness: 0.96, flatShading: true })
      );
      blob.position.set(rand(-0.3, 0.3), 0.25 + i * 0.06, rand(-0.25, 0.25));
      blob.scale.set(rand(0.38, 0.62), rand(0.28, 0.42), rand(0.35, 0.55));
      blob.castShadow = true;
      blob.receiveShadow = true;
      bush.add(blob);
    }
    bush.scale.setScalar(s);
    world.add(bush);
  });

  // Perimeter rocks
  for (let i = 0; i < 13; i++) {
    const angle = rand(0, TAU);
    const radius = rand(10.2, 11.7);
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      std({ color: pick([0x9b8b78, 0x887964, 0xa79882]), roughness: 1, flatShading: true })
    );
    const s = rand(0.12, 0.3);
    rock.position.set(math.sin(angle) * radius, rand(0.04, 0.12), math.cos(angle) * radius);
    rock.scale.set(s * rand(0.9, 1.6), s * rand(0.5, 0.8), s);
    rock.rotation.set(rand(0, 1), rand(0, TAU), rand(0, 1));
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
  }

  /* ========================================================================
     Wildflowers
     ====================================================================== */
  function scatterFlowers() {
    const count = 430;
    const stemGeometry = new THREE.CylinderGeometry(0.012, 0.016, 1, 4);
    const stemMaterial = std({ color: 0x5e7d57, roughness: 1 });
    const stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, count);
    const headGeometry = new THREE.IcosahedronGeometry(1, 0);
    const headMaterial = std({ color: 0xffffff, roughness: 0.8 });
    const heads = new THREE.InstancedMesh(headGeometry, headMaterial, count);
    const flowerColors = [0xec8c75, 0xf3d394, 0xf4ead8, 0xd9a5be, 0xe5a55e, 0xe87d64];
    const dummy = new THREE.Object3D();
    let n = 0;

    const addFlower = (radius, angle, baseY, size) => {
      if (n >= count) return;
      const x = math.sin(angle) * radius;
      const z = math.cos(angle) * radius;
      const height = rand(0.13, 0.36) * size;
      dummy.position.set(x, baseY + height / 2, z);
      dummy.rotation.set(0, rand(0, TAU), rand(-0.06, 0.06));
      dummy.scale.set(1, height, 1);
      dummy.updateMatrix();
      stems.setMatrixAt(n, dummy.matrix);

      dummy.position.set(x, baseY + height, z);
      dummy.rotation.set(rand(0, 1), rand(0, TAU), rand(0, 1));
      const headSize = rand(0.045, 0.085) * size;
      dummy.scale.set(headSize, headSize * rand(0.65, 1.0), headSize);
      dummy.updateMatrix();
      heads.setMatrixAt(n, dummy.matrix);
      heads.setColorAt(n, new THREE.Color(pick(flowerColors)).offsetHSL(0, rand(-0.05, 0.05), rand(-0.06, 0.06)));
      n++;
    };

    // Dense ring around the lighthouse bed
    for (let i = 0; i < 90; i++) addFlower(rand(1.9, 2.9), rand(0, TAU), 0.27, rand(0.8, 1.15));
    // Wildflowers in the central garden
    for (let i = 0; i < 210; i++) {
      const a = rand(0, TAU);
      const radius = rand(2.7, 5.8);
      addFlower(radius, a, 0.055, rand(0.7, 1.15));
    }
    // A few in the outer meadow, in little clusters
    for (let c = 0; c < 16; c++) {
      const baseAngle = rand(0, TAU);
      const baseRadius = rand(8.7, 11.6);
      for (let i = 0; i < 6; i++) {
        addFlower(baseRadius + rand(-0.4, 0.4), baseAngle + rand(-0.04, 0.04), 0.035, rand(0.6, 1));
      }
    }

    stems.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    stems.castShadow = false;
    stems.receiveShadow = true;
    heads.castShadow = false;
    heads.receiveShadow = true;
    world.add(stems, heads);
  }
  scatterFlowers();

  // Grass tufts
  (() => {
    const count = 310;
    const geo = new THREE.ConeGeometry(0.045, 0.26, 3);
    const mat = std({ color: 0xffffff, roughness: 1, flatShading: true });
    const tufts = new THREE.InstancedMesh(geo, mat, count);
    const colors = [0x819665, 0x91a576, 0x71875d, 0xa3b182];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const outer = i % 3 === 0;
      const radius = outer ? rand(8.6, 11.9) : rand(3.8, 5.9);
      const angle = rand(0, TAU);
      const height = rand(0.45, 1.15);
      dummy.position.set(math.sin(angle) * radius, 0.08 + 0.11 * height, math.cos(angle) * radius);
      dummy.rotation.set(rand(-0.1, 0.1), rand(0, TAU), rand(-0.1, 0.1));
      dummy.scale.set(rand(0.7, 1.6), height, rand(0.7, 1.6));
      dummy.updateMatrix();
      tufts.setMatrixAt(i, dummy.matrix);
      tufts.setColorAt(i, new THREE.Color(pick(colors)));
    }
    tufts.instanceMatrix.needsUpdate = true;
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    tufts.receiveShadow = true;
    world.add(tufts);
  })();

  /* ========================================================================
     Benches & lamps
     ====================================================================== */
  function createBench() {
    const bench = new THREE.Group();
    const seatY = 0.4;
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.055, 0.13), woodLightMat);
      slat.position.set(0, seatY, -0.12 + i * 0.16);
      slat.rotation.x = -0.04;
      slat.castShadow = true;
      slat.receiveShadow = true;
      bench.add(slat);
    }
    for (let i = 0; i < 3; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.08, 0.055), woodLightMat);
      slat.position.set(0, 0.6 + i * 0.16, -0.31 - i * 0.025);
      slat.rotation.x = -0.12;
      slat.castShadow = true;
      slat.receiveShadow = true;
      bench.add(slat);
    }
    [-0.48, 0.48].forEach((x) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.5), lighthouseMetalMat);
      leg.position.set(x, 0.2, 0.02);
      leg.castShadow = true;
      leg.receiveShadow = true;
      bench.add(leg);
      const backPost = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.58, 0.05), lighthouseMetalMat);
      backPost.position.set(x, 0.65, -0.35);
      backPost.rotation.x = -0.12;
      backPost.castShadow = true;
      bench.add(backPost);
      const armRest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), lighthouseMetalMat);
      armRest.position.set(x, 0.61, -0.06);
      armRest.castShadow = true;
      bench.add(armRest);
    });
    return bench;
  }

  [
    [1.8, 5.8],
    [4.85, 5.8]
  ].forEach(([angle, radius]) => {
    const bench = createBench();
    bench.position.set(math.sin(angle) * radius, 0.06, math.cos(angle) * radius);
    bench.rotation.y = angle;
    bench.scale.setScalar(0.92);
    world.add(bench);
  });

  const lampGlowTexture = radialTexture([
    [0, "rgba(255,237,190,.95)"],
    [0.2, "rgba(255,206,124,.7)"],
    [0.55, "rgba(255,180,100,.16)"],
    [1, "rgba(255,180,100,0)"]
  ]);

  function createLamp(angle, radius) {
    const lamp = new THREE.Group();
    lamp.position.set(math.sin(angle) * radius, 0.05, math.cos(angle) * radius);
    lamp.rotation.y = angle;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.13, 8), lighthouseMetalMat);
    base.position.y = 0.06;
    base.castShadow = true;
    base.receiveShadow = true;
    lamp.add(base);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.038, 2.3, 7), lighthouseMetalMat);
    pole.position.y = 1.2;
    pole.castShadow = true;
    lamp.add(pole);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.016, 4, 12), chromeMat);
    collar.rotation.x = PI / 2;
    collar.position.y = 1.85;
    lamp.add(collar);

    const lantern = new THREE.Group();
    lantern.position.y = 2.42;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.32, 6),
      glassMat
    );
    lantern.add(glass);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.36, 0.016), lighthouseMetalMat);
      const a = (i / 4) * TAU;
      bar.position.set(math.sin(a) * 0.16, 0, math.cos(a) * 0.16);
      lantern.add(bar);
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.18, 6), lighthouseMetalMat);
    top.position.y = 0.24;
    top.castShadow = true;
    lantern.add(top);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 6), chromeMat);
    cap.position.y = -0.17;
    lantern.add(cap);
    lamp.add(lantern);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: lampGlowTexture,
        color: 0xffc98a,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    glow.position.y = 2.42;
    glow.scale.set(1.15, 1.15, 1);
    lamp.add(glow);
    lamp.userData.glow = glow;
    lamp.userData.phase = rand(0, TAU);

    world.add(lamp);
    return lamp;
  }

  const lamps = [
    createLamp(0.7, 5.72),
    createLamp(2.28, 5.72),
    createLamp(3.88, 5.72),
    createLamp(5.48, 5.72)
  ];

  /* ========================================================================
     Bunting between little posts in the garden
     ====================================================================== */
  (() => {
    const posts = [];
    const angles = [0.35, 1.6, 2.85, 4.1, 5.35];
    const postMaterial = std({ color: 0x8c6c51, roughness: 0.9 });
    angles.forEach((a) => {
      const radius = 5.18;
      const x = math.sin(a) * radius;
      const z = math.cos(a) * radius;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.2, 6), postMaterial);
      post.position.set(x, 1.16, z);
      post.castShadow = true;
      post.receiveShadow = true;
      world.add(post);
      posts.push({ x, z, top: 2.22 });
    });

    const flagColors = [0xe37b5f, 0xf1c67e, 0xf5ead6, 0x8cab94];
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x6f6650, transparent: true, opacity: 0.7 });
    const flagGeom = new THREE.BufferGeometry();
    flagGeom.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0,
      0.18, 0, 0,
      0.09, -0.24, 0
    ], 3));
    flagGeom.computeVertexNormals();

    for (let i = 0; i < posts.length; i++) {
      const a = posts[i];
      const b = posts[(i + 1) % posts.length];
      const points = [];
      for (let s = 0; s <= 16; s++) {
        const t = s / 16;
        const x = lerp(a.x, b.x, t);
        const z = lerp(a.z, b.z, t);
        const y = lerp(a.top, b.top, t) - math.sin(t * PI) * 0.24;
        points.push(V3(x, y, z));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
      world.add(line);

      for (let f = 1; f <= 3; f++) {
        const t = f / 4;
        const p = points[math.round(t * 16)];
        const flag = new THREE.Mesh(
          flagGeom,
          basic({ color: flagColors[(i + f) % flagColors.length], side: THREE.DoubleSide })
        );
        flag.position.copy(p);
        const next = points[math.round(clamp(t + 0.02, 0, 1) * 16)];
        flag.rotation.y = math.atan2(next.x - p.x, next.z - p.z) + PI / 2;
        flag.castShadow = true;
        world.add(flag);
      }
    }
  })();

  /* ========================================================================
     Sailboats
     ====================================================================== */
  const boats = [];
  function createSailboat(scale, sailColor) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.16, 1.35, 6, 1, false),
      std({ color: 0xf2e4cb, roughness: 0.7 })
    );
    hull.rotation.z = PI / 2;
    hull.scale.z = 0.62;
    hull.position.y = 0.15;
    hull.castShadow = true;
    boat.add(hull);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.06, 0.38), std({ color: 0xb57a59, roughness: 0.8 }));
    deck.position.y = 0.32;
    boat.add(deck);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 2.3, 5), lighthouseMetalMat);
    mast.position.set(0.08, 1.4, 0);
    boat.add(mast);

    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(0, 1.75);
    sailShape.quadraticCurveTo(0.7, 0.78, 0.05, 0);
    sailShape.closePath();
    const sail = new THREE.Mesh(
      new THREE.ShapeGeometry(sailShape),
      basic({ color: sailColor, side: THREE.DoubleSide })
    );
    sail.position.set(0.13, 0.45, 0);
    sail.rotation.y = -0.15;
    boat.add(sail);

    const jibShape = new THREE.Shape();
    jibShape.moveTo(0, 0);
    jibShape.lineTo(0.75, 0.05);
    jibShape.lineTo(0.04, 1.25);
    jibShape.closePath();
    const jib = new THREE.Mesh(
      new THREE.ShapeGeometry(jibShape),
      basic({ color: 0xfdf5e5, side: THREE.DoubleSide })
    );
    jib.position.set(-0.02, 0.5, 0);
    boat.add(jib);

    boat.scale.setScalar(scale);
    boat.userData.phase = rand(0, TAU);
    boats.push(boat);
    return boat;
  }

  const boatA = createSailboat(0.75, 0xedc89c);
  boatA.position.set(-22, -1.48, -27);
  boatA.rotation.y = -0.4;
  scene.add(boatA);

  const boatB = createSailboat(0.45, 0xf7e7d4);
  boatB.position.set(34, -1.5, 8);
  boatB.rotation.y = 1.4;
  scene.add(boatB);

  /* ========================================================================
     Fireflies / dust
     ====================================================================== */
  const fireflyCount = 75;
  const fireflyPositions = new Float32Array(fireflyCount * 3);
  const fireflyData = [];
  for (let i = 0; i < fireflyCount; i++) {
    const angle = rand(0, TAU);
    const radius = rand(2.8, 10.8);
    const x = math.sin(angle) * radius;
    const z = math.cos(angle) * radius;
    const y = rand(0.4, 3.2);
    fireflyPositions[i * 3] = x;
    fireflyPositions[i * 3 + 1] = y;
    fireflyPositions[i * 3 + 2] = z;
    fireflyData.push({ x, y, z, phase: rand(0, TAU), speed: rand(0.2, 0.7) });
  }
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
  const fireflyMat = new THREE.PointsMaterial({
    map: radialTexture(),
    color: 0xffe0a2,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  /* ========================================================================
     Butterflies
     ====================================================================== */
  const butterflies = [];
  function createButterfly(color) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.018, 0.09, 3, 5),
      std({ color: 0x5b5141, roughness: 0.8 })
    );
    body.rotation.z = PI / 2;
    group.add(body);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.bezierCurveTo(0.06, 0.09, 0.18, 0.1, 0.2, 0.01);
    wingShape.bezierCurveTo(0.18, -0.06, 0.07, -0.055, 0, 0);
    const wingGeo = new THREE.ShapeGeometry(wingShape, 6);
    const wingMat = basic({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });

    const pivotA = new THREE.Group();
    const wingA = new THREE.Mesh(wingGeo, wingMat);
    wingA.rotation.x = -PI / 2;
    wingA.position.z = 0.01;
    pivotA.add(wingA);
    pivotA.rotation.z = 0.08;

    const pivotB = new THREE.Group();
    const wingB = new THREE.Mesh(wingGeo, wingMat);
    wingB.rotation.x = -PI / 2;
    wingB.rotation.y = PI;
    wingB.position.z = -0.01;
    pivotB.add(wingB);
    pivotB.rotation.z = -0.08;

    group.add(pivotA, pivotB);
    group.userData.pivotA = pivotA;
    group.userData.pivotB = pivotB;
    group.userData.phase = rand(0, TAU);
    group.userData.radius = rand(2.9, 4.8);
    group.userData.speed = rand(0.1, 0.2);
    group.userData.height = rand(0.7, 1.7);
    group.scale.setScalar(0.72);
    scene.add(group);
    butterflies.push(group);
    return group;
  }
  createButterfly(0xe88b72);
  createButterfly(0xf0c47e);

  /* ========================================================================
     Bicycle
     ====================================================================== */
  const riderRoot = new THREE.Group();
  world.add(riderRoot);
  const leanGroup = new THREE.Group();
  leanGroup.rotation.order = "YXZ";
  riderRoot.add(leanGroup);

  const bike = new THREE.Group();
  bike.position.y = 0;
  leanGroup.add(bike);

  const frameMat = std({ color: 0x72ad9e, roughness: 0.55, metalness: 0.1 });
  const frameDeepMat = std({ color: 0x4e8b7e, roughness: 0.55, metalness: 0.1 });
  const tireMat = std({ color: 0x3d4841, roughness: 0.86 });
  const tireStripeMat = std({ color: 0xe4d3b4, roughness: 0.8 });
  const spokeMat = std({ color: 0xb9ad99, roughness: 0.35, metalness: 0.7 });
  const pedalMat = std({ color: 0x8d674b, roughness: 0.7, metalness: 0.15 });

  const wheelCenters = {
    rear: V3(-0.79, 0.56, 0),
    front: V3(0.79, 0.56, 0)
  };
  const bottomBracket = V3(0.02, 0.55, 0);
  const wheelRadius = 0.545;
  const wheelGroups = [];

  function makeWheel() {
    const wheel = new THREE.Group();

    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.057, 12, 48), tireMat);
    tire.castShadow = true;
    tire.receiveShadow = true;
    wheel.add(tire);

    const sidewall = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.017, 6, 40), tireStripeMat);
    sidewall.castShadow = false;
    wheel.add(sidewall);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.405, 0.017, 6, 40), chromeMat);
    rim.castShadow = true;
    wheel.add(rim);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.15, 12), chromeMat);
    hub.rotation.x = PI / 2;
    hub.castShadow = true;
    wheel.add(hub);

    const hubRing = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.014, 4, 16), frameDeepMat);
    hubRing.rotation.x = PI / 2;
    hubRing.position.z = 0.06;
    wheel.add(hubRing);

    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const a2 = a + 0.18;
      const spoke = meshBetween(
        V3(0, 0, 0),
        V3(math.cos(a2) * 0.39, math.sin(a2) * 0.39, 0),
        0.0055,
        spokeMat,
        4
      );
      spoke.castShadow = false;
      wheel.add(spoke);
    }

    // a few playful beads on the spokes
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4;
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.023, 7, 5),
        std({ color: [0xe57d62, 0xf0c16d, 0xf5e6cc, 0x6e9e91][i], roughness: 0.5 })
      );
      bead.position.set(math.cos(a) * 0.27, math.sin(a) * 0.27, 0.055);
      bead.castShadow = true;
      wheel.add(bead);
    }

    wheelGroups.push(wheel);
    return wheel;
  }

  const rearWheel = makeWheel();
  rearWheel.position.copy(wheelCenters.rear);
  bike.add(rearWheel);

  const frontWheel = makeWheel();
  frontWheel.position.copy(wheelCenters.front);
  bike.add(frontWheel);

  // Fenders
  function addFender(position, rotationOffset) {
    const fender = new THREE.Mesh(
      new THREE.TorusGeometry(0.535, 0.035, 7, 36, PI * 0.78),
      frameMat
    );
    fender.rotation.z = rotationOffset;
    fender.position.copy(position);
    fender.castShadow = true;
    fender.receiveShadow = true;
    bike.add(fender);

    const pinstripe = new THREE.Mesh(
      new THREE.TorusGeometry(0.535, 0.009, 4, 36, PI * 0.78),
      creamPaintMat
    );
    pinstripe.rotation.z = rotationOffset;
    pinstripe.position.copy(position);
    pinstripe.position.z += 0.032;
    bike.add(pinstripe);
  }
  addFender(wheelCenters.rear, 0.13 * PI);
  addFender(wheelCenters.front, 0.13 * PI);

  // Frame tubes
  const headBottom = V3(0.64, 0.88, 0);
  const headTop = V3(0.6, 1.15, 0);
  const seatCluster = V3(-0.18, 1.17, 0);

  const framePieces = [
    tubeFromPoints([
      V3(0.61, 0.88, 0),
      V3(0.55, 0.78, 0),
      V3(0.28, 0.64, 0),
      V3(0.02, 0.55, 0)
    ], 0.036, frameMat, false, 22, 8),
    tubeFromPoints([
      V3(0.6, 1.15, 0),
      V3(0.34, 1.04, 0),
      V3(0.07, 1.01, 0),
      V3(-0.16, 1.16, 0)
    ], 0.033, frameMat, false, 22, 8),
    meshBetween(bottomBracket, seatCluster, 0.033, frameMat, 8),
    meshBetween(seatCluster, V3(-0.2, 1.28, 0), 0.022, chromeMat, 7)
  ];
  framePieces.forEach((piece) => bike.add(piece));

  // Head tube
  const headTube = meshBetween(headBottom, headTop, 0.047, frameDeepMat, 9);
  bike.add(headTube);
  [V3(0.62, 0.9, 0), V3(0.6, 1.13, 0)].forEach((p) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 4, 12), chromeMat);
    ring.rotation.x = PI / 2;
    ring.position.copy(p);
    bike.add(ring);
  });

  // Chain stays, seat stays, forks
  [-0.063, 0.063].forEach((offset) => {
    bike.add(meshBetween(V3(bottomBracket.x, bottomBracket.y, offset), V3(wheelCenters.rear.x, wheelCenters.rear.y, offset * 0.65), 0.019, frameDeepMat, 6));
    bike.add(meshBetween(V3(seatCluster.x, seatCluster.y, offset * 0.6), V3(wheelCenters.rear.x, wheelCenters.rear.y, offset * 0.65), 0.016, frameDeepMat, 6));
  });

  [-0.072, 0.072].forEach((offset) => {
    const fork = meshBetween(
      V3(0.64, 0.87, offset * 0.7),
      V3(wheelCenters.front.x, wheelCenters.front.y, offset),
      0.017,
      frameMat,
      6
    );
    bike.add(fork);
  });
  bike.add(meshBetween(V3(0.64, 0.88, -0.055), V3(0.64, 0.88, 0.055), 0.032, frameDeepMat, 7));

  // Saddle
  const saddleGroup = new THREE.Group();
  saddleGroup.position.set(-0.2, 1.31, 0);
  const saddleBody = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), leatherMat);
  saddleBody.scale.set(0.25, 0.065, 0.16);
  saddleBody.castShadow = true;
  saddleBody.receiveShadow = true;
  saddleGroup.add(saddleBody);
  const saddleNose = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), leatherMat);
  saddleNose.scale.set(0.16, 0.045, 0.085);
  saddleNose.position.x = 0.2;
  saddleNose.castShadow = true;
  saddleGroup.add(saddleNose);
  const saddleRail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), chromeMat);
  saddleRail.rotation.z = PI / 2;
  saddleRail.position.y = -0.055;
  saddleGroup.add(saddleRail);
  [-0.11, 0.11].forEach((z) => {
    const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), chromeMat);
    rivet.position.set(-0.12, 0.055, z);
    saddleGroup.add(rivet);
  });
  bike.add(saddleGroup);

  // Stem and handlebars
  bike.add(meshBetween(V3(0.6, 1.14, 0), V3(0.69, 1.27, 0), 0.023, chromeMat, 7));
  const barPoints = [
    V3(0.59, 1.19, -0.34),
    V3(0.66, 1.25, -0.25),
    V3(0.71, 1.29, 0),
    V3(0.66, 1.25, 0.25),
    V3(0.59, 1.19, 0.34)
  ];
  const handlebar = tubeFromPoints(barPoints, 0.022, chromeMat, false, 32, 7);
  bike.add(handlebar);

  [-1, 1].forEach((side) => {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.16, 8), leatherMat);
    grip.position.set(0.59, 1.19, side * 0.33);
    grip.rotation.x = PI / 2;
    grip.rotation.z = side * 0.1;
    grip.castShadow = true;
    bike.add(grip);

    const barEnd = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), chromeMat);
    barEnd.position.set(0.59, 1.19, side * 0.415);
    barEnd.castShadow = true;
    bike.add(barEnd);
  });

  // Bell
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8, 0, TAU, 0, PI / 2), std({
    color: 0xe8b55e,
    metalness: 0.65,
    roughness: 0.3
  }));
  bell.position.set(0.67, 1.315, 0.17);
  bell.rotation.x = PI;
  bell.castShadow = true;
  bike.add(bell);
  const bellStem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.06, 4), chromeMat);
  bellStem.position.set(0.67, 1.285, 0.17);
  bike.add(bellStem);

  // Basket + picnic details
  const wickerTexture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#b78856";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(96,58,34,.5)";
    ctx.lineWidth = 5;
    for (let i = -h; i < w + h; i += 22) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + h, h);
      ctx.stroke();
      ctx.strokeStyle = "rgba(245,211,160,.34)";
      ctx.beginPath();
      ctx.moveTo(i + 8, 0);
      ctx.lineTo(i + 8 + h, h);
      ctx.stroke();
      ctx.strokeStyle = "rgba(96,58,34,.5)";
    }
    ctx.strokeStyle = "rgba(86,52,30,.45)";
    for (let y = 15; y < h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + 8);
      ctx.stroke();
    }
  });
  wickerTexture.wrapS = wickerTexture.wrapT = THREE.RepeatWrapping;
  wickerTexture.repeat.set(1.4, 1.4);
  const wickerMat = std({ map: wickerTexture, color: 0xffffff, roughness: 0.95 });

  const basket = new THREE.Group();
  basket.position.set(0.93, 1.05, 0);
  basket.rotation.z = -0.12;
  const basketBackWidth = 0.44;
  const basketDepth = 0.46;
  const basketHeight = 0.3;
  const wallThickness = 0.035;
  const frontWall = new THREE.Mesh(new THREE.BoxGeometry(0.03, basketHeight, basketDepth), wickerMat);
  frontWall.position.x = 0.19;
  const backWall = frontWall.clone();
  backWall.position.x = -0.19;
  const sideWallA = new THREE.Mesh(new THREE.BoxGeometry(0.41, basketHeight, 0.03), wickerMat);
  sideWallA.position.z = basketDepth / 2;
  const sideWallB = sideWallA.clone();
  sideWallB.position.z = -basketDepth / 2;
  const basketBottom = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.035, basketDepth), wickerMat);
  basketBottom.position.y = -basketHeight / 2;
  [frontWall, backWall, sideWallA, sideWallB, basketBottom].forEach((wall) => {
    wall.castShadow = true;
    wall.receiveShadow = true;
    basket.add(wall);
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.018, 4, 28), woodLightMat);
  rim.rotation.x = PI / 2;
  rim.scale.set(0.8, 1, 1);
  rim.position.y = basketHeight / 2;
  rim.castShadow = true;
  basket.add(rim);

  // A tiny fish tail and wildflowers in the basket
  const fishGroup = new THREE.Group();
  fishGroup.position.set(0.0, 0.15, 0.015);
  fishGroup.rotation.z = 0.06;
  const fishBody = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), std({ color: 0x9dbcb5, roughness: 0.42, metalness: 0.18 }));
  fishBody.scale.set(0.17, 0.055, 0.055);
  fishBody.position.x = 0.06;
  fishGroup.add(fishBody);
  const fishBelly = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), std({ color: 0xe7dfc8, roughness: 0.5 }));
  fishBelly.scale.set(0.12, 0.035, 0.04);
  fishBelly.position.set(0.09, -0.018, 0);
  fishGroup.add(fishBelly);
  const fishTail = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.19, 4), std({ color: 0xe0b399, roughness: 0.58 }));
  fishTail.position.x = -0.12;
  fishTail.rotation.z = PI / 2;
  fishTail.scale.z = 0.3;
  fishGroup.add(fishTail);
  const fishFin = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.13, 4), std({ color: 0xd99d7e, roughness: 0.6 }));
  fishFin.position.set(0.02, 0.06, 0);
  fishFin.rotation.z = 0.18;
  fishFin.scale.z = 0.25;
  fishGroup.add(fishFin);
  const fishEye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), std({ color: 0x25312c, roughness: 0.24 }));
  fishEye.position.set(0.16, 0.017, 0.047);
  fishGroup.add(fishEye);
  basket.add(fishGroup);
  fishBody.castShadow = true;
  fishBelly.castShadow = true;
  fishTail.castShadow = true;
  fishFin.castShadow = true;

  for (let i = 0; i < 2; i++) {
    const flower = new THREE.Group();
    const a = i * 1.6;
    flower.position.set(math.cos(a) * 0.12 - 0.02, 0.15, math.sin(a) * 0.14);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 4), std({ color: 0x6b875b, roughness: 0.9 }));
    stem.position.y = 0.1;
    flower.add(stem);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), std({ color: [0xf6e7ce, 0xed9c84, 0xf2ce85][i % 3], roughness: 0.8 }));
    head.position.y = 0.25;
    head.rotation.set(rand(0, 1), rand(0, 1), rand(0, 1));
    flower.add(head);
    basket.add(flower);
  }
  basket.position.y += 0.02;
  bike.add(basket);
  // Basket support
  const basketSupport = meshBetween(V3(0.78, 0.92, 0), V3(0.93, 0.95, 0), 0.014, chromeMat, 5);
  bike.add(basketSupport);

  // Front and rear lamps
  const headlamp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.1, 12), chromeMat);
  headlamp.rotation.z = PI / 2;
  headlamp.position.set(0.88, 0.9, 0);
  headlamp.castShadow = true;
  bike.add(headlamp);
  const headlampGlass = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), basic({ color: 0xffe0a1 }));
  headlampGlass.rotation.y = PI / 2;
  headlampGlass.position.set(0.935, 0.9, 0);
  bike.add(headlampGlass);

  const rearReflector = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.06), std({ color: 0xe1775c, emissive: 0x7f2418, emissiveIntensity: 0.3, roughness: 0.5 }));
  rearReflector.position.set(-0.81, 1.05, 0);
  bike.add(rearReflector);

  // Drivetrain
  const crankRadius = 0.17;
  const crankGroup = new THREE.Group();
  crankGroup.position.copy(bottomBracket);
  bike.add(crankGroup);

  const chainring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 5, 28), std({ color: 0xd5b276, metalness: 0.45, roughness: 0.4 }));
  chainring.position.z = 0.08;
  chainring.castShadow = true;
  crankGroup.add(chainring);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const arm = meshBetween(
      V3(0, 0, 0.08),
      V3(math.cos(a) * 0.13, math.sin(a) * 0.13, 0.08),
      0.012,
      chromeMat,
      4
    );
    crankGroup.add(arm);
  }
  const cog = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 18), chromeMat);
  cog.position.set(wheelCenters.rear.x, wheelCenters.rear.y, 0.08);
  bike.add(cog);
  const chainTop = meshBetween(
    V3(bottomBracket.x, bottomBracket.y + 0.13, 0.08),
    V3(wheelCenters.rear.x, wheelCenters.rear.y + 0.06, 0.08),
    0.009,
    std({ color: 0x4d5046, metalness: 0.4, roughness: 0.5 }),
    4
  );
  const chainBottom = meshBetween(
    V3(bottomBracket.x, bottomBracket.y - 0.12, 0.08),
    V3(wheelCenters.rear.x, wheelCenters.rear.y - 0.055, 0.08),
    0.009,
    std({ color: 0x4d5046, metalness: 0.4, roughness: 0.5 }),
    4
  );
  bike.add(chainTop, chainBottom);

  // Crank arms (pedal blocks themselves are positioned each frame)
  const crankArms = new THREE.Group();
  crankArms.position.copy(bottomBracket);
  bike.add(crankArms);
  const crankArmA = meshBetween(V3(0, 0, 0.12), V3(0, crankRadius, 0.12), 0.018, chromeMat, 5);
  const crankArmB = meshBetween(V3(0, 0, -0.1), V3(0, -crankRadius, -0.1), 0.018, chromeMat, 5);
  crankArms.add(crankArmA, crankArmB);

  const pedalA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.11), pedalMat);
  const pedalB = pedalA.clone();
  pedalA.castShadow = true;
  pedalB.castShadow = true;
  bike.add(pedalA, pedalB);


  /* ========================================================================
     The pelican — part cyclist, part seaside philosopher
     ====================================================================== */
  const featherMat = std({ color: 0xf5ecdf, roughness: 0.92 });
  const featherWarmMat = std({ color: 0xe9decd, roughness: 0.94 });
  const featherShadeMat = std({ color: 0xd8cbb9, roughness: 0.95 });
  const featherLeafMat = std({ color: 0xf5ecdf, roughness: 0.92, side: THREE.DoubleSide });
  const featherLeafShadeMat = std({ color: 0xded1bf, roughness: 0.95, side: THREE.DoubleSide });
  const featherTipMat = std({ color: 0x3c4642, roughness: 0.86, side: THREE.DoubleSide });
  const beakMat = std({ color: 0xe9a34e, roughness: 0.48 });
  const beakRidgeMat = std({ color: 0xf2bd70, roughness: 0.45 });
  const beakDarkMat = std({ color: 0xbe6d34, roughness: 0.55, side: THREE.DoubleSide });
  const pouchMat = std({ color: 0xf3b354, roughness: 0.4, side: THREE.DoubleSide });
  const pouchShadeMat = std({ color: 0xe09845, roughness: 0.48, side: THREE.DoubleSide });
  const eyeMat = std({ color: 0x1e2521, roughness: 0.2 });
  const eyeShineMat = basic({ color: 0xffffff });
  const cheekMat = std({ color: 0xecc0a5, roughness: 0.9 });
  const legMat = std({ color: 0xdd8b45, roughness: 0.72 });
  const legDarkMat = std({ color: 0xb86d37, roughness: 0.75 });
  const scarfMat = std({ color: 0xd95848, roughness: 0.82, side: THREE.DoubleSide });
  const scarfLightMat = std({ color: 0xf0bd72, roughness: 0.85, side: THREE.DoubleSide });

  const bird = new THREE.Group();
  leanGroup.add(bird);

  const bodyGroup = new THREE.Group();
  bird.add(bodyGroup);

  // A smooth, tapering tube built around a curve. It gives the neck and
  // wings a much nicer silhouette than a stack of cylinders.
  function taperedTube(points, startRadius, endRadius, material, tubularSegments = 28, radialSegments = 9) {
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
    const frames = curve.computeFrenetFrames(tubularSegments, false);
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      const center = curve.getPointAt(t);
      const radius = lerp(startRadius, endRadius, t * (0.55 + 0.45 * t));
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];
      for (let j = 0; j <= radialSegments; j++) {
        const a = (j / radialSegments) * TAU;
        positions.push(
          center.x + (normal.x * math.cos(a) + binormal.x * math.sin(a)) * radius,
          center.y + (normal.y * math.cos(a) + binormal.y * math.sin(a)) * radius,
          center.z + (normal.z * math.cos(a) + binormal.z * math.sin(a)) * radius
        );
        uvs.push(t, j / radialSegments);
      }
    }
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * (radialSegments + 1) + j;
        const b = a + radialSegments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // Flat, rounded feathers keep the wing silhouette soft even though the
  // whole bird is built from low-poly primitives.
  function flatFeather(length, width, material, tipMaterial, tipRatio = 0.2) {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.bezierCurveTo(width * 0.9, length * 0.12, width * 1.04, length * 0.64, 0, length);
    shape.bezierCurveTo(-width * 1.04, length * 0.64, -width * 0.9, length * 0.12, 0, 0);
    const feather = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), material);
    feather.castShadow = true;
    feather.receiveShadow = true;
    group.add(feather);

    if (tipMaterial) {
      const tipStart = length * (1 - tipRatio);
      const tipShape = new THREE.Shape();
      tipShape.moveTo(0, tipStart);
      tipShape.bezierCurveTo(width * 0.42, length * 0.84, width * 0.28, length * 0.96, 0, length);
      tipShape.bezierCurveTo(-width * 0.28, length * 0.96, -width * 0.42, length * 0.84, 0, tipStart);
      const tip = new THREE.Mesh(new THREE.ShapeGeometry(tipShape, 7), tipMaterial);
      tip.position.z = 0.003;
      tip.castShadow = true;
      group.add(tip);
    }

    return group;
  }

  function billGeometry(length, segments = 22, radial = 10) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = t * length;
      const centerY = 0.014 - 0.045 * t * t;
      const halfHeight = 0.042 * (1 - 0.58 * t) + 0.002;
      const halfWidth = 0.11 * (1 - 0.7 * t) + 0.008;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU;
        positions.push(x, centerY + math.sin(a) * halfHeight, math.cos(a) * halfWidth);
        uvs.push(t, j / radial);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function pouchGeometry(length, segments = 24, radial = 13) {
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = 0.07 + t * length;
      const envelope = math.sin(PI * clamp(0.12 + 0.84 * t, 0, 1)) * (1 - 0.16 * t);
      const halfHeight = 0.016 + 0.113 * envelope;
      const halfWidth = 0.024 + 0.084 * envelope;
      const attachY = -0.03 - 0.018 * t;
      const cy = attachY - halfHeight;
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * TAU;
        positions.push(x, cy + math.sin(a) * halfHeight, math.cos(a) * halfWidth);
        uvs.push(t, j / radial);
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /* ---- Body ------------------------------------------------------------- */
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 26), featherMat);
  body.scale.set(0.44, 0.38, 0.30);
  body.position.set(-0.13, 1.65, 0);
  body.rotation.z = -0.075;
  body.castShadow = true;
  body.receiveShadow = true;
  bodyGroup.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), featherMat);
  chest.scale.set(0.29, 0.33, 0.265);
  chest.position.set(0.12, 1.56, 0);
  chest.castShadow = true;
  chest.receiveShadow = true;
  bodyGroup.add(chest);

  const rump = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), featherWarmMat);
  rump.scale.set(0.25, 0.27, 0.25);
  rump.position.set(-0.43, 1.58, 0);
  rump.castShadow = true;
  rump.receiveShadow = true;
  bodyGroup.add(rump);

  /* ---- Neck & head ------------------------------------------------------ */
  const neck = taperedTube([
    V3(0.015, 1.67, 0.015),
    V3(0.14, 1.72, 0.035),
    V3(0.24, 1.83, 0.03),
    V3(0.275, 1.96, 0.015),
    V3(0.27, 2.07, 0),
    V3(0.35, 2.17, 0)
  ], 0.126, 0.085, featherMat, 30, 10);
  bodyGroup.add(neck);

  const ruff = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), featherWarmMat);
  ruff.scale.set(0.2, 0.125, 0.17);
  ruff.position.set(0.1, 1.69, 0.01);
  ruff.rotation.z = 0.22;
  ruff.castShadow = true;
  ruff.receiveShadow = true;
  bodyGroup.add(ruff);

  const headGroup = new THREE.Group();
  headGroup.position.set(0.39, 2.22, 0);
  headGroup.rotation.order = "YXZ";
  headGroup.rotation.y = -0.11;
  headGroup.rotation.z = -0.055;
  bodyGroup.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 22), featherMat);
  head.scale.set(0.205, 0.19, 0.17);
  head.castShadow = true;
  head.receiveShadow = true;
  headGroup.add(head);

  // Friendly feather tuft at the back of the head
  const crest = new THREE.Group();
  crest.position.set(-0.09, 0.055, 0);
  [-1, 0, 1].forEach((side, i) => {
    const tuft = flatFeather(0.25 - math.abs(side) * 0.04, 0.038, featherWarmMat, null);
    tuft.position.set(0, 0.02, side * 0.05);
    tuft.rotation.z = 1.18 - math.abs(side) * 0.12;
    tuft.rotation.x = side * 0.16;
    crest.add(tuft);
  });
  headGroup.add(crest);

  // Eyes, bigger and kinder than before
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.041, 14, 12), eyeMat);
    eye.position.set(0.074, 0.034, side * 0.148);
    eye.castShadow = true;
    headGroup.add(eye);

    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), eyeShineMat);
    shine.position.set(0.088, 0.052, side * 0.184);
    headGroup.add(shine);

    // A tiny, gentle cheek flush
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cheekMat);
    cheek.scale.set(0.065, 0.032, 0.018);
    cheek.position.set(0.014, -0.026, side * 0.157);
    cheek.rotation.x = side * 0.32;
    headGroup.add(cheek);
  });

  /* ---- The grand bill --------------------------------------------------- */
  const beakGroup = new THREE.Group();
  beakGroup.position.set(0.115, -0.005, 0);
  beakGroup.rotation.z = -0.07;
  headGroup.add(beakGroup);

  const upperBill = new THREE.Mesh(billGeometry(0.75), beakMat);
  upperBill.castShadow = true;
  upperBill.receiveShadow = true;
  beakGroup.add(upperBill);

  const billTip = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 9), beakDarkMat);
  billTip.scale.set(0.062, 0.026, 0.038);
  billTip.position.set(0.735, -0.025, 0);
  billTip.castShadow = true;
  beakGroup.add(billTip);

  const billHook = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.075, 6), beakDarkMat);
  billHook.position.set(0.75, -0.06, 0);
  billHook.rotation.z = -2.62;
  billHook.castShadow = true;
  beakGroup.add(billHook);

  const pouch = new THREE.Mesh(pouchGeometry(0.59), pouchMat);
  pouch.castShadow = true;
  pouch.receiveShadow = true;
  beakGroup.add(pouch);

  const mouthSeam = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    V3(0.06, -0.002, 0.106),
    V3(0.29, -0.027, 0.094),
    V3(0.56, -0.055, 0.058),
    V3(0.73, -0.06, 0.025)
  ]), 20, 0.006, 4, false), beakDarkMat);
  mouthSeam.castShadow = false;
  beakGroup.add(mouthSeam);

  [-1, 1].forEach((side) => {
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), beakDarkMat);
    nostril.scale.set(0.022, 0.006, 0.006);
    nostril.position.set(0.2, 0.045, side * 0.081);
    nostril.castShadow = false;
    beakGroup.add(nostril);
  });

  /* ---- Tail feathers ---------------------------------------------------- */
  const tailGroup = new THREE.Group();
  tailGroup.position.set(-0.46, 1.6, 0);
  [-1, 0, 1].forEach((side, i) => {
    const feather = flatFeather(
      0.46 + (side === 0 ? 0.06 : 0),
      0.072,
      side === 0 ? featherLeafMat : featherLeafShadeMat,
      featherTipMat,
      0.18
    );
    feather.position.set(-0.02, -0.02 + (side === 0 ? 0.018 : 0), side * 0.035);
    feather.rotation.z = 1.24 + side * 0.13;
    feather.rotation.x = side * 0.12;
    tailGroup.add(feather);
  });
  bodyGroup.add(tailGroup);

  /* ---- Wings reaching for the handlebars ------------------------------- */
  function buildWing(side) {
    const wing = new THREE.Group();

    const shoulder = V3(0.035, 1.755, side * 0.288);
    wing.position.copy(shoulder);
    wing.rotation.y = -side * 0.055;
    wing.rotation.x = side * 0.025;

    // A single, clean flipper-like silhouette instead of a chain of blobs.
    const shape = new THREE.Shape();
    shape.moveTo(0.01, 0.035);
    shape.bezierCurveTo(0.15, 0.08, 0.36, -0.08, 0.51, -0.4);
    shape.quadraticCurveTo(0.575, -0.53, 0.51, -0.565);
    shape.quadraticCurveTo(0.395, -0.5, 0.33, -0.45);
    shape.quadraticCurveTo(0.345, -0.36, 0.245, -0.325);
    shape.quadraticCurveTo(0.265, -0.225, 0.135, -0.205);
    shape.quadraticCurveTo(0.115, -0.085, -0.02, -0.045);
    shape.quadraticCurveTo(-0.04, 0.0, 0.01, 0.035);
    shape.closePath();

    const wingGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.018,
      bevelSegments: 3,
      curveSegments: 18,
      steps: 1
    });
    wingGeometry.translate(0, 0, -0.0275);
    const wingMesh = new THREE.Mesh(wingGeometry, featherLeafShadeMat);
    wingMesh.castShadow = true;
    wingMesh.receiveShadow = true;
    wing.add(wingMesh);

    // A warm shoulder covert hides the seam where the wing meets the body.
    const shoulderCover = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), featherShadeMat);
    shoulderCover.scale.set(0.115, 0.085, 0.055);
    shoulderCover.position.set(0.035, 0.015, side * 0.022);
    shoulderCover.rotation.z = -0.18;
    shoulderCover.castShadow = true;
    wing.add(shoulderCover);

    // Two soft primary feathers give the wing a feathered trailing edge.
    const featherA = flatFeather(0.32, 0.055, featherLeafShadeMat, featherTipMat, 0.2);
    featherA.position.set(0.12, -0.16, side * 0.028);
    featherA.rotation.z = 2.42;
    featherA.rotation.x = side * 0.04;
    wing.add(featherA);

    const featherB = flatFeather(0.25, 0.047, featherLeafMat, featherTipMat, 0.18);
    featherB.position.set(0.25, -0.27, side * 0.033);
    featherB.rotation.z = 2.3;
    featherB.rotation.x = side * 0.05;
    wing.add(featherB);

    // The wing tip rests on the grip. A few broad feather fingers curl over it.
    const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 15, 11), featherWarmMat);
    hand.scale.set(0.062, 0.052, 0.05);
    hand.position.set(0.535, -0.545, side * 0.015);
    hand.castShadow = true;
    wing.add(hand);

    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.08, 3, 6), i < 2 ? featherTipMat : featherWarmMat);
      finger.position.set(0.55 + i * 0.014, -0.57 - i * 0.01, side * 0.022);
      finger.rotation.z = 0.85 + i * 0.14;
      finger.rotation.x = side * 0.2;
      finger.castShadow = true;
      wing.add(finger);
    }

    bird.add(wing);
    return wing;
  }
  buildWing(1);
  buildWing(-1);

  /* ---- Scarf ------------------------------------------------------------ */
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.033, 7, 24), scarfMat);
  collar.rotation.x = PI / 2;
  collar.rotation.z = 0.18;
  collar.position.set(0.235, 1.805, 0.005);
  collar.castShadow = true;
  bodyGroup.add(collar);

  const collarSecond = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.026, 7, 24), scarfLightMat);
  collarSecond.rotation.x = PI / 2;
  collarSecond.rotation.z = 0.12;
  collarSecond.position.set(0.25, 1.77, 0.01);
  collarSecond.castShadow = true;
  bodyGroup.add(collarSecond);

  const scarfKnot = new THREE.Mesh(new THREE.SphereGeometry(0.068, 12, 9), scarfMat);
  scarfKnot.position.set(0.145, 1.785, 0.115);
  scarfKnot.castShadow = true;
  bodyGroup.add(scarfKnot);

  function createScarfRibbon(start, phase, width, mat, outBias, lift, droop) {
    const segments = 11;
    const positions = new Float32Array(segments * 2 * 3);
    const uvs = new Float32Array(segments * 2 * 2);
    const indices = [];
    for (let i = 0; i < segments; i++) {
      uvs[i * 4] = i / (segments - 1);
      uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = i / (segments - 1);
      uvs[i * 4 + 3] = 1;
      if (i < segments - 1) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    bodyGroup.add(mesh);
    return { mesh, positions, start, phase, width, segments, outBias, lift, droop };
  }

  const ribbons = [
    createScarfRibbon(V3(0.12, 1.82, 0.11), 0, 0.12, scarfMat, 0.38, 0.1, 0.045)
  ];

  /* ---- Legs and webbed feet --------------------------------------------- */
  const legParts = [];
  function createFoot(side) {
    const foot = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), legMat);
    sole.scale.set(0.108, 0.035, 0.078);
    sole.position.set(0.035, -0.018, 0);
    sole.castShadow = true;
    foot.add(sole);

    const toes = [
      [0.245, 0],
      [0.2, 0.095],
      [0.2, -0.095]
    ];
    toes.forEach(([x, z]) => {
      const toe = capsuleBetween(V3(0.03, 0, 0), V3(x, -0.015, z), 0.019, legMat, foot, 3, 6);
      toe.castShadow = true;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.045, 4), legDarkMat);
      claw.position.set(x + 0.014, -0.015, z);
      claw.rotation.z = -PI / 2;
      claw.castShadow = true;
      foot.add(claw);
    });

    const webGeo = new THREE.BufferGeometry();
    webGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      0.035, -0.026, 0,
      0.185, -0.026, 0.085,
      0.185, -0.026, -0.085
    ], 3));
    webGeo.computeVertexNormals();
    const web = new THREE.Mesh(webGeo, std({ color: 0xd98245, roughness: 0.8, side: THREE.DoubleSide }));
    web.castShadow = true;
    foot.add(web);
    bird.add(foot);
    return foot;
  }

  function createLeg(side) {
    const hip = V3(-0.15, 1.37, side * 0.18);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.86, 1, 8), featherWarmMat);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1, 7), legMat);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), featherWarmMat);
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), legMat);
    upper.castShadow = true;
    upper.receiveShadow = true;
    lower.castShadow = true;
    lower.receiveShadow = true;
    knee.castShadow = true;
    ankle.castShadow = true;
    bird.add(upper, lower, knee, ankle);

    // A fuzzy cuff where the leg disappears into the body
    const cuff = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), featherWarmMat);
    cuff.scale.set(0.085, 0.065, 0.085);
    cuff.position.copy(hip);
    cuff.castShadow = true;
    bird.add(cuff);

    const foot = createFoot(side);
    legParts.push({ side, hip, upper, lower, knee, ankle, cuff, foot, L1: 0.5, L2: 0.53 });
  }
  createLeg(1);
  createLeg(-1);

  function updateSegment(mesh, a, b, radius) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
    mesh.scale.set(radius, len, radius);
  }

  const tempBend = V3(1, 0, 0);
  function solveLeg(leg, target) {
    const toTarget = target.clone().sub(leg.hip);
    const distance = toTarget.length();
    const maxReach = leg.L1 + leg.L2 - 0.004;
    const minReach = Math.abs(leg.L1 - leg.L2) + 0.004;
    if (distance > maxReach) {
      toTarget.multiplyScalar(maxReach / distance);
    } else if (distance < minReach) {
      toTarget.multiplyScalar(minReach / math.max(distance, 0.0001));
    }
    const reach = clamp(toTarget.length(), minReach, maxReach);
    const direction = toTarget.clone().normalize();
    const along = (leg.L1 * leg.L1 - leg.L2 * leg.L2 + reach * reach) / (2 * reach);
    const height = math.sqrt(math.max(0, leg.L1 * leg.L1 - along * along));

    tempBend.set(1, 0, 0);
    tempBend.sub(direction.clone().multiplyScalar(tempBend.dot(direction)));
    if (tempBend.lengthSq() < 0.001) tempBend.set(0, 0, 1);
    tempBend.normalize();

    const kneePosition = leg.hip.clone().addScaledVector(direction, along).addScaledVector(tempBend, height);
    const footPosition = leg.hip.clone().add(toTarget);
    updateSegment(leg.upper, leg.hip.clone().add(V3(0, 0.015, 0)), kneePosition, 0.065);
    updateSegment(leg.lower, kneePosition, footPosition, 0.036);
    leg.knee.position.copy(kneePosition);
    leg.ankle.position.copy(footPosition);
    leg.foot.position.copy(footPosition);
    leg.foot.rotation.set(0, 0, 0);
    return footPosition;
  }

  /* ========================================================================
     Rider animation state + camera controls
     ====================================================================== */
  const rider = {
    angle: 0.18,
    distance: 0,
    speed: reduceMotion ? 1.15 : 1.9,
    paused: false
  };

  const view = {
    yawOffset: 0.28,
    pitch: 0.12,
    distance: 9.3,
    lastInteraction: -10000,
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    defaultYaw: 0.28,
    defaultPitch: 0.12,
    defaultDistance: 9.3
  };

  const smoothTarget = V3(0, 1.4, RIDER_RADIUS);
  const cameraPositionTarget = V3();
  let cameraInitialized = false;
  let elapsed = 0;
  let wheelSpin = 0;
  let lastUiUpdate = -1;

  function frameCamera(dt, force = false) {
    const baseYaw = rider.angle + view.yawOffset;
    const idleTime = (performance.now() - view.lastInteraction) / 1000;
    const idleBlend = reduceMotion ? 0 : THREE.MathUtils.smoothstep(clamp((idleTime - 3.5) / 2.5, 0, 1), 0, 1);
    const sway = math.sin(elapsed * 0.13) * 0.085 * idleBlend;
    const lift = math.sin(elapsed * 0.077 + 0.9) * 0.012 * idleBlend;
    const yaw = baseYaw + sway;

    const aspect = camera.aspect;
    const distance = view.distance * (aspect < 1 ? 1 + (1 - aspect) * 0.82 : 1);
    const pitch = clamp(view.pitch + lift, 0.065, 0.94);

    const riderX = math.sin(rider.angle) * RIDER_RADIUS;
    const riderZ = math.cos(rider.angle) * RIDER_RADIUS;

    const target = V3(
      riderX,
      1.42 + math.sin(elapsed * 3.1) * 0.006,
      riderZ
    );

    if (!cameraInitialized || force) {
      smoothTarget.copy(target);
      cameraInitialized = true;
    } else {
      const targetLerp = 1 - math.exp(-7.0 * dt);
      smoothTarget.lerp(target, targetLerp);
    }

    const horizontal = math.cos(pitch) * distance;
    cameraPositionTarget.set(
      smoothTarget.x + math.sin(yaw) * horizontal,
      smoothTarget.y + math.sin(pitch) * distance + 0.08,
      smoothTarget.z + math.cos(yaw) * horizontal
    );

    if (force) {
      camera.position.copy(cameraPositionTarget);
    } else {
      const camLerp = 1 - math.exp(-4.2 * dt);
      camera.position.lerp(cameraPositionTarget, camLerp);
    }

    camera.lookAt(smoothTarget.x, smoothTarget.y + 0.04, smoothTarget.z);
  }

  function resetView() {
    view.yawOffset = view.defaultYaw;
    view.pitch = view.defaultPitch;
    view.distance = view.defaultDistance;
    view.lastInteraction = performance.now();
  }

  function togglePause() {
    rider.paused = !rider.paused;
    experience.classList.toggle("is-paused", rider.paused);
    playButton.setAttribute("aria-pressed", String(rider.paused));
    playButton.setAttribute("aria-label", rider.paused ? "继续骑行" : "暂停骑行");
  }

  playButton.addEventListener("click", togglePause);
  resetButton.addEventListener("click", resetView);

  canvas.addEventListener("pointerdown", (event) => {
    view.dragging = true;
    view.pointerId = event.pointerId;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    view.lastInteraction = performance.now();
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!view.dragging || event.pointerId !== view.pointerId) return;
    const dx = event.clientX - view.lastX;
    const dy = event.clientY - view.lastY;
    view.lastX = event.clientX;
    view.lastY = event.clientY;
    view.yawOffset -= dx * 0.0046;
    view.pitch = clamp(view.pitch - dy * 0.0035, 0.065, 0.94);
    view.lastInteraction = performance.now();
  });

  function releasePointer(event) {
    if (event && view.pointerId !== null && event.pointerId !== view.pointerId) return;
    view.dragging = false;
    view.pointerId = null;
    canvas.classList.remove("is-dragging");
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = math.exp(clamp(event.deltaY, -120, 120) * 0.00115);
    view.distance = clamp(view.distance * factor, 4.4, 16);
    view.lastInteraction = performance.now();
  }, { passive: false });

  canvas.addEventListener("dblclick", resetView);

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    } else if (event.key === "r" || event.key === "R") {
      resetView();
    }
  });

  /* ========================================================================
     Per-frame character update
     ====================================================================== */
  function updateBikeAndBird(dt, time) {
    const bikeLean = -0.077;
    riderRoot.position.set(
      math.sin(rider.angle) * RIDER_RADIUS,
      0.09,
      math.cos(rider.angle) * RIDER_RADIUS
    );
    riderRoot.rotation.y = rider.angle;
    leanGroup.rotation.x = bikeLean;

    const bump = math.sin(rider.distance * 4.8) * 0.007 + math.sin(time * 2.2) * 0.003;
    bike.position.y = bump;

    const wheelAngle = -rider.distance / 0.545;
    rearWheel.rotation.z = wheelAngle;
    frontWheel.rotation.z = wheelAngle;

    const pedalPhase = -1.15 - rider.distance * 1.72;
    crankArms.rotation.z = pedalPhase;
    crankGroup.rotation.z = pedalPhase;

    const pedalAX = bottomBracket.x - math.sin(pedalPhase) * crankRadius;
    const pedalAY = bottomBracket.y + math.cos(pedalPhase) * crankRadius;
    const pedalBX = bottomBracket.x + math.sin(pedalPhase) * crankRadius;
    const pedalBY = bottomBracket.y - math.cos(pedalPhase) * crankRadius;

    const pedalZ = 0.3;
    pedalA.position.set(pedalAX, pedalAY, pedalZ);
    pedalB.position.set(pedalBX, pedalBY, -pedalZ);
    pedalA.rotation.z = 0;
    pedalB.rotation.z = 0;

    const rightTarget = V3(pedalAX, pedalAY + 0.055, pedalZ);
    const leftTarget = V3(pedalBX, pedalBY + 0.055, -pedalZ);
    legParts.forEach((leg) => {
      solveLeg(leg, leg.side === 1 ? rightTarget : leftTarget);
    });

    const bodyBob = math.sin(pedalPhase * 2) * 0.007 + math.sin(time * 1.1) * 0.005;
    bodyGroup.position.y = bodyBob;
    bodyGroup.position.x = math.sin(time * 0.42) * 0.008;
    headGroup.rotation.z = -0.06 + math.sin(time * 0.8 + 0.4) * 0.026 + math.sin(pedalPhase * 2) * 0.012;
    headGroup.rotation.y = math.sin(time * 0.47) * 0.09 + math.sin(time * 1.2) * 0.018;

    // The tail and feather fans have a little bit of life.
    tailGroup.rotation.z = 0.22 + math.sin(time * 1.3) * 0.025;
    tailGroup.rotation.x = math.sin(time * 0.6) * 0.02;

    // Sweet, fluttering scarf ribbons.
    ribbons.forEach((ribbon, index) => {
      const { positions, start, phase, width, segments, mesh, outBias, lift, droop } = ribbon;
      for (let i = 0; i < segments; i++) {
        const t = i / (segments - 1);
        const flutter = math.sin(time * 4.8 + phase + t * 5.2) * (0.018 + t * 0.05);
        const wave = math.sin(time * 2.8 + phase + t * 3.1) * 0.07 * t;
        const cx = start.x - t * 0.98 - t * t * 0.08;
        const cy = start.y + math.sin(t * PI) * lift - t * droop + math.sin(t * 2.2 + phase) * 0.028 + flutter;
        const cz = start.z + t * outBias + wave + waveformZ(t, index, time);
        const w = width * (1 - t * 0.92);
        const idx = i * 6;
        positions[idx] = cx;
        positions[idx + 1] = cy + w * 0.5;
        positions[idx + 2] = cz;
        positions[idx + 3] = cx;
        positions[idx + 4] = cy - w * 0.5;
        positions[idx + 5] = cz + 0.012;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    });

    // Belt-and-braces contact shadow, subtle but grounding
    if (riderShadow) {
      const s = 0.92 + math.sin(time * 2.2) * 0.02;
      riderShadow.scale.set(s, s, s);
      riderShadow.material.opacity = 0.11 + math.sin(time * 2) * 0.01;
    }
  }

  function waveformZ(t, index, time) {
    return 0.045 * t * math.sin(time * 2.6 + index * 2.2 + t * 4.2);
  }

  // Grounding shadow disc
  const contactShadowTexture = radialTexture([
    [0, "rgba(38,43,31,.4)"],
    [0.45, "rgba(38,43,31,.2)"],
    [1, "rgba(38,43,31,0)"]
  ]);
  const riderShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 1.25),
    new THREE.MeshBasicMaterial({
      map: contactShadowTexture,
      transparent: true,
      depthWrite: false,
      opacity: 0.17
    })
  );
  riderShadow.rotation.x = -PI / 2;
  riderShadow.position.y = 0.012;
  riderShadow.renderOrder = 2;
  riderRoot.add(riderShadow);

  /* ========================================================================
     UI state + loop
     ====================================================================== */
  function updateUi() {
    const circumference = TAU * RIDER_RADIUS;
    const traveled = rider.distance;
    const lap = math.floor(traveled / circumference) + 1;
    const progress = (traveled % circumference) / circumference;
    const percent = `${progress * 100}%`;
    const lapLabel = String(lap).padStart(2, "0");
    if (lapLabel !== lapNumberEl.textContent) lapNumberEl.textContent = lapLabel;
    progressFillEl.style.width = percent;
    progressPelicanEl.style.left = percent;
  }

  function animate(timeMs) {
    const dt = math.min(clock.getDelta(), 0.05);
    if (!rider.paused) {
      elapsed += dt;
      rider.distance += rider.speed * dt;
      rider.angle += (rider.speed * dt) / RIDER_RADIUS;
    } else {
      elapsed += dt;
    }

    updateBikeAndBird(dt, elapsed);
    frameCamera(dt);

    // Environment motion
    seaUniforms.uTime.value = elapsed;
    const skyTime = elapsed;
    clouds.forEach((cloud) => {
      cloud.position.x = cloud.userData.baseX + math.sin(skyTime * 0.022 + cloud.userData.phase) * 2.4;
      cloud.position.y += math.sin(skyTime * 0.085 + cloud.userData.phase) * 0.0015;
    });

    swaying.forEach((plant, index) => {
      const canopy = plant.userData.canopy || plant;
      const sway = plant.userData.sway || 0.01;
      const phase = plant.userData.phase || 0;
      if (canopy) {
        canopy.rotation.z = math.sin(skyTime * 0.55 + phase) * sway;
        canopy.rotation.x = math.cos(skyTime * 0.44 + phase * 1.2) * sway * 0.55;
      }
    });

    boats.forEach((boat) => {
      boat.position.y = -1.49 + math.sin(skyTime * 0.7 + boat.userData.phase) * 0.035;
      boat.rotation.z = math.sin(skyTime * 0.53 + boat.userData.phase) * 0.035;
    });

    fireflies.rotation.y = skyTime * 0.004;
    const fireflyArray = fireflyGeo.attributes.position.array;
    for (let i = 0; i < fireflyCount; i++) {
      const f = fireflyData[i];
      fireflyArray[i * 3] = f.x + math.sin(skyTime * f.speed + f.phase) * 0.35;
      fireflyArray[i * 3 + 1] = f.y + math.sin(skyTime * f.speed * 1.3 + f.phase) * 0.18;
      fireflyArray[i * 3 + 2] = f.z + math.cos(skyTime * f.speed * 0.8 + f.phase) * 0.33;
    }
    fireflyGeo.attributes.position.needsUpdate = true;
    fireflyMat.opacity = 0.45 + math.sin(skyTime * 0.9) * 0.1;

    butterflies.forEach((butterfly, index) => {
      const phase = butterfly.userData.phase;
      const radius = butterfly.userData.radius;
      const speed = butterfly.userData.speed;
      const angle = skyTime * speed + phase;
      butterfly.position.set(
        math.sin(angle) * radius,
        butterfly.userData.height + math.sin(skyTime * 1.3 + index) * 0.18,
        math.cos(angle) * radius
      );
      butterfly.rotation.y = -angle + PI / 2;
      butterfly.rotation.z = math.sin(angle * 2 + phase) * 0.1;
      const flap = math.sin(skyTime * 14 + phase) * 0.65;
      butterfly.userData.pivotA.rotation.z = 0.08 + flap;
      butterfly.userData.pivotB.rotation.z = -0.08 - flap;
    });

    lanternGlow.material.opacity = 0.46 + math.sin(skyTime * 1.6) * 0.06;
    lighthouseLight.intensity = 7.5 + math.sin(skyTime * 1.6) * 1.2;
    if (lamps) {
      lamps.forEach((lamp) => {
        const glow = lamp.userData.glow;
        if (glow) glow.material.opacity = 0.4 + math.sin(skyTime * 1.1 + lamp.userData.phase) * 0.06;
      });
    }
    warmBounce.intensity = 1.6 + math.sin(skyTime * 0.8) * 0.15;

    if (skyTime - lastUiUpdate > 0.12) {
      updateUi();
      lastUiUpdate = skyTime;
    }

    renderer.render(scene, camera);

    fpsStats.frames++;
    const now = performance.now();
    if (now - fpsStats.time > 1000) {
      fpsStats.fps = math.round((fpsStats.frames * 1000) / (now - fpsStats.time));
      fpsStats.frames = 0;
      fpsStats.time = now;
    }
  }

  /* ========================================================================
     Resize + boot
     ====================================================================== */
  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(previewMode ? 1 : math.min(window.devicePixelRatio || 1, window.matchMedia("(max-width: 720px)").matches ? 1.6 : 2));
    renderer.setSize(width, height, false);
  }

  window.addEventListener("resize", resize);

  const clock = new THREE.Clock();
  const fpsStats = { fps: 0, frames: 0, time: performance.now() };
  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    updateBikeAndBird(0, 0);
    frameCamera(0, true);
    updateUi();
    camera.lookAt(smoothTarget);
    renderer.render(scene, camera);
    if (!stillMode) renderer.setAnimationLoop(animate);

    const fontReady = document.fonts && document.fonts.ready
      ? document.fonts.ready
      : Promise.resolve();
    const reveal = () => {
      document.body.classList.add("is-ready");
      window.setTimeout(() => loader.classList.add("is-done"), 260);
    };
    Promise.race([fontReady, new Promise((resolve) => setTimeout(resolve, 1200))])
      .then(() => window.setTimeout(reveal, 220));
  }

  // Let the first paint show the cream loader, then build the world.
  requestAnimationFrame(() => {
    requestAnimationFrame(boot);
  });

  // Expose a tiny handle for curious minds and automated previews.
  window.__PELICAN_POINT__ = {
    renderer,
    scene,
    camera,
    rider,
    view,
    sunDirection,
    bird,
    bike,
    bodyGroup,
    headGroup,
    tailGroup,
    ribbons,
    legParts,
    getFps: () => fpsStats.fps,
    renderStill: (dt = 0) => {
      updateBikeAndBird(dt, elapsed);
      frameCamera(0, true);
      renderer.render(scene, camera);
    },
    projectSun: () => {
      const p = camera.position.clone().addScaledVector(sunDirection, 210).project(camera);
      return {
        x: (p.x * 0.5 + 0.5) * window.innerWidth,
        y: (-p.y * 0.5 + 0.5) * window.innerHeight,
        z: p.z,
        ndc: [p.x, p.y, p.z]
      };
    }
  };

  // Pause the render loop gracefully when the page is hidden.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clock.stop();
    } else {
      clock.start();
    }
  });
})();
