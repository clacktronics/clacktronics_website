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
   and glTF/GLB come from graphics tools, which put Y up like three.js — GLB by
   specification rather than convention. */
const FORMAT_AXIS_ORDER = { stl: 'xzy', step: 'xzy', stp: 'xzy', obj: 'xyz', '3mf': 'xzy', glb: 'xyz' };

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

/* OCCT reports colours as r, g, b — either 0-1 or 0-255 depending on how the
   file wrote them, so a value above 1 means the triple is in bytes. */
function stepColour(values) {
  if (!Array.isArray(values) || values.length < 3) return null;
  const [r, g, b] = values.map(value => (value > 1 ? value / 255 : value));
  return new THREE.Color(r, g, b);
}

/* A STEP file can colour each b-rep face separately — an anodised panel with
 * bare screw holes, a board with tinned pads — and OCCT reports that as
 * `brep_faces`: a colour, or null, against a run of triangle indices.
 *
 * This turns those runs into geometry groups, one material per distinct colour,
 * merging neighbours that share a colour so a 900-face part does not become 900
 * materials. Faces the file leaves uncoloured fall back to the mesh's own
 * colour and then to no colour at all, which keeps them on the viewer's themed
 * material and following the colour picker. Runs OCCT does not account for are
 * filled in the same way: a geometry with groups draws nothing outside them, so
 * any gap would otherwise punch a hole in the part.
 *
 * Returns null when the mesh needs no splitting, so the common case stays on a
 * single material. */
function stepFaceGroups(stepMesh, triangleCount, meshColour) {
  const faces = Array.isArray(stepMesh.brep_faces) ? stepMesh.brep_faces : [];
  if (!faces.some(face => face && stepColour(face.color))) return null;

  const groups = [];
  const push = (first, last, colour) => {
    if (last < first) return;
    const key = colour ? colour.getHex() : 'themed';
    const previous = groups[groups.length - 1];
    if (previous && previous.key === key && previous.last + 1 === first) previous.last = last;
    else groups.push({ first, last, colour, key });
  };

  let cursor = 0;
  [...faces]
    .filter(face => face && Number.isInteger(face.first) && Number.isInteger(face.last))
    .sort((a, b) => a.first - b.first)
    .forEach(face => {
      const first = Math.max(face.first, cursor);
      const last = Math.min(face.last, triangleCount - 1);
      if (last < first) return;
      if (first > cursor) push(cursor, first - 1, meshColour);
      push(first, last, stepColour(face.color) || meshColour);
      cursor = last + 1;
    });
  push(cursor, triangleCount - 1, meshColour);
  /* One face colour over the whole mesh is just the mesh's colour: only keep
     the groups when they actually say something the single material cannot. */
  if (groups.length === 1 && groups[0].colour === meshColour) return null;
  return groups.length ? groups : null;
}

/* One material per colour, shared across the groups that use it, so the mesh
   carries as many materials as the part has distinct colours and no more. */
function stepMaterials(geometry, groups, material) {
  const materials = [];
  const indices = new Map();
  groups.forEach(({ first, last, colour, key }) => {
    if (!indices.has(key)) {
      indices.set(key, materials.length);
      materials.push(material(colour));
    }
    geometry.addGroup(first * 3, (last - first + 1) * 3, indices.get(key));
  });
  return materials;
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

/* Draco geometry compression, meshopt compression and KTX2 textures are all
   optional glTF extensions, and each needs a decoder GLTFLoader does not carry
   itself. They are fetched from the same three build the import map names, so a
   version bump there moves the decoders with it, and only on the first GLB. */
const THREE_ADDONS = (() => {
  try {
    const resolved = import.meta.resolve?.('three/addons/');
    if (resolved) return resolved;
  } catch { /* no import.meta.resolve, or no import map entry for it */ }
  return 'https://cdn.jsdelivr.net/npm/three@0.178.0/examples/jsm/';
})();

let gltfPromise = null;

function loadGltf() {
  if (gltfPromise) return gltfPromise;
  gltfPromise = (async () => {
    const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/DRACOLoader.js'),
      import('three/addons/loaders/KTX2Loader.js'),
      import('three/addons/libs/meshopt_decoder.module.js')
    ]);
    const ktx2 = new KTX2Loader().setTranscoderPath(`${THREE_ADDONS}libs/basis/`);
    const loader = new GLTFLoader()
      .setDRACOLoader(new DRACOLoader().setDecoderPath(`${THREE_ADDONS}libs/draco/gltf/`))
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder);
    return { loader, ktx2 };
  })().catch(error => {
    gltfPromise = null;
    throw error;
  });
  return gltfPromise;
}

