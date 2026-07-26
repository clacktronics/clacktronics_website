/* Shared 3D viewer core.
 *
 * Both the 3D Model Viewer application (content/applications/model-viewer.html)
 * and the inline `@[model]` markdown embeds (assets/js/model-embed.js) render
 * through here, so a fix to the loaders, the lighting rig or the palette lands
 * in both at once.
 *
 * three.js and its addons are imported through the bare specifiers declared in
 * the host page's import map (index.html, the plain-mirror pages and the app
 * page all carry the same one), which keeps every importer on a single copy of
 * three.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export { THREE };

/* Each preset is a set of light intensities and a key-light direction; the
   brightness setting scales the intensities on top of the preset. */
export const LIGHTING_PRESETS = {
  studio: { hemisphere: 2.2, key: 3.1, fill: 1.2, ambient: 0, keyPosition: [70, 110, 80] },
  soft: { hemisphere: 3.4, key: 1.3, fill: 1.7, ambient: 0, keyPosition: [40, 120, 70] },
  dramatic: { hemisphere: 0.6, key: 4.8, fill: 0.3, ambient: 0, keyPosition: [110, 70, 25] },
  flat: { hemisphere: 4.2, key: 0.7, fill: 1, ambient: 0, keyPosition: [0, 140, 10] },
  /* An ambient intensity of PI cancels the Lambert 1/PI factor, so unlit faces
     come out at exactly the model colour. */
  unlit: { hemisphere: 0, key: 0, fill: 0, ambient: Math.PI, keyPosition: [0, 140, 10] }
};

/* Axis orders name which source axis becomes world X, Y and Z, in that order:
   'xzy' sends the model's Z up, which is what three.js needs from a file drawn
   Z-up. An odd permutation mirrors the model, so the world Z column is negated
   to keep it a rotation — 'xzy' is then exactly a quarter turn about X. */
export const AXIS_ORDERS = ['xyz', 'xzy', 'yxz', 'yzx', 'zxy', 'zyx'];

/* STL, STEP and 3MF come from CAD and 3D-printing tools, which put Z up. OBJ
   comes from graphics tools, which put Y up like three.js. */
const FORMAT_AXIS_ORDER = { stl: 'xzy', step: 'xzy', stp: 'xzy', obj: 'xyz', '3mf': 'xzy' };

export const extensionOf = name =>
  String(name || '').split(/[?#]/)[0].split('.').pop().toLowerCase();

export const axisOrderFor = name => FORMAT_AXIS_ORDER[extensionOf(name)] || 'xyz';

function axisMatrix(order) {
  const source = { x: 0, y: 1, z: 2 };
  const rows = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  [...String(order)].forEach((axis, world) => { rows[world][source[axis]] = 1; });
  const determinant =
    rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1]) -
    rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0]) +
    rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]);
  if (determinant < 0) rows[2] = rows[2].map(value => -value);
  return new THREE.Matrix4().set(
    rows[0][0], rows[0][1], rows[0][2], 0,
    rows[1][0], rows[1][1], rows[1][2], 0,
    rows[2][0], rows[2][1], rows[2][2], 0,
    0, 0, 0, 1);
}

export const SCENE_COLOUR_KEYS = ['model', 'grid', 'background'];
export const LIGHT_COLOUR_KEYS = ['key', 'fill', 'sky', 'ground'];
export const COLOUR_KEYS = [...SCENE_COLOUR_KEYS, ...LIGHT_COLOUR_KEYS];

export const asHex = value => `#${new THREE.Color(value).getHexString()}`;

const themeColour = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/* Colours follow the ClackOS palette until something overrides them. */
const themedColour = {
  model: () => themeColour('--leaf', '#4fae7d'),
  grid: () => themeColour('--leaf-deep', '#276b47'),
  background: () => themeColour('--paper-deep', '#f3ecd1'),
  key: () => '#ffffff',
  fill: () => themeColour('--menu-dim', '#8fcaa8'),
  sky: () => themeColour('--paper', '#f8f2dd'),
  ground: () => themeColour('--sage', '#66755a')
};

/* ------------------------------------------------------------------ loaders */

let occtPromise = null;

function loadOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('The STEP importer could not be downloaded.'));
      document.head.appendChild(script);
    });
    return window.occtimportjs({
      locateFile: file => file.endsWith('.wasm')
        ? 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.wasm'
        : file
    });
  })().catch(error => {
    occtPromise = null;
    throw error;
  });
  return occtPromise;
}

