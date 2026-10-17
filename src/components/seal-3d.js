// O selo 3D do site aprovado, sem mudanças: as 24 sementes crescem uma depois da outra em volta do
// círculo, o miolo pousa com um pequeno quique, depois gira devagar, acompanha a rolagem e se inclina
// para o ponteiro. Carregado só em telas grandes, depois do título (src/pages/site.js); o
// desenho plano da página fica como reserva.
import * as THREE from "three";

const mountedSeals = new WeakMap();
const TAU = Math.PI * 2;

const SEED_COUNT = 24;
const RING_RADIUS = 37;
const SEED_LENGTH = 11;
const SEED_WIDTH = 7.7;
const CORE_RADIUS = 6;
const FLOOR_Z = -8;

const EXTRUDE_OPTIONS = {
  depth: 1.6,
  steps: 1,
  bevelEnabled: true,
  bevelThickness: 1.4,
  bevelSize: 1.1,
  bevelSegments: 8,
  curveSegments: 32,
};

// eslint-disable-next-line no-unused-vars -- mantido como no site aprovado
const HALF_THICKNESS =
  EXTRUDE_OPTIONS.depth / 2 + EXTRUDE_OPTIONS.bevelThickness;

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const smoothstep = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const finite = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function easeOutBack(t) {
  const u = t - 1;
  return 1 + 2.05 * u * u * u + 1.05 * u * u;
}

function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCeramicTexture(doc, random) {
  const size = 256;
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Não foi possível criar a textura procedural.");
  }

  const layers = [
    { cells: 8, weight: 0.5 },
    { cells: 32, weight: 0.32 },
    { cells: 128, weight: 0.18 },
  ].map(({ cells, weight }) => ({
    cells,
    weight,
    values: Float32Array.from({ length: cells * cells }, random),
  }));

  const pixels = context.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let noise = 0;

      for (const { cells, weight, values } of layers) {
        const gx = (x / size) * cells;
        const gy = (y / size) * cells;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = smoothstep(gx - ix);
        const fy = smoothstep(gy - iy);

        const x0 = ix % cells;
        const x1 = (ix + 1) % cells;
        const y0 = iy % cells;
        const y1 = (iy + 1) % cells;

        const a = THREE.MathUtils.lerp(
          values[y0 * cells + x0],
          values[y0 * cells + x1],
          fx
        );
        const b = THREE.MathUtils.lerp(
          values[y1 * cells + x0],
          values[y1 * cells + x1],
          fx
        );

        noise += THREE.MathUtils.lerp(a, b, fy) * weight;
      }

      const value = Math.round(219 + (noise - 0.5) * 36);
      const offset = (y * size + x) * 4;

      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
  }

  context.putImageData(pixels, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return texture;
}

/**
 * Suaviza vértices coincidentes da ExtrudeGeometry sem alterar suas UVs.
 * computeVertexNormals() sozinho não suaviza uma geometria não indexada.
 */
function smoothExtrusionNormals(geometry) {
  const positions = geometry.getAttribute("position");
  const groups = new Map();
  const vertexGroups = new Array(positions.count);

  for (let i = 0; i < positions.count; i++) {
    const key =
      `${Math.round(positions.getX(i) * 1e5)},` +
      `${Math.round(positions.getY(i) * 1e5)},` +
      `${Math.round(positions.getZ(i) * 1e5)}`;

    let group = groups.get(key);

    if (!group) {
      group = new THREE.Vector3();
      groups.set(key, group);
    }

    vertexGroups[i] = group;
  }

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();

  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i);
    b.fromBufferAttribute(positions, i + 1);
    c.fromBufferAttribute(positions, i + 2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    faceNormal.crossVectors(ab, ac);

    vertexGroups[i].add(faceNormal);
    vertexGroups[i + 1].add(faceNormal);
    vertexGroups[i + 2].add(faceNormal);
  }

  for (const normal of groups.values()) normal.normalize();

  const normals = new Float32Array(positions.count * 3);

  for (let i = 0; i < positions.count; i++) {
    const normal = vertexGroups[i];
    normals[i * 3] = normal.x;
    normals[i * 3 + 1] = normal.y;
    normals[i * 3 + 2] = normal.z;
  }

  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const uv = geometry.getAttribute("uv");

  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * 0.12, uv.getY(i) * 0.12);
    }
    uv.needsUpdate = true;
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