/* Every texture slot a glTF material can fill. A material using any of them is
   carrying artwork from the file, which is the whole point of the format. */
const TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap',
  'alphaMap', 'bumpMap', 'displacementMap', 'clearcoatMap', 'sheenColorMap',
  'specularMap', 'iridescenceMap', 'transmissionMap'
];

/* Unlike the CAD formats, a GLB arrives with materials somebody authored, so
   they are kept exactly as they are — textures, metalness, roughness and all —
   and the model colour picker leaves them alone. Only materials that say
   nothing at all (untextured, plain white, no glow) are swapped for the themed
   one, which is what an untextured export looks like and what the picker is
   for. Materials shared between meshes are decided once. */
function adoptGltfMaterials(root, material) {
  let ownColours = false;
  let triangles = 0;
  const decided = new Map();
  root.traverse(object => {
    if (!object.isMesh) return;
    const { geometry } = object;
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const vertexColours = Boolean(geometry.getAttribute('color'));
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const replacements = sources.map(source => {
      if (!source) return material(null);
      if (decided.has(source)) return decided.get(source);
      const textured = TEXTURE_SLOTS.some(slot => source[slot]);
      const tinted = source.color && source.color.getHex() !== 0xffffff;
      const glowing = source.emissive && source.emissive.getHex() !== 0x000000;
      const keep = textured || tinted || glowing || vertexColours;
      const replacement = keep ? source : material(null, {
        metalness: source.metalness ?? 0,
        transparent: Boolean(source.transparent),
        opacity: source.opacity ?? 1
      });
      if (keep) ownColours = true;
      else source.dispose();
      decided.set(source, replacement);
      return replacement;
    });
    object.material = Array.isArray(object.material) ? replacements : replacements[0];
    const positions = geometry.getAttribute('position');
    triangles += (geometry.index ? geometry.index.count : positions.count) / 3;
  });
  return { ownColours, triangles: Math.floor(triangles) };
}

async function parseGlb(buffer, material, onProgress, { renderer } = {}) {
  onProgress?.('Loading glTF decoders…');
  const { loader, ktx2 } = await loadGltf();
  /* Which compressed texture formats can be transcoded to depends on the GPU,
     so the KTX2 decoder is pointed at the renderer that will draw the result. */
  if (renderer) ktx2.detectSupport(renderer);
  onProgress?.('Reading GLB model…');
  const gltf = await new Promise((resolve, reject) => loader.parse(buffer, '', resolve,
    error => reject(new Error(`The GLB file could not be read: ${error?.message || error}`))));

  const root = gltf.scene || gltf.scenes?.[0];
  if (!root) throw new Error('The GLB file contains no scene.');
  /* A GLB may carry its own punctual lights. The viewer has a lighting rig and
     five presets of its own, so the file's lights are dropped rather than added
     on top of them. */
  const lights = [];
  root.traverse(object => { if (object.isLight) lights.push(object); });
  lights.forEach(light => light.removeFromParent());
  /* Animation the model's author made, which the viewer plays in preference to
     inventing movement of its own. */
  return { root, animations: gltf.animations || [], ...adoptGltfMaterials(root, material) };
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
    const count = Math.floor((geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3);
    /* STEP files may carry their own colours — per part, and per b-rep face
       within a part — which take priority; anything without one follows the
       viewer's model colour. */
    const meshColour = stepColour(stepMesh.color);
    const groups = stepFaceGroups(stepMesh, count, meshColour);
    ownColours = ownColours || Boolean(meshColour) || Boolean(groups);
    root.add(new THREE.Mesh(geometry, groups
      ? stepMaterials(geometry, groups, material)
      : material(meshColour)));
    triangles += count;
  });
  return { root, triangles: Math.floor(triangles), parts: result.meshes.length, ownColours };
}

export const MODEL_FORMATS = {
  stl: { label: 'STL', parse: parseStl },
  step: { label: 'STEP', parse: parseStep },
  stp: { label: 'STEP', parse: parseStep },
  obj: { label: 'OBJ', parse: parseObj },
  '3mf': { label: '3MF', parse: parse3mf },
  /* GLB only, not .gltf: the JSON form points at its buffers and textures as
     separate files, which does not survive being handed round as one upload. */
  glb: { label: 'GLB', parse: parseGlb }
};