function geometryFromStepMesh(stepMesh) {
  const geometry = new THREE.BufferGeometry();
  const positions = stepMesh.attributes.position.array;
  const flatPositions = Array.isArray(positions[0]) ? positions.flat() : positions;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(flatPositions, 3));
  if (stepMesh.attributes.normal) {
    const normals = stepMesh.attributes.normal.array;
    const flatNormals = Array.isArray(normals[0]) ? normals.flat() : normals;
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(flatNormals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  const index = stepMesh.index && stepMesh.index.array;
  if (index) geometry.setIndex(Array.isArray(index[0]) ? index.flat() : index);
  return geometry;
}

async function parseStl(buffer, material) {
  const geometry = new STLLoader().parse(buffer);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const hasColors = Boolean(geometry.hasColors);
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material(null, {
    vertexColors: hasColors,
    transparent: hasColors && geometry.alpha < 1,
    opacity: hasColors ? geometry.alpha : 1
  })));
  return {
    root,
    triangles: Math.floor(geometry.getAttribute('position').count / 3),
    ownColours: hasColors
  };
}

/* OBJ and 3MF arrive with the loader's own materials. Swap them for the
   viewer's, keeping any colour the file actually specified: a plain white
   material is what both loaders leave behind when the file names no colour. */
function adoptMaterials(root, material) {
  let ownColours = false;
  let triangles = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    const { geometry } = object;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const vertexColours = Boolean(geometry.getAttribute('color'));
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const replacements = sources.map(source => {
      const given = source?.color && source.color.getHex() !== 0xffffff ? source.color.clone() : null;
      ownColours = ownColours || vertexColours || Boolean(given);
      return material(given, {
        vertexColors: vertexColours,
        transparent: Boolean(source?.transparent),
        opacity: source?.opacity ?? 1
      });
    });
    sources.filter(Boolean).forEach(source => source.dispose());
    object.material = Array.isArray(object.material) ? replacements : replacements[0];
    const positions = geometry.getAttribute('position');
    triangles += (geometry.index ? geometry.index.count : positions.count) / 3;
  });
  return { ownColours, triangles: Math.floor(triangles) };
}

async function parseObj(buffer, material) {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const root = new OBJLoader().parse(new TextDecoder().decode(buffer));
  return { root, ...adoptMaterials(root, material) };
}

async function parse3mf(buffer, material) {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
  const root = new ThreeMFLoader().parse(buffer);
  return { root, ...adoptMaterials(root, material) };
}

async function parseStep(buffer, material, onProgress) {
  onProgress?.('Loading STEP engine…');
  const occt = await loadOcct();
  onProgress?.('Triangulating STEP model…');
  await new Promise(resolve => requestAnimationFrame(resolve));
  const result = occt.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.002,
    angularDeflection: 0.5
  });
  if (!result.success) throw new Error('The STEP importer could not read this file.');

  const root = new THREE.Group();
  let triangles = 0;
  let ownColours = false;
  result.meshes.forEach(stepMesh => {
    const geometry = geometryFromStepMesh(stepMesh);
    /* STEP files may carry their own part colours, which take priority;
       anything without one follows the viewer's model colour. */
    const rgb = stepMesh.color?.map(value => value > 1 ? value / 255 : value);
    const colour = rgb ? new THREE.Color(rgb[0], rgb[1], rgb[2]) : null;
    ownColours = ownColours || Boolean(rgb);
    root.add(new THREE.Mesh(geometry, material(colour)));
    triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute('position').count / 3;
  });
  return { root, triangles: Math.floor(triangles), parts: result.meshes.length, ownColours };
}

export const MODEL_FORMATS = {
  stl: { label: 'STL', parse: parseStl },
  step: { label: 'STEP', parse: parseStep },
  stp: { label: 'STEP', parse: parseStep },
  obj: { label: 'OBJ', parse: parseObj },
  '3mf': { label: '3MF', parse: parse3mf }
};

export const formatFor = name => MODEL_FORMATS[extensionOf(name)] || null;

/* ------------------------------------------------------------------- viewer */

/* Builds a viewport inside `container` and returns the handles both callers
 * need. `transparent` leaves the page background showing through, which is what
 * the inline embeds use to sit in the text without looking like a panel. */