function createGrainGeometry(random) {
  const noise = () => (random() - 0.5) * 0.5;
  const bevel = EXTRUDE_OPTIONS.bevelSize;

  // Compensa a expansão lateral do bevel antes de desenhar o contorno.
  const innerHalfWidth = 2.9 / 2 - bevel;
  const firstThirdHalfWidth = 6.8 / 2 - bevel;
  const widestHalfWidth = 7.7 / 2 - bevel;
  const outerHalfWidth = 5.7 / 2 - bevel;

  const innerY = -6 + bevel + noise();
  const thirdY = -6 + SEED_LENGTH / 3 + noise();
  const shoulderY = 2 + noise();
  const outerY = 5 - bevel + noise();

  const leftThird = -(firstThirdHalfWidth + noise());
  const rightThird = firstThirdHalfWidth + noise();

  const leftShoulder = -Math.max(
    -leftThird + 0.18,
    widestHalfWidth + noise()
  );
  const rightShoulder = Math.max(
    rightThird + 0.18,
    widestHalfWidth + noise()
  );

  const leftOuter = -(outerHalfWidth + noise());
  const rightOuter = outerHalfWidth + noise();

  const shape = new THREE.Shape();

  // Ponta interna estreita e arredondada.
  shape.moveTo(0, innerY);
  shape.bezierCurveTo(
    -innerHalfWidth,
    innerY,
    leftThird,
    thirdY - 1,
    leftThird,
    thirdY
  );

  // O grão alarga progressivamente em direção à ponta externa.
  shape.bezierCurveTo(
    leftThird,
    thirdY + 1,
    leftShoulder,
    shoulderY - 1,
    leftShoulder,
    shoulderY
  );

  shape.bezierCurveTo(
    leftShoulder,
    outerY - 0.3,
    leftOuter - 0.6,
    outerY,
    leftOuter,
    outerY
  );

  // Extremidade externa larga, quase reta, com ombros arredondados.
  shape.bezierCurveTo(
    leftOuter + (rightOuter - leftOuter) / 3,
    outerY,
    rightOuter - (rightOuter - leftOuter) / 3,
    outerY,
    rightOuter,
    outerY
  );

  shape.bezierCurveTo(
    rightOuter + 0.6,
    outerY,
    rightShoulder,
    outerY - 0.3,
    rightShoulder,
    shoulderY
  );

  shape.bezierCurveTo(
    rightShoulder,
    shoulderY - 1,
    rightThird,
    thirdY + 1,
    rightThird,
    thirdY
  );

  shape.bezierCurveTo(
    rightThird,
    thirdY - 1,
    innerHalfWidth,
    innerY,
    0,
    innerY
  );

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, EXTRUDE_OPTIONS);
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;
  const width = bounds.max.x - bounds.min.x;
  const length = bounds.max.y - bounds.min.y;
  const centerX = (bounds.min.x + bounds.max.x) / 2;

  // Silhueta final, já incluindo bevel: y = -6…5 e largura máxima 7,7.
  geometry.translate(
    -centerX,
    -bounds.min.y,
    -EXTRUDE_OPTIONS.depth / 2
  );
  geometry.scale(SEED_WIDTH / width, SEED_LENGTH / length, 1);
  geometry.translate(0, -6, 0);

  return smoothExtrusionNormals(geometry);
}

function createCoreGeometry(random) {
  const sides = 12;
  const insetRadius = CORE_RADIUS - EXTRUDE_OPTIONS.bevelSize;
  const vertices = [];

  for (let i = 0; i < sides; i++) {
    const angle = Math.PI / 2 + (i / sides) * TAU;
    const radius = insetRadius + (random() - 0.5) * 0.22;

    vertices.push(
      new THREE.Vector2(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      )
    );
  }

  // 0.5: cada lado é uma curva de ponto médio a ponto médio, sem trecho reto sobrando, então
  // o miolo parece uma pedrinha lisa e um pouco irregular em vez de um polígono facetado
  const cornerFraction = 0.5;
  const incoming = [];
  const outgoing = [];

  for (let i = 0; i < sides; i++) {
    const current = vertices[i];
    const previous = vertices[(i + sides - 1) % sides];
    const next = vertices[(i + 1) % sides];

    incoming.push(current.clone().lerp(previous, cornerFraction));
    outgoing.push(current.clone().lerp(next, cornerFraction));
  }

  const shape = new THREE.Shape();
  shape.moveTo(incoming[0].x, incoming[0].y);

  for (let i = 0; i < sides; i++) {
    const vertex = vertices[i];
    const exit = outgoing[i];
    const nextEntry = incoming[(i + 1) % sides];

    shape.quadraticCurveTo(vertex.x, vertex.y, exit.x, exit.y);
    shape.lineTo(nextEntry.x, nextEntry.y);
  }

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, EXTRUDE_OPTIONS);
  geometry.translate(0, 0, -EXTRUDE_OPTIONS.depth / 2);

  const positions = geometry.getAttribute("position");
  let maxRadius = 0;

  for (let i = 0; i < positions.count; i++) {
    maxRadius = Math.max(
      maxRadius,
      Math.hypot(positions.getX(i), positions.getY(i))
    );
  }

  const scale = CORE_RADIUS / maxRadius;
  geometry.scale(scale, scale, 1);

  return smoothExtrusionNormals(geometry);
}