export const formatFor = name => MODEL_FORMATS[extensionOf(name)] || null;

/* --------------------------------------------------------------- animations */

/* Idle animations in the manner of the old Windows 3D Viewer: a model sitting
 * on a page is more legible moving than still. Turntable is the odd one out —
 * it walks the camera round the model through OrbitControls, which is what this
 * viewer has always done and what keeps the ground grid still underneath — and
 * the rest move the model itself.
 *
 * Each pose is a pure function of the animation's phase in seconds, so nothing
 * accumulates and the speed can change mid-movement without a jump. Distances
 * are in scene units, where every model is normalised to 80 across, and the
 * frequencies assume the default speed of 0.9, which is what the phase advances
 * at per second. */
export const ANIMATIONS = {
  none: { label: 'None' },
  turntable: { label: 'Turntable', orbits: true },
  swing: {
    label: 'Swing',
    pose: (holder, phase) => { holder.rotation.y = 0.62 * Math.sin(phase * 1.5); }
  },
  jump: {
    label: 'Jump & turn',
    pose: (holder, phase) => {
      holder.rotation.y = phase * 1.1;
      /* |sin| is the arc of a bouncing ball — quick through the bottom, hanging
         at the top — rather than the smooth wave a plain sine would give. */
      holder.position.y = Math.abs(Math.sin(phase * 1.7)) * 9;
    }
  },
  hover: {
    label: 'Hover',
    pose: (holder, phase) => {
      holder.position.y = 4 * Math.sin(phase * 1.05);
      /* Two slow tilts at frequencies that do not divide into one another, so
         the drift never settles into an obvious loop. */
      holder.rotation.z = 0.035 * Math.sin(phase * 0.8);
      holder.rotation.x = 0.03 * Math.sin(phase * 0.63);
    }
  },
  tumble: {
    label: 'Tumble',
    pose: (holder, phase) => {
      holder.rotation.y = phase * 0.75;
      holder.rotation.x = phase * 0.45;
    }
  },
  rock: {
    label: 'Rock',
    pose: (holder, phase) => { holder.rotation.z = 0.4 * Math.sin(phase * 1.6); }
  }
};

export const ANIMATION_NAMES = Object.keys(ANIMATIONS);

/* ------------------------------------------------------------------ finishes */

/* One material over the whole model, in place of whatever it came with. Useful
 * for reading a shape rather than its decoration: a textured GLB or a
 * multi-coloured STEP assembly is easier to judge in plain clay, and a chrome
 * pass shows up surface faults that a matte finish hides.
 *
 * `authored` is the way out: it puts back the materials the file specified,
 * which for the CAD formats means the viewer's own themed material anyway.
 * `build` receives the scene's themed material factory so `colour` can follow
 * the palette and the colour picker like any other themed surface. */
export const FINISHES = {
  authored: { label: 'As authored' },
  colour: { label: 'Model colour', build: material => material(null) },
  clay: {
    label: 'Clay',
    /* Matte and near-white, the way a shape is photographed for its form
       rather than its finish. */
    build: () => new THREE.MeshStandardMaterial({
      color: 0xe6e1d6, roughness: 0.92, metalness: 0, side: THREE.DoubleSide
    })
  },
  chrome: {
    label: 'Chrome',
    /* A mirror has nothing of its own to show, so this is the one finish that
       needs an environment to reflect — see loadEnvironment(). */
    environment: true,
    build: () => new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.05, metalness: 1, side: THREE.DoubleSide
    })
  },
  normals: {
    label: 'Normals',
    /* Straight from three: each face is coloured by the direction it points, so
       flipped faces, faceting and bad smoothing are obvious at a glance. */
    build: () => new THREE.MeshNormalMaterial({ side: THREE.DoubleSide })
  }
};

export const FINISH_NAMES = Object.keys(FINISHES);

/* The speed the frequencies above are tuned around, and the viewer's default. */
export const DEFAULT_ANIMATION_SPEED = 0.9;

/* How much of the model a squish grab takes hold of, as a fraction of its size.
   Kept here rather than in the squish module because the menu needs it before
   that module has been fetched; the module clamps whatever it is given. */