export function createModelScene(container, { transparent = false, fitMargin = 1.18 } = {}) {
  const overrides = Object.fromEntries(COLOUR_KEYS.map(key => [key, null]));
  const colour = key => overrides[key] || themedColour[key]();

  const scene = new THREE.Scene();
  scene.background = transparent ? null : new THREE.Color(colour('background'));

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  camera.position.set(95, 70, 105);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: transparent,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (transparent) renderer.setClearAlpha(0);
  renderer.domElement.setAttribute('aria-label',
    '3D model; drag to orbit, right-drag to pan, and use the wheel to zoom');
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.minDistance = 8;
  controls.maxDistance = 500;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.9;
  controls.addEventListener('change', render);

  const hemisphereLight = new THREE.HemisphereLight(colour('sky'), colour('ground'), 2.2);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight(colour('key'), 3.1);
  keyLight.position.set(70, 110, 80);
  keyLight.castShadow = true;
  /* Models are normalised to 80 units, so the shadow camera has to be widened
     from its 10-unit default; left at the default it covers a small patch in the
     middle of the model and fills it with shadow acne. The biases keep flat faces
     from shadowing themselves. */
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -95;
  keyLight.shadow.camera.right = 95;
  keyLight.shadow.camera.top = 95;
  keyLight.shadow.camera.bottom = -95;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 420;
  keyLight.shadow.camera.updateProjectionMatrix();
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.8;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(colour('fill'), 1.2);
  fillLight.position.set(-80, 40, -60);
  scene.add(fillLight);
  /* Unlit mode lights everything evenly through this one, so faces keep their
     exact colour with no shading at all. */
  const ambientLight = new THREE.AmbientLight(0xffffff, 0);
  scene.add(ambientLight);

  const grid = new THREE.GridHelper(140, 14, 0x276b47, 0x276b47);
  grid.position.y = -42;
  scene.add(grid);

  let modelRoot = null;     // the holder that is normalised and added to the scene
  let sourceRoot = null;    // the model as it was loaded, inside the holder
  let axisOrder = 'xyz';
  let lightingPreset = 'studio';
  let brightness = 1;
  let rotationFrame = null;

  function render() {
    renderer.render(scene, camera);
  }

  /* Models render in the accent colour. Passing no colour marks the material as
     themed, so it follows the palette. Colours that come from the file itself —
     STEP part colours, STL vertex colours — win instead and are left alone;
     vertex colours need a white base so the file's colours are not tinted. */
  function material(color = null, options = {}) {
    const themed = color === null && !options.vertexColors;
    const entry = new THREE.MeshStandardMaterial({
      color: options.vertexColors ? 0xffffff : (color === null ? new THREE.Color(colour('model')) : color),
      roughness: 0.62,
      metalness: options.metalness || 0,
      side: THREE.DoubleSide,
      vertexColors: Boolean(options.vertexColors),
      transparent: Boolean(options.transparent),
      opacity: options.opacity ?? 1
    });
    entry.userData.themed = themed;
    return entry;
  }

  function applyModelColour() {
    modelRoot?.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(entry => entry?.userData.themed).forEach(entry => entry.color.set(colour('model')));
    });
  }

  /* GridHelper keeps its two line colours in a vertex colour attribute and draws
     them through one material, so tinting the material would multiply the stored
     colours instead of replacing them. Write the colour into the attribute. */
  function applyGridColour() {
    const value = new THREE.Color(colour('grid'));
    const colours = grid.geometry.getAttribute('color');
    for (let index = 0; index < colours.count; index += 1) colours.setXYZ(index, value.r, value.g, value.b);
    colours.needsUpdate = true;
  }

  function applyLightColours() {
    keyLight.color.set(colour('key'));
    fillLight.color.set(colour('fill'));
    hemisphereLight.color.set(colour('sky'));
    hemisphereLight.groundColor.set(colour('ground'));
  }

  function applyBackground() {
    if (transparent) return;
    if (!scene.background) scene.background = new THREE.Color(colour('background'));
    else scene.background.set(colour('background'));
  }

  function applyLighting() {
    const preset = LIGHTING_PRESETS[lightingPreset];
    hemisphereLight.intensity = preset.hemisphere * brightness;
    keyLight.intensity = preset.key * brightness;
    fillLight.intensity = preset.fill * brightness;
    ambientLight.intensity = preset.ambient * brightness;
    keyLight.position.set(...preset.keyPosition);
    render();
  }

  /* Re-reads every colour that has not been overridden; call it when the
     ClackOS theme changes. */
  function refreshTheme() {
    applyBackground();
    applyLightColours();
    applyGridColour();
    applyModelColour();
    render();
  }

  function setColour(key, value) {
    overrides[key] = value || null;
    if (key === 'model') applyModelColour();
    else if (key === 'grid') applyGridColour();
    else if (key === 'background') applyBackground();
    else applyLightColours();
    render();
  }

  function setLightingPreset(name) {
    if (!LIGHTING_PRESETS[name]) return;
    lightingPreset = name;
    applyLighting();
  }

  function setBrightness(value) {
    brightness = value;
    applyLighting();
  }

  function setShadows(enabled) {
    keyLight.castShadow = enabled;
    renderer.shadowMap.enabled = enabled;
    scene.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(entry => { entry.needsUpdate = true; });
    });
    render();
  }

  function setGridVisible(visible) {
    grid.visible = visible;
    render();
  }

  function setWireframe(enabled) {
    modelRoot?.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(entry => { entry.wireframe = enabled; });
    });
    render();
  }

  /* Auto-rotation runs its own frame loop. OrbitControls keeps handling pointer
     input while it spins, so the user can still orbit, pan and zoom. */
  function spin() {
    if (!controls.autoRotate) {
      rotationFrame = null;
      return;
    }
    rotationFrame = requestAnimationFrame(spin);
    controls.update();
  }

  function setAutoRotate(enabled, speed) {
    if (speed !== undefined) controls.autoRotateSpeed = speed;
    controls.autoRotate = enabled;
    if (enabled && rotationFrame === null) spin();
  }

  function normaliseModel(root) {
    root.position.set(0, 0, 0);
    root.scale.setScalar(1);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error('The model contains no visible geometry.');
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largest) || largest <= 0) throw new Error('The model has invalid dimensions.');
    const scale = 80 / largest;
    root.scale.setScalar(scale);
    root.position.copy(centre).multiplyScalar(-scale);
    root.updateMatrixWorld(true);
    const normalisedBox = new THREE.Box3().setFromObject(root);
    grid.position.y = normalisedBox.min.y - 1.5;
  }

  function fitView(resetDirection = false) {
    if (!modelRoot) return;
    const box = new THREE.Box3().setFromObject(modelRoot);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = resetDirection
      ? new THREE.Vector3(1, 0.72, 1).normalize()
      : camera.position.clone().sub(controls.target).normalize();
    const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const distance = Math.max(sphere.radius / Math.sin(halfFov), 30) * fitMargin;
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 500, 0.05);
    camera.far = distance * 20;
    camera.updateProjectionMatrix();
    controls.update();
    render();
  }

  function disposeObject(root) {
    root.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (Array.isArray(object.material)) object.material.forEach(entry => entry.dispose());
      else if (object.material) object.material.dispose();
    });
  }

  /* The model sits inside a holder: the axis order turns the model, and the
     holder carries the centring and scaling, so the two never fight. */
  function setModel(root) {
    if (modelRoot) {
      scene.remove(modelRoot);
      disposeObject(modelRoot);
    }
    sourceRoot = root;
    modelRoot = new THREE.Group();
    modelRoot.add(root);
    applyAxisOrder();
    normaliseModel(modelRoot);
    scene.add(modelRoot);
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    fitView(true);
  }

  function applyAxisOrder() {
    if (!sourceRoot) return;
    sourceRoot.quaternion.setFromRotationMatrix(axisMatrix(axisOrder));
    sourceRoot.updateMatrixWorld(true);
  }

  function setAxisOrder(order, { refit = true } = {}) {
    if (!AXIS_ORDERS.includes(order)) return;
    axisOrder = order;
    if (!sourceRoot) return;
    applyAxisOrder();
    normaliseModel(modelRoot);
    if (refit) fitView(true);
    render();
  }

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }

  function dispose() {
    if (rotationFrame !== null) cancelAnimationFrame(rotationFrame);
    rotationFrame = null;
    controls.dispose();
    if (modelRoot) disposeObject(modelRoot);
    grid.geometry.dispose();
    grid.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  /* Parses a model buffer with this scene's materials. */
  async function parse(buffer, name, onProgress) {
    const format = formatFor(name);
    if (!format) throw new Error('Choose an STL, STEP, OBJ or 3MF file.');
    const parsed = await format.parse(buffer, material, onProgress);
    return { label: format.label, ...parsed };
  }

  applyLighting();
  applyLightColours();
  applyGridColour();
  resize();

  return {
    scene, camera, renderer, controls, grid,
    colour, material, parse, render, resize, dispose,
    setModel, fitView, setColour, setWireframe, setAutoRotate, setGridVisible,
    setShadows, setLightingPreset, setBrightness, setAxisOrder, refreshTheme,
    get modelRoot() { return modelRoot; },
    get autoRotate() { return controls.autoRotate; },
    get lightingPreset() { return lightingPreset; },
    get axisOrder() { return axisOrder; },
    get gridVisible() { return grid.visible; },
    get shadows() { return keyLight.castShadow; }
  };
}