/**
 * O container precisa ter largura e altura definidas por CSS.
 *
 * mountSeal(container, {
 *   color: "#F3E6CC",        // uma única cor para sementes e miolo
 *   lightColor: "#F0B060",
 *   rimColor: "#9CBCE0",
 *   duration: 2.2,
 *   maxTiltDegrees: 12,
 *   rotationSpeed: 0.025,
 *   scrollRotation: 0.0008,
 *   shadowOpacity: 0.22,
 *   randomSeed: 28
 * });
 *
 * @returns {{ destroy: () => void, replay: () => void }}
 */
export function mountSeal(container, options = {}) {
  if (typeof container === "string") {
    container = document.querySelector(container);
  }

  if (!container || container.nodeType !== 1) {
    throw new TypeError("mountSeal: informe um container válido.");
  }

  options ??= {};

  const doc = container.ownerDocument;
  const win = doc.defaultView;

  if (!win?.ResizeObserver || !win?.IntersectionObserver) {
    throw new Error(
      "mountSeal requer ResizeObserver e IntersectionObserver."
    );
  }

  mountedSeals.get(container)?.destroy();

  const duration = Math.max(0.1, finite(options.duration, 2.2));
  const seedFlightDuration = duration * 0.22;
  const seedStagger = (duration * 0.56) / (SEED_COUNT - 1);
  const coreStart = duration * 0.78;
  const coreDuration = duration - coreStart;

  const maxTilt = THREE.MathUtils.degToRad(
    Math.min(12, Math.max(0, finite(options.maxTiltDegrees, 12)))
  );
  const rotationSpeed = finite(options.rotationSpeed, 0.025);
  const scrollRotation = finite(options.scrollRotation, 0.0008);

  const randomSeed = finite(options.randomSeed, 28);
  const random = createRandom(randomSeed);
  const geometryRandom = createRandom(randomSeed ^ 0x4a39b70d);
  const textureRandom = createRandom(randomSeed ^ 0x75bcd15);

  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");

  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    display: "block",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    background: "transparent",
  });

  const ceramicTexture = createCeramicTexture(doc, textureRandom);

  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    ceramicTexture.dispose();
    throw error;
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping =
    THREE.NeutralToneMapping ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  ceramicTexture.anisotropy = Math.min(
    4,
    renderer.capabilities.getMaxAnisotropy()
  );

  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 500);
  const cameraDirection = new THREE.Vector3(0, 0.24, 1).normalize();

  const tiltRoot = new THREE.Group();
  const floatRoot = new THREE.Group();
  const ring = new THREE.Group();

  scene.add(tiltRoot);
  tiltRoot.add(floatRoot);
  floatRoot.add(ring);

  const geometries = new Set();
  const materials = new Set();
  const cleanups = [];

  // As opções antigas de cor continuam aceitas como uma cor única.
  const sealColor = new THREE.Color(
    options.color ??
      options.seedColor ??
      options.coreColor ??
      "#F3E6CC"
  );

  const seedMaterial = new THREE.MeshStandardMaterial({
    color: sealColor,
    metalness: 0,
    roughness: 0.85,
    bumpMap: ceramicTexture,
    bumpScale: 0.22,
    flatShading: false,
  });
  materials.add(seedMaterial);

  const particles = [];
  const zAxis = new THREE.Vector3(0, 0, 1);
  const rotationVariation = THREE.MathUtils.degToRad(2);

  for (let i = 0; i < SEED_COUNT; i++) {
    const angle = (i / SEED_COUNT) * TAU;
    const geometry = createGrainGeometry(geometryRandom);
    geometries.add(geometry);

    const mesh = new THREE.Mesh(geometry, seedMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    mesh.scale.set(
      0.96 + random() * 0.08,
      0.96 + random() * 0.08,
      1
    );


    // Todas as peças terminam exatamente no mesmo plano.
    const end = new THREE.Vector3(
      Math.sin(angle) * RING_RADIUS,
      Math.cos(angle) * RING_RADIUS,
      0
    );

    const endQuaternion = new THREE.Quaternion().setFromAxisAngle(
      zAxis,
      -angle + (random() * 2 - 1) * rotationVariation
    );


    // Entrada organizada: cada grão nasce no seu lugar do anel, um logo abaixo do plano,

    // e cresce em sequência, como um traço desenhando o círculo.

    const start = end.clone();

    start.z = -4;

    const startQuaternion = endQuaternion.clone();

    ring.add(mesh);

    particles.push({
      mesh,
      start,
      end,
      startQuaternion,
      endQuaternion,
      delay: i * seedStagger,
      baseScale: mesh.scale.clone(),
      arcHeight: 8 + random() * 4,
    });
  }

  const coreGeometry = createCoreGeometry(geometryRandom);
  geometries.add(coreGeometry);

  const coreMaterial = seedMaterial.clone();
  coreMaterial.transparent = true;
  materials.add(coreMaterial);

  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.castShadow = true;
  core.receiveShadow = true;
  floatRoot.add(core);

  const shadowGeometry = new THREE.PlaneGeometry(210, 210);
  const shadowMaterial = new THREE.ShadowMaterial({
    color: 0x21140c,
    opacity: clamp01(finite(options.shadowOpacity, 0.22)),
    depthWrite: false,
  });

  geometries.add(shadowGeometry);
  materials.add(shadowMaterial);

  const shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowPlane.position.z = FLOOR_Z;
  shadowPlane.receiveShadow = true;
  tiltRoot.add(shadowPlane);

  // Preenchimento neutro predominante para preservar o creme.
  const ambient = new THREE.HemisphereLight(
    0xffffff,
    0xcfd4dd,
    2.5
  );
  ambient.position.set(0, 20, 70);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(
    options.lightColor ?? "#F0B060",
    0.55
  );
  keyLight.position.set(-60, 80, 110);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.left = -72;
  keyLight.shadow.camera.right = 72;
  keyLight.shadow.camera.top = 72;
  keyLight.shadow.camera.bottom = -72;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 280;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.08;
  keyLight.shadow.radius = 2.8;
  scene.add(keyLight, keyLight.target);

  const rimLight = new THREE.DirectionalLight(
    options.rimColor ?? "#9CBCE0",
    0.35
  );
  rimLight.position.set(65, -15, -45);
  scene.add(rimLight, rimLight.target);

  const mediaQuery = win.matchMedia("(prefers-reduced-motion: reduce)");
  const targetTilt = new THREE.Quaternion();
  const pointerAxis = new THREE.Vector3();

  let reducedMotion = mediaQuery.matches;
  let destroyed = false;
  let contextLost = false;
  let inView = false;
  let hasSize = false;
  let frameId = null;
  let lastTime = null;

  let elapsed = 0;
  let idleTime = 0;
  let spinAngle = 0;
  let scrollAngle = 0;
  let scrollTarget = 0;
  let scrollOrigin = win.scrollY || 0;

  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;

  const originalPosition = container.style.getPropertyValue("position");
  const originalPriority = container.style.getPropertyPriority("position");
  const addedPosition = win.getComputedStyle(container).position === "static";

  if (addedPosition) {
    container.style.setProperty("position", "relative");
  }

  container.appendChild(canvas);

  function listen(target, type, handler, settings) {
    target.addEventListener(type, handler, settings);
    cleanups.push(() =>
      target.removeEventListener(type, handler, settings)
    );
  }

  function canRender() {
    return (
      !destroyed &&
      !contextLost &&
      inView &&
      hasSize &&
      !doc.hidden
    );
  }

  function stopFrame() {
    if (frameId !== null) {
      win.cancelAnimationFrame(frameId);
      frameId = null;
    }

    lastTime = null;
  }

  function requestFrame() {
    if (canRender() && frameId === null) {
      frameId = win.requestAnimationFrame(frame);
    }
  }

  function syncPlayback() {
    if (canRender()) requestFrame();
    else stopFrame();
  }

  function resetMotion() {
    elapsed = 0;
    idleTime = 0;
    spinAngle = 0;
    scrollAngle = 0;
    scrollTarget = 0;
    scrollOrigin = win.scrollY || 0;

    targetTilt.identity();
    tiltRoot.quaternion.identity();
    floatRoot.position.set(0, 0, 0);
    ring.rotation.z = 0;
    core.rotation.z = 0;
  }

  function finalPose() {
    for (const particle of particles) {
      particle.mesh.position.copy(particle.end);
      particle.mesh.quaternion.copy(particle.endQuaternion);
      particle.mesh.scale.copy(particle.baseScale);
    }

    core.visible = true;
    core.position.set(0, 0, 0);
    coreMaterial.opacity = 1;
  }

  function initialPose() {
    resetMotion();

    for (const particle of particles) {
      particle.mesh.position.copy(particle.start);
      particle.mesh.quaternion.copy(particle.startQuaternion);
      particle.mesh.scale.setScalar(0.001);
    }

    core.visible = false;
    core.position.set(0, 0, -7.4);
    coreMaterial.opacity = 0;

    if (reducedMotion) {
      finalPose();
      elapsed = duration;
    }
  }

  function updateEntrance(time) {
    for (const particle of particles) {
      const t = clamp01(
        (time - particle.delay) / seedFlightDuration
      );

      if (t === 1) {
        particle.mesh.position.copy(particle.end);
        particle.mesh.quaternion.copy(particle.endQuaternion);
        particle.mesh.scale.copy(particle.baseScale);
        continue;
      }

      const e = 1 - (1 - t) ** 3;
      particle.mesh.position.lerpVectors(particle.start, particle.end, e);
      particle.mesh.quaternion.copy(particle.endQuaternion);
      particle.mesh.scale.copy(particle.baseScale).multiplyScalar(Math.max(0.001, e));
    }

    const coreProgress = clamp01(
      (time - coreStart) / coreDuration
    );

    core.visible = coreProgress > 0;
    core.position.z = THREE.MathUtils.lerp(
      -7.4,
      0,
      easeOutBack(coreProgress)
    );
    coreMaterial.opacity = smoothstep(coreProgress * 4);

    if (time >= duration) finalPose();
  }

  function updateMotion(dt) {
    tiltRoot.quaternion.slerp(targetTilt, 1 - Math.exp(-7 * dt));

    scrollAngle +=
      (scrollTarget - scrollAngle) * (1 - Math.exp(-7 * dt));

    const previousElapsed = elapsed;
    elapsed = Math.min(duration, elapsed + dt);

    if (previousElapsed < duration) {
      updateEntrance(elapsed);
    }

    const idleDt =
      previousElapsed >= duration
        ? dt
        : Math.max(0, previousElapsed + dt - duration);

    idleTime += idleDt;
    spinAngle = (spinAngle + rotationSpeed * idleDt) % TAU;

    floatRoot.position.y = Math.sin(idleTime * 0.75) * 0.55;
    floatRoot.position.z = Math.sin(idleTime * 1.05) * 0.45;

    ring.rotation.z = spinAngle + scrollAngle;
    core.rotation.z = spinAngle;
  }

  function frame(now) {
    frameId = null;

    if (!canRender()) {
      lastTime = null;
      return;
    }

    const dt =
      lastTime === null
        ? 0
        : Math.min(0.1, Math.max(0, (now - lastTime) / 1000));

    lastTime = now;

    if (!reducedMotion) updateMotion(dt);

    renderer.render(scene, camera);

    if (reducedMotion) {
      lastTime = null;
    } else {
      requestFrame();
    }
  }

  function resize() {
    if (destroyed) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    // desenhado com pelo menos o dobro da resolução da tela e reduzido: as sementes ficam nítidas enquanto
    // giram, mesmo numa tela a 100%, onde o antialiasing simples ainda cintila
    const dpr = Math.min(3, Math.max(2, (win.devicePixelRatio || 1) * 1.5));

    hasSize = width > 0 && height > 0;

    if (!hasSize) {
      stopFrame();
      return;
    }

    if (
      width !== lastWidth ||
      height !== lastHeight ||
      dpr !== lastDpr
    ) {
      lastWidth = width;
      lastHeight = height;
      lastDpr = dpr;

      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);

      camera.aspect = width / height;

      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontalHalfFov = Math.atan(
        Math.tan(verticalHalfFov) * camera.aspect
      );

      const distance =
        54 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));

      camera.position.copy(cameraDirection).multiplyScalar(distance);
      camera.near = Math.max(0.1, distance - 120);
      camera.far = distance + 120;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    }

    syncPlayback();
  }

  function resetPointer() {
    targetTilt.identity();
  }

  function onPointerMove(event) {
    if (
      destroyed ||
      reducedMotion ||
      !inView ||
      !hasSize ||
      event.pointerType === "touch"
    ) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    if (
      !rect.width ||
      !rect.height ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      resetPointer();
      return;
    }

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    const length = Math.hypot(x, y);

    if (length < 1e-6) {
      resetPointer();
      return;
    }

    pointerAxis.set(-y / length, x / length, 0);

    targetTilt.setFromAxisAngle(
      pointerAxis,
      Math.min(1, length) * maxTilt
    );
  }

  function onScroll() {
    if (destroyed || reducedMotion) return;

    scrollTarget = ((win.scrollY || 0) - scrollOrigin) * scrollRotation;
    resetPointer();
  }

  function onMotionPreferenceChange() {
    if (destroyed) return;

    stopFrame();
    reducedMotion = mediaQuery.matches;
    resetMotion();
    finalPose();
    elapsed = duration;
    syncPlayback();
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stopFrame();
  }

  function onContextRestored() {
    if (destroyed) return;

    contextLost = false;
    ceramicTexture.needsUpdate = true;

    for (const material of materials) {
      material.needsUpdate = true;
    }

    lastWidth = lastHeight = lastDpr = 0;
    resize();
  }

  const resizeObserver = new win.ResizeObserver(resize);

  const intersectionObserver = new win.IntersectionObserver(
    (entries) => {
      if (destroyed) return;

      const entry = entries[entries.length - 1];
      inView = entry.isIntersecting && entry.intersectionRatio > 0;

      if (!inView) resetPointer();
      syncPlayback();
    },
    { threshold: [0, 0.001] }
  );

  listen(win, "resize", resize, { passive: true });
  listen(win, "scroll", onScroll, { passive: true });
  listen(win, "pointermove", onPointerMove, { passive: true });
  listen(win, "pointercancel", resetPointer, { passive: true });
  listen(win, "blur", resetPointer);

  listen(win, "pointerout", (event) => {
    if (!event.relatedTarget) resetPointer();
  });

  listen(doc, "visibilitychange", () => {
    resetPointer();
    syncPlayback();
  });

  listen(canvas, "webglcontextlost", onContextLost);
  listen(canvas, "webglcontextrestored", onContextRestored);

  if (mediaQuery.addEventListener) {
    listen(mediaQuery, "change", onMotionPreferenceChange);
  } else {
    mediaQuery.addListener(onMotionPreferenceChange);
    cleanups.push(() =>
      mediaQuery.removeListener(onMotionPreferenceChange)
    );
  }

  function replay() {
    if (destroyed) return;

    stopFrame();
    initialPose();
    syncPlayback();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;

    stopFrame();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();

    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;

    keyLight.shadow.dispose();

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();

    ceramicTexture.dispose();
    ceramicTexture.image.width = 1;
    ceramicTexture.image.height = 1;

    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();

    ring.clear();
    floatRoot.clear();
    tiltRoot.clear();
    scene.clear();

    particles.length = 0;
    geometries.clear();
    materials.clear();
    canvas.remove();

    if (
      addedPosition &&
      container.style.getPropertyValue("position") === "relative" &&
      container.style.getPropertyPriority("position") === ""
    ) {
      if (originalPosition) {
        container.style.setProperty(
          "position",
          originalPosition,
          originalPriority
        );
      } else {
        container.style.removeProperty("position");
      }
    }

    if (mountedSeals.get(container) === api) {
      mountedSeals.delete(container);
    }
  }

  const api = { destroy, replay };
  mountedSeals.set(container, api);

  initialPose();
  resizeObserver.observe(container);
  intersectionObserver.observe(container);
  resize();

  return api;
}