export const DEFAULT_SQUISH_REACH = 0.2;

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

  /* Declared before the controls exist so their 'change' handler can never read
     it before it is initialised. */
  let looping = false;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.minDistance = 8;
  controls.maxDistance = 500;
  controls.autoRotate = false;
  controls.autoRotateSpeed = DEFAULT_ANIMATION_SPEED;
  /* While the animation loop is running it renders once at the end of each
     frame, so the camera changes it makes itself must not render again. */
  controls.addEventListener('change', () => { if (!looping) render(); });

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

  /* The model hangs in a chain of holders so that each transform has one owner
     and they never fight: animationRoot carries the idle animation, modelRoot
     the centring and scaling, and sourceRoot the axis order. */
  const animationRoot = new THREE.Group();
  scene.add(animationRoot);

  let modelRoot = null;     // the holder that is normalised, inside the animation holder
  let sourceRoot = null;    // the model as it was loaded, inside the holder
  let axisOrder = 'xyz';
  let lightingPreset = 'studio';
  let brightness = 1;
  let finish = 'authored';
  let wireframe = false;
  let squish = null;            // the springy lattice, loaded only if it is asked for
  let squishWanted = false;
  let squishReach = DEFAULT_SQUISH_REACH;
  const finishMaterials = {};   // built on demand, one per finish, disposed with the scene
  let environment = null;       // the reflection chrome needs, built once
  let environmentPromise = null;
  let animation = 'none';
  let animationSpeed = DEFAULT_ANIMATION_SPEED;
  let phase = 0;            // the animation's own clock, in seconds
  let playing = true;       // embeds stop the loop while they are off-screen
  let mixer = null;         // plays a GLB's own animation clips, when it has any
  let clips = [];
  let frame = null;
  const clock = new THREE.Clock(false);

  function render() {
    renderer.render(scene, camera);
  }

  /* Models render in the accent colour. Passing no colour marks the material as
     themed, so it follows the palette. Colours that come from the file itself —
     STEP part and face colours, STL vertex colours, GLB materials and textures —
     win instead and are left alone; vertex colours need a white base so the
     file's colours are not tinted. */
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

  function applyWireframe() {
    modelRoot?.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(entry => { entry.wireframe = wireframe; });
    });
  }

  function setWireframe(enabled) {
    wireframe = enabled;
    applyWireframe();
    render();
  }

  /* ---- finishes ---- */

  /* A mirror reflects its surroundings, and a scene lit only by three abstract
     lights has none, so chrome would come out black. This builds one: a plain
     studio room, pre-filtered into the map three.js reflects off metal. The
     room comes from three's own addons, fetched on the first chrome pass. */
  function loadEnvironment() {
    if (environmentPromise) return environmentPromise;
    environmentPromise = (async () => {
      const { RoomEnvironment } = await import('three/addons/environments/RoomEnvironment.js');
      const generator = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      environment = generator.fromScene(room, 0.04).texture;
      generator.dispose();
      disposeObject(room);
      return environment;
    })().catch(error => {
      environmentPromise = null;
      throw error;
    });
    return environmentPromise;
  }

  function finishMaterial(name) {
    if (!finishMaterials[name]) finishMaterials[name] = FINISHES[name].build(material);
    return finishMaterials[name];
  }

  /* Swapping a finish in keeps each mesh's own materials on the mesh, so going
     back to `authored` restores exactly what the file asked for — including the
     per-face material arrays a STEP assembly carries. A mesh whose material is
     not an array draws its whole geometry with that one material, groups and
     all, which is what makes a single override work over them. */
  function applyFinish() {
    if (!modelRoot) return;
    const override = FINISHES[finish]?.build ? finishMaterial(finish) : null;
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      if (object.userData.authoredMaterial === undefined) {
        object.userData.authoredMaterial = object.material;
      }
      object.material = override || object.userData.authoredMaterial;
      /* Squish deforms whatever material the mesh is wearing, so it has to be
         told each time one lands on it. */
      squish?.prepare(object);
    });
    applyWireframe();
    applyModelColour();
  }

  /* ---- squish ---- */

  /* The springy lattice is a whole module of its own and only the viewer
     application offers it, so it is fetched the first time it is switched on
     and never by a page that just shows a model. */
  function setSquish(enabled) {
    squishWanted = Boolean(enabled);
    if (!squishWanted) {
      squish?.disable();
      return Promise.resolve();
    }
    return import('./model-squish.js').then(({ createSquish }) => {
      if (!squishWanted) return;
      if (!squish) {
        squish = createSquish({ camera, renderer, controls, render, wake: startAnimation });
      }
      squish.enable();
      squish.setReach(squishReach);
      squish.reset(modelRoot);
      /* re-runs the material pass, which is where squish hooks itself in */
      applyFinish();
      render();
    });
  }

  /* How much of the model a grab takes hold of. Remembered whether or not the
     squish module has been fetched yet, so the slider works before it is turned
     on and the setting survives it being turned off and on again. */
  function setSquishReach(fraction) {
    squishReach = fraction;
    squish?.setReach(fraction);
  }

  /* Returns a promise because chrome cannot be drawn until its reflection has
     been built; every other finish resolves immediately. */
  function setFinish(name) {
    if (!FINISHES[name]) return Promise.resolve();
    finish = name;
    if (!FINISHES[name].environment) {
      scene.environment = null;
      applyFinish();
      render();
      return Promise.resolve();
    }
    return loadEnvironment().then(map => {
      /* the finish may have been changed again while the room was fetched */
      if (finish !== name) return;
      scene.environment = map;
      applyFinish();
      render();
    });
  }

  /* ---- idle animation ---- */

  /* Puts the animation holder back to rest. Anything that measures the model —
     normalising it, fitting the view — has to see it where it will sit when the
     animation is stopped, or the framing would follow the movement. */
  function restAnimation() {
    animationRoot.position.set(0, 0, 0);
    animationRoot.rotation.set(0, 0, 0);
    animationRoot.scale.setScalar(1);
    animationRoot.updateMatrixWorld(true);
  }

  function poseAnimation() {
    const pose = ANIMATIONS[animation]?.pose;
    if (!pose) return;
    restAnimation();
    pose(animationRoot, phase);
    animationRoot.updateMatrixWorld(true);
  }

  /* Measures the model at rest and then puts it back where the animation had
     it, so a fit or an axis change mid-movement neither reads the moving
     transform nor visibly interrupts it. */
  function atRest(measure) {
    restAnimation();
    const result = measure();
    poseAnimation();
    return result;
  }

  const animating = () => playing && (animation !== 'none' || Boolean(mixer) || Boolean(squish?.busy));

  /* One frame loop drives everything that moves. OrbitControls keeps handling
     pointer input throughout, so the user can orbit, pan and zoom while it
     runs. It stops itself as soon as there is nothing left to animate. */
  function tick() {
    if (!animating()) {
      frame = null;
      clock.stop();
      return;
    }
    frame = requestAnimationFrame(tick);
    /* Frames stop while the tab is in the background, so the first one back
       carries the whole gap; capped, the model resumes instead of teleporting. */
    const delta = Math.min(clock.getDelta(), 0.1);
    phase += delta * animationSpeed;
    looping = true;
    if (mixer) mixer.update(delta);
    if (ANIMATIONS[animation]?.orbits) controls.update();
    else poseAnimation();
    squish?.update(delta);
    looping = false;
    render();
  }

  function startAnimation() {
    if (!animating()) {
      /* Stopping leaves the model wherever the animation had got to, which is
         what pausing an off-screen embed should do; turning it off entirely is
         setAnimation('none'), which rests it. */
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      clock.stop();
      return;
    }
    if (frame === null) {
      clock.start();
      frame = requestAnimationFrame(tick);
    }
  }

  function setAnimation(name, speed) {
    if (!ANIMATIONS[name]) return;
    if (speed !== undefined) setAnimationSpeed(speed);
    animation = name;
    /* Every pose is at rest at phase zero, so starting the clock afresh means a
       new animation always begins from the model standing still rather than
       part-way through a jump. */
    phase = 0;
    controls.autoRotate = Boolean(ANIMATIONS[name].orbits);
    if (name === 'none') {
      restAnimation();
      render();
    }
    startAnimation();
  }

  function setAnimationSpeed(speed) {
    animationSpeed = Number.isFinite(Number(speed)) ? Number(speed) : DEFAULT_ANIMATION_SPEED;
    controls.autoRotateSpeed = animationSpeed;
    /* A model's own clips run at their authored speed at the viewer's default,
       and follow the slider from there. */
    if (mixer) mixer.timeScale = animationSpeed / DEFAULT_ANIMATION_SPEED;
  }

  /* The on/off switch for the loop that leaves the animation where it is —
     inline embeds use it to stop burning frames once they scroll away. */
  function setPlaying(value) {
    playing = Boolean(value);
    startAnimation();
  }

  /* A GLB can carry animation the model's author made, which is worth more than
     any idle movement this viewer invents; the two run together, the clip
     inside the holder and the idle animation outside it. */
  function setClipsPlaying(value) {
    if (!clips.length || !modelRoot) return;
    if (value && !mixer) {
      mixer = new THREE.AnimationMixer(modelRoot);
      mixer.timeScale = animationSpeed / DEFAULT_ANIMATION_SPEED;
      clips.forEach(clip => mixer.clipAction(clip).play());
    } else if (!value && mixer) {
      /* Winding back to the first frame before stopping leaves the model in the
         pose it loads in, rather than frozen wherever the clip had reached. */
      clips.forEach(clip => mixer.clipAction(clip).reset());
      mixer.setTime(0);
      mixer.stopAllAction();
      mixer = null;
      render();
    }
    startAnimation();
  }

  /* Kept because it reads better than setAnimation('turntable') at the call
     sites that only ever wanted a spin. */
  function setAutoRotate(enabled, speed) {
    setAnimation(enabled ? 'turntable' : 'none', speed);
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
    const box = atRest(() => new THREE.Box3().setFromObject(modelRoot));
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

  /* Materials a GLB brought with it own textures, which hold GPU memory of their
     own and are not freed by disposing the material that references them. */
  function disposeMaterial(entry) {
    TEXTURE_SLOTS.forEach(slot => entry[slot]?.dispose?.());
    entry.dispose();
  }

  function disposeObject(root) {
    const disposed = new Set();
    root.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      /* squish swaps in a subdivided geometry and stands the original aside;
         both belong to the model. */
      object.userData?.squishGeometry?.dispose();
      /* What belongs to the model is what it was loaded with: a finish override
         is the scene's, shared with every other mesh, and outlives the model. */
      const owned = object.userData?.authoredMaterial ?? object.material;
      const materials = Array.isArray(owned) ? owned : [owned];
      materials.filter(entry => entry && !disposed.has(entry)).forEach(entry => {
        disposed.add(entry);
        disposeMaterial(entry);
      });
    });
  }

  /* The model sits inside a holder: the axis order turns the model, and the
     holder carries the centring and scaling, so the two never fight. Animation
     clips the file brought with it start playing as the model appears. */
  function setModel(root, { animations = [] } = {}) {
    if (mixer) {
      mixer.stopAllAction();
      mixer = null;
    }
    if (modelRoot) {
      animationRoot.remove(modelRoot);
      disposeObject(modelRoot);
    }
    sourceRoot = root;
    modelRoot = new THREE.Group();
    modelRoot.add(root);
    applyAxisOrder();
    atRest(() => normaliseModel(modelRoot));
    animationRoot.add(modelRoot);
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    clips = Array.isArray(animations) ? animations : [];
    if (clips.length) setClipsPlaying(true);
    /* A chosen finish outlives the model it was chosen against, and the
       lattice is rebuilt around whatever has just been loaded. */
    applyFinish();
    squish?.reset(modelRoot);
    fitView(true);
    startAnimation();
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
    atRest(() => normaliseModel(modelRoot));
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
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    mixer?.stopAllAction();
    mixer = null;
    controls.dispose();
    if (modelRoot) disposeObject(modelRoot);
    squish?.dispose();
    squish = null;
    Object.values(finishMaterials).forEach(entry => entry.dispose());
    environment?.dispose();
    grid.geometry.dispose();
    grid.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  /* Parses a model buffer with this scene's materials. */
  async function parse(buffer, name, onProgress) {
    const format = formatFor(name);
    if (!format) throw new Error('Choose an STL, STEP, OBJ, 3MF or GLB file.');
    const parsed = await format.parse(buffer, material, onProgress, { renderer });
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
    setAnimation, setAnimationSpeed, setPlaying, setClipsPlaying, setFinish,
    setSquish, setSquishReach,
    get modelRoot() { return modelRoot; },
    get finish() { return finish; },
    get squish() { return squishWanted; },
    get squishReach() { return squishReach; },
    get animation() { return animation; },
    get animationSpeed() { return animationSpeed; },
    get hasClips() { return clips.length > 0; },
    get clipsPlaying() { return Boolean(mixer); },
    get autoRotate() { return controls.autoRotate; },
    get lightingPreset() { return lightingPreset; },
    get axisOrder() { return axisOrder; },
    get gridVisible() { return grid.visible; },
    get shadows() { return keyLight.castShadow; }
  };
}
