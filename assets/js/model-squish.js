/* Squish — grab the model, pull it out of shape, watch it spring back.
 *
 * Loaded on demand by model-scene.js the first time the 3D Model Viewer turns
 * squish on, so nothing here is downloaded by a page that only shows a model.
 *
 * The model itself is never simulated. A model can be three thousand triangles
 * or three hundred thousand, it can arrive welded or as loose triangles (STL
 * and OBJ have no shared vertices at all, so there are no edges to hang springs
 * from), and a hollow imported shell with springs only on its surface crumples
 * rather than wobbles. So the springs go in a cage instead: a 5x5x5 grid of
 * control points around the model, simulated on the CPU, with the mesh carried
 * along by trilinear interpolation of the cage in the vertex shader.
 *
 * That buys three things. The simulation costs the same whatever the model is —
 * 125 points and 300 links. The mesh deformation is free, because it happens on
 * the GPU. And the movement is real rather than canned: displacement spreads
 * through the links, so the far side of the model lags, overshoots and ripples
 * on its way back to rest.
 *
 * Everything here happens in "lattice space", which is the model holder's own
 * coordinates — the space the model is normalised into. The idle animations
 * move the holder rather than what is inside it, so a model can hover and be
 * squished at the same time without the cage having to follow it about.
 */
import * as THREE from 'three';

/* Nine points per axis puts a cell at an eighth of the model, which is what
 * makes a pinch possible: a grab has to be able to take hold of a patch of the
 * surface without the whole body coming with it, and a coarse cage can only
 * move the model as a lump. Nine is a compromise — finer pinches finer, and
 * costs more of both the frame and the upload. */
const SIZE = 9;
const POINTS = SIZE * SIZE * SIZE;
/* The cage is handed to the GPU as an RGBA texture, so the simulation works in
   fours and ignores the fourth. */
const STRIDE = 4;

/* The lattice is a discrete wave equation: every point is pulled back towards
 * where it started, and towards its neighbours. The pull home decides how
 * quickly the shape returns, the pull between neighbours is what carries a
 * disturbance across the model as a ripple, and the damping decides how many
 * times it swings past before it settles. */
/* How far a pull spreads is sqrt(LINK / HOME) in cells — the length over which
 * neighbours can drag each other before being pulled home instead. Around a
 * cell and a half keeps a pinch to the part of the model being pinched, while
 * still leaving enough coupling for the release to travel outwards as a ripple
 * rather than snapping back on the spot. */
const HOME_STIFFNESS = 60;
const LINK_STIFFNESS = 130;
const GRAB_STIFFNESS = 700;
const DAMPING = 2.0;                  // per second

/* A fixed step keeps the springs behaving the same on a 144Hz screen as on a
 * 30Hz one. The cap stops a long stall (a background tab, a slow load) from
 * trying to catch up all at once, but it has to be generous enough that an
 * ordinary slow frame still advances the springs by a whole frame's worth —
 * set too tight, the wobble plays in slow motion on exactly the machines that
 * can least afford a long one. Ten steps covers a frame rate down to 12fps. */
const STEP = 1 / 120;
const MAX_STEPS = 10;

/* Close enough to home to stop asking for frames. Both are fractions of the
   model's own size, since lattice space is whatever units the file was drawn
   in — millimetres for a CAD part, metres for a scanned one. */
const SETTLED_OFFSET = 0.001;
const SETTLED_SPEED = 0.01;

/* How much of the model comes with the pointer, and how far it can be taken,
 * as fractions of the model's size. The reach is the pinch itself: a fifth of
 * the model, so what lifts is a patch rather than the whole thing. */
const GRAB_REACH = 0.2;
const GRAB_LIMIT = 0.5;

/* The cage moves vertices, so it can only show detail the model already has: a
 * flat CAD face is two big triangles with nothing between their corners to
 * lift, and a pinch in the middle of one would do nothing at all. So the model
 * is subdivided as squish takes hold of it, until a triangle is smaller than
 * the patch a pinch acts over, and put back as it was when squish lets go.
 * The budget is what stops that from being a problem on a model that arrives
 * finely triangulated already — those need no subdividing anyway. */
const TARGET_EDGE = 0.5;              // of a cage cell
const MAX_LEVELS = 3;
const TRIANGLE_BUDGET = 260000;

const index = (x, y, z) => x + SIZE * (y + SIZE * z);

/* ------------------------------------------------------------------- shader */

/* Injected into whatever material the mesh is wearing, which changes under us:
 * a GLB brings its own, a STEP assembly brings an array of them, and the
 * Material menu swaps the lot for a single clay or chrome one.
 *
 * `squishSample` reads the cage the way the CPU wrote it and returns both the
 * offset at a point and the gradient of that offset. The gradient is what keeps
 * the shading honest: stretch a surface and its normals are wrong unless they
 * are carried through the inverse transpose of the local Jacobian, and for
 * trilinear interpolation that falls out of the same eight corners the offset
 * came from. */
const PRELUDE = /* glsl */`
/* A cage this size is far past the number of uniform vectors a vertex shader
   is guaranteed, so it travels as a 3D texture and is read a corner at a time —
   no filtering, because the interpolation below has to hand back its own
   gradient as well as its value. */
uniform highp sampler3D squishField;
uniform vec3 squishMin;
uniform vec3 squishScale;
uniform mat4 squishToLattice;

vec3 squishCorner(ivec3 cell) {
  return texelFetch(squishField, cell, 0).xyz;
}

vec3 squishSample(vec3 lat, out mat3 gradient) {
  vec3 t = clamp((lat - squishMin) * squishScale, vec3(0.0), vec3(float(${SIZE - 1}) - 1e-4));
  ivec3 cell = ivec3(floor(t));
  vec3 f = t - vec3(cell);

  vec3 o0 = squishCorner(cell);
  vec3 o1 = squishCorner(cell + ivec3(1, 0, 0));
  vec3 o2 = squishCorner(cell + ivec3(0, 1, 0));
  vec3 o3 = squishCorner(cell + ivec3(1, 1, 0));
  vec3 o4 = squishCorner(cell + ivec3(0, 0, 1));
  vec3 o5 = squishCorner(cell + ivec3(1, 0, 1));
  vec3 o6 = squishCorner(cell + ivec3(0, 1, 1));
  vec3 o7 = squishCorner(cell + ivec3(1, 1, 1));

  vec3 x00 = mix(o0, o1, f.x);
  vec3 x10 = mix(o2, o3, f.x);
  vec3 x01 = mix(o4, o5, f.x);
  vec3 x11 = mix(o6, o7, f.x);
  vec3 y0 = mix(x00, x10, f.y);
  vec3 y1 = mix(x01, x11, f.y);

  vec3 dX = mix(mix(o1 - o0, o3 - o2, f.y), mix(o5 - o4, o7 - o6, f.y), f.z);
  vec3 dY = mix(x10 - x00, x11 - x01, f.z);
  vec3 dZ = y1 - y0;
  gradient = mat3(dX * squishScale.x, dY * squishScale.y, dZ * squishScale.z);

  return mix(y0, y1, f.z);
}
`;

/* A mesh's own coordinates reach lattice space through its world matrix, which
 * differs per mesh while the material may be shared by all of them — so the
 * conversion is done per vertex from the built-in modelMatrix rather than
 * handed in as a uniform. */
const TO_LATTICE = /* glsl */`
  mat3 squishBasis = mat3(squishToLattice) * mat3(modelMatrix);
`;

/* Both blocks land in the same main(), so each keeps its temporaries to itself
   and only reaches out to the one variable it is there to change. */
const POSITION_CODE = /* glsl */`
  {
    ${TO_LATTICE}
    mat3 squishGradient;
    vec3 squishOffset = squishSample(
      (squishToLattice * modelMatrix * vec4(transformed, 1.0)).xyz, squishGradient);
    transformed += inverse(squishBasis) * squishOffset;
  }
`;

/* Normals are handled from `position` rather than `transformed`, because three
 * settles them before it settles positions. The two are the same for every mesh
 * that is not skinned, which is every mesh the CAD formats produce. */
const NORMAL_CODE = /* glsl */`
  {
    ${TO_LATTICE}
    mat3 squishGradient;
    squishSample((squishToLattice * modelMatrix * vec4(position, 1.0)).xyz, squishGradient);
    vec3 squishNormal = transpose(inverse(squishBasis)) * objectNormal;
    squishNormal = transpose(inverse(mat3(1.0) + squishGradient)) * squishNormal;
    objectNormal = normalize(transpose(squishBasis) * squishNormal);
  }
`;


/* ------------------------------------------------------------ tessellation */

/* One round of midpoint subdivision: every triangle becomes four. Geometry is
 * taken apart into loose triangles first, which every attribute then follows
 * blindly — no shared vertices to reconcile, no topology to rebuild, and it is
 * the form STL and OBJ arrive in anyway. Groups scale with it, since each
 * triangle keeps its place in the order and simply occupies four times the
 * room, which is what keeps a STEP assembly's per-face colours where they
 * belong. */
function subdivideOnce(geometry) {
  const out = new THREE.BufferGeometry();
  Object.keys(geometry.attributes).forEach(name => {
    const source = geometry.attributes[name];
    const size = source.itemSize;
    const triangles = source.count / 3;
    const from = source.array;
    const into = new Float32Array(triangles * 12 * size);
    /* corner a, b, c and the midpoints of ab, bc and ca, emitted as the four
       triangles they make: three at the corners and one in the middle */
    const order = [0, 3, 5, 3, 1, 4, 5, 4, 2, 3, 4, 5];
    const corner = new Float32Array(6 * size);
    let write = 0;
    for (let t = 0; t < triangles; t += 1) {
      const base = t * 3 * size;
      for (let part = 0; part < size; part += 1) {
        const a = from[base + part];
        const b = from[base + size + part];
        const c = from[base + size * 2 + part];
        corner[part] = a;
        corner[size + part] = b;
        corner[size * 2 + part] = c;
        corner[size * 3 + part] = (a + b) / 2;
        corner[size * 4 + part] = (b + c) / 2;
        corner[size * 5 + part] = (c + a) / 2;
      }
      for (let slot = 0; slot < order.length; slot += 1) {
        for (let part = 0; part < size; part += 1) {
          into[write + part] = corner[order[slot] * size + part];
        }
        write += size;
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(into, size));
  });

  /* An averaged normal is not a unit one. */
  const normals = out.getAttribute('normal');
  if (normals) {
    const value = new THREE.Vector3();
    for (let i = 0; i < normals.count; i += 1) {
      value.fromBufferAttribute(normals, i).normalize();
      normals.setXYZ(i, value.x, value.y, value.z);
    }
  }
  geometry.groups.forEach(group =>
    out.addGroup(group.start * 4, group.count * 4, group.materialIndex));
  return out;
}

/* How many rounds this geometry wants: enough that its triangles come out
   under `target`, within the budget it has been given. */
function subdivisionLevels(geometry, target, budget) {
  const position = geometry.getAttribute('position');
  const triangles = position.count / 3;
  if (!triangles) return 0;

  /* A sample is enough to size the model's triangles, and keeps a large one
     from being walked twice over. */
  const step = Math.max(1, Math.floor(triangles / 200));
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let total = 0;
  let taken = 0;
  for (let t = 0; t < triangles; t += step) {
    a.fromBufferAttribute(position, t * 3);
    b.fromBufferAttribute(position, t * 3 + 1);
    c.fromBufferAttribute(position, t * 3 + 2);
    total += Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    taken += 1;
  }
  const longest = total / Math.max(taken, 1);
  let levels = Math.ceil(Math.log2(Math.max(longest / target, 1)));
  levels = Math.min(Math.max(levels, 0), MAX_LEVELS);
  while (levels > 0 && triangles * 4 ** levels > budget) levels -= 1;
  return levels;
}

/* ---------------------------------------------------------------- the thing */

export function createSquish({ camera, renderer, controls, render, wake }) {
  /* Offsets from rest, and their velocities, both in lattice space. The offsets
     array is handed to the GPU as it stands, so the simulation writes straight
     into the uniform. */
  const offsets = new Float32Array(POINTS * STRIDE);
  const velocities = new Float32Array(POINTS * STRIDE);
  /* The state every force in a step is measured against. Reading neighbours
     straight out of `offsets` while the same pass is writing them makes a
     point's force depend on where it sits in the loop, which quietly feeds
     energy into the springs until the model flies apart — so a step is worked
     out entirely from the state it started in. */
  const previous = new Float32Array(POINTS * STRIDE);
  const home = new Float32Array(POINTS * STRIDE);   // where each control point rests
  const weights = new Float32Array(POINTS);    // how hard the current grab pulls each one

  /* The simulation writes straight into the texture's own buffer, so a step
     costs no copy — only the upload the flag below asks for. */
  const field = new THREE.Data3DTexture(offsets, SIZE, SIZE, SIZE);
  field.format = THREE.RGBAFormat;
  field.type = THREE.FloatType;
  field.minFilter = THREE.NearestFilter;
  field.magFilter = THREE.NearestFilter;
  field.needsUpdate = true;

  const uniforms = {
    squishField: { value: field },
    squishMin: { value: new THREE.Vector3() },
    squishScale: { value: new THREE.Vector3(1, 1, 1) },
    squishToLattice: { value: new THREE.Matrix4() }
  };

  /* The shadow is drawn from a separate depth pass, which knows nothing about a
     material's own vertex work — so it needs the same deformation, or the model
     stretches while its shadow stays put. */
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

  const prepared = new Map();     // material -> the onBeforeCompile it had before
  let modelRoot = null;
  let enabled = false;
  let moving = false;             // the springs still have somewhere to go
  let leftover = 0;               // simulation time carried between frames

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane();
  const toLattice = new THREE.Matrix4();
  let grabbing = false;
  let grabPointer = null;
  const grabPoint = new THREE.Vector3();       // where the model was taken hold of, in world space
  const grabDrag = new THREE.Vector3();        // how far it has been pulled, in lattice space
  const scratch = new THREE.Vector3();
  const scratchTwo = new THREE.Vector3();

  /* ---- materials ---- */

  function inject(shader) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = PRELUDE + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      `${POSITION_CODE}\n#include <project_vertex>`);
    /* the depth pass has no normals to correct */
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\n${NORMAL_CODE}`);
    }
  }

  function prepareMaterial(entry) {
    if (!entry || prepared.has(entry)) return;
    prepared.set(entry, entry.onBeforeCompile);
    entry.onBeforeCompile = shader => {
      prepared.get(entry)?.call(entry, shader, renderer);
      inject(shader);
    };
    entry.needsUpdate = true;
  }

  /* Called for each mesh whenever materials land on it — a model loading, or a
     finish being swapped in over the top. */
  function prepare(mesh) {
    if (!enabled) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach(prepareMaterial);
    mesh.customDepthMaterial = depthMaterial;
  }

  /* Subdivision is spent on the meshes with the coarsest triangles first, so a
     model that is one fine part and one flat plate puts its budget where it
     shows. Each mesh keeps the geometry it arrived with, to go back to. */
  function tessellate(cell) {
    /* Only while squish is switched on: a model that is merely being looked at
       keeps the triangles it was loaded with. */
    if (!enabled || !modelRoot) return;
    const meshes = [];
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      /* skin indices are references, not quantities, and cannot be averaged */
      if (object.geometry.getAttribute('skinIndex')) return;
      meshes.push(object);
    });

    let budget = TRIANGLE_BUDGET;
    meshes.forEach(mesh => {
      const original = mesh.geometry;
      const loose = original.index ? original.toNonIndexed() : original;
      const share = Math.max(Math.floor(budget / Math.max(meshes.length, 1)), 0);
      const levels = subdivisionLevels(loose, cell * TARGET_EDGE, share);
      if (levels === 0 && loose === original) return;

      let geometry = loose;
      for (let round = 0; round < levels; round += 1) {
        const next = subdivideOnce(geometry);
        if (geometry !== loose) geometry.dispose();
        geometry = next;
      }
      if (loose !== original && geometry !== loose) loose.dispose();
      budget -= geometry.getAttribute('position').count / 3;
      mesh.userData.squishGeometry = original;
      mesh.geometry = geometry;
    });
  }

  /* Puts back the geometry each mesh arrived with. */
  function detessellate() {
    modelRoot?.traverse(object => {
      const original = object.userData?.squishGeometry;
      if (!original) return;
      object.geometry.dispose();
      object.geometry = original;
      delete object.userData.squishGeometry;
    });
  }

  function release() {
    detessellate();
    prepared.forEach((original, entry) => {
      entry.onBeforeCompile = original || function () {};
      entry.needsUpdate = true;
    });
    prepared.clear();
    modelRoot?.traverse(object => {
      if (object.isMesh) object.customDepthMaterial = undefined;
    });
  }

  /* ---- the cage ---- */

  /* Sized from the model's own bounds rather than the scene's, measured in the
     holder's coordinates so the idle animations cannot move it. */
  function reset(root) {
    detessellate();
    modelRoot = root || null;
    offsets.fill(0);
    velocities.fill(0);
    field.needsUpdate = true;
    moving = false;
    grabbing = false;
    if (!modelRoot) return;

    const box = new THREE.Box3();
    const worldToLocal = new THREE.Matrix4().copy(modelRoot.matrixWorld).invert();
    const local = new THREE.Matrix4();
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      local.multiplyMatrices(worldToLocal, object.matrixWorld);
      box.union(object.geometry.boundingBox.clone().applyMatrix4(local));
    });
    if (box.isEmpty()) return;

    /* A little air around the model keeps every vertex strictly inside the cage,
       where the interpolation is defined. */
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.03);
    box.expandByVector(size.max(new THREE.Vector3(0.5, 0.5, 0.5)));

    const span = box.getSize(new THREE.Vector3());
    tessellate(Math.max(span.x, span.y, span.z) / (SIZE - 1));
    uniforms.squishMin.value.copy(box.min);
    uniforms.squishScale.value.set(
      (SIZE - 1) / Math.max(span.x, 1e-4),
      (SIZE - 1) / Math.max(span.y, 1e-4),
      (SIZE - 1) / Math.max(span.z, 1e-4));

    for (let z = 0; z < SIZE; z += 1) {
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const at = index(x, y, z) * STRIDE;
          home[at] = box.min.x + span.x * (x / (SIZE - 1));
          home[at + 1] = box.min.y + span.y * (y / (SIZE - 1));
          home[at + 2] = box.min.z + span.z * (z / (SIZE - 1));
        }
      }
    }
    reach = Math.max(span.x, span.y, span.z);
  }

  let reach = 80;

  /* ---- simulation ---- */

  function integrate(dt) {
    const damp = Math.exp(-DAMPING * dt);
    previous.set(offsets);
    for (let z = 0; z < SIZE; z += 1) {
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const here = index(x, y, z);
          const at = here * STRIDE;
          /* The pull between neighbours is on the difference of their offsets,
             which is a Laplacian: linear, unconditionally well behaved, and
             exactly the term that carries a wave across the cage. */
          let lx = 0;
          let ly = 0;
          let lz = 0;
          for (let axis = 0; axis < 3; axis += 1) {
            for (let step = -1; step <= 1; step += 2) {
              const nx = x + (axis === 0 ? step : 0);
              const ny = y + (axis === 1 ? step : 0);
              const nz = z + (axis === 2 ? step : 0);
              if (nx < 0 || ny < 0 || nz < 0 || nx >= SIZE || ny >= SIZE || nz >= SIZE) continue;
              const near = index(nx, ny, nz) * STRIDE;
              lx += previous[near] - previous[at];
              ly += previous[near + 1] - previous[at + 1];
              lz += previous[near + 2] - previous[at + 2];
            }
          }

          let fx = LINK_STIFFNESS * lx - HOME_STIFFNESS * previous[at];
          let fy = LINK_STIFFNESS * ly - HOME_STIFFNESS * previous[at + 1];
          let fz = LINK_STIFFNESS * lz - HOME_STIFFNESS * previous[at + 2];

          if (grabbing && weights[here] > 0) {
            const pull = GRAB_STIFFNESS * weights[here];
            fx += pull * (grabDrag.x - previous[at]);
            fy += pull * (grabDrag.y - previous[at + 1]);
            fz += pull * (grabDrag.z - previous[at + 2]);
          }

          velocities[at] = (velocities[at] + fx * dt) * damp;
          velocities[at + 1] = (velocities[at + 1] + fy * dt) * damp;
          velocities[at + 2] = (velocities[at + 2] + fz * dt) * damp;
          offsets[at] += velocities[at] * dt;
          offsets[at + 1] += velocities[at + 1] * dt;
          offsets[at + 2] += velocities[at + 2] * dt;
        }
      }
    }
  }

  function runaway() {
    const limit = reach * 4;
    for (let i = 0; i < offsets.length; i += 1) {
      if (!Number.isFinite(offsets[i]) || Math.abs(offsets[i]) > limit) return true;
    }
    return false;
  }

  function settled() {
    const stillness = reach * SETTLED_OFFSET;
    const slowness = reach * SETTLED_SPEED;
    for (let i = 0; i < offsets.length; i += 1) {
      if (Math.abs(offsets[i]) > stillness || Math.abs(velocities[i]) > slowness) return false;
    }
    return true;
  }

  function update(delta) {
    if (!enabled || !modelRoot || !moving) return;
    /* The cage is written in the holder's coordinates, so the shader is told
       where that is each frame — the idle animations move it about. */
    uniforms.squishToLattice.value.copy(modelRoot.matrixWorld).invert();

    leftover = Math.min(leftover + delta, MAX_STEPS * STEP);
    while (leftover >= STEP) {
      integrate(STEP);
      leftover -= STEP;
    }
    field.needsUpdate = true;
    if (!grabbing && settled()) {
      offsets.fill(0);
      velocities.fill(0);
      moving = false;
    } else if (runaway()) {
      /* Nothing should be able to push the springs this far, but a decorative
         effect must not be able to leave a model inside out either. */
      offsets.fill(0);
      velocities.fill(0);
    }
  }

  /* ---- grabbing ---- */

  function pointerAt(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    return pointer;
  }

  /* Where the pointer now sits on the plane the model was taken hold of on —
     facing the camera, so a drag moves the model across the view. */
  function dragTarget(event, into) {
    raycaster.setFromCamera(pointerAt(event), camera);
    return raycaster.ray.intersectPlane(plane, into);
  }

  function onPointerDown(event) {
    if (!enabled || !modelRoot || event.button !== 0) return;
    raycaster.setFromCamera(pointerAt(event), camera);
    /* Picking runs against the model as loaded, not as deformed: three's
       raycaster reads the geometry on the CPU, which the cage never touches. It
       agrees with what is on screen whenever the model is sitting still, which
       is when a grab normally starts. */
    const [hit] = raycaster.intersectObject(modelRoot, true);
    if (!hit) return;

    grabbing = true;
    moving = true;
    grabPointer = event.pointerId;
    grabPoint.copy(hit.point);
    grabDrag.set(0, 0, 0);
    plane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(scratch).negate(), grabPoint);

    /* Everything within reach of the grab comes with it, and less so the
       further out it is; the rest of the cage is left to be dragged along by
       its neighbours, which is what stretches the model. */
    toLattice.copy(modelRoot.matrixWorld).invert();
    const held = scratchTwo.copy(grabPoint).applyMatrix4(toLattice);
    const radius = reach * GRAB_REACH;
    for (let i = 0; i < POINTS; i += 1) {
      const distance = Math.hypot(
        home[i * STRIDE] - held.x,
        home[i * STRIDE + 1] - held.y,
        home[i * STRIDE + 2] - held.z);
      const near = Math.max(0, 1 - distance / radius);
      weights[i] = near * near;
    }

    renderer.domElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    wake();
  }

  function onPointerMove(event) {
    if (!grabbing || event.pointerId !== grabPointer) return;
    if (!dragTarget(event, scratch)) return;
    /* Measured between two points rather than rotated as a direction, so the
       holder's scale is accounted for. */
    grabDrag.copy(scratch).applyMatrix4(toLattice)
      .sub(scratchTwo.copy(grabPoint).applyMatrix4(toLattice));
    const limit = reach * GRAB_LIMIT;
    if (grabDrag.length() > limit) grabDrag.setLength(limit);
    moving = true;
    wake();
  }

  function onPointerUp(event) {
    if (!grabbing || event.pointerId !== grabPointer) return;
    grabbing = false;
    grabPointer = null;
    /* Let go and nothing holds the cage out of shape any more: the links carry
       it back past rest, and the ripple is the overshoot. */
  }

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
    ['lostpointercapture', onPointerUp]
  ];

  /* Left-drag is the orbit control, and it is also the obvious way to take hold
     of something, so squish borrows it and orbiting moves to the right button
     for as long as it is on. */
  let heldButtons = null;

  function enable() {
    if (enabled) return;
    enabled = true;
    heldButtons = { ...controls.mouseButtons };
    controls.mouseButtons = { ...controls.mouseButtons, LEFT: null, RIGHT: THREE.MOUSE.ROTATE };
    listeners.forEach(([type, handler]) =>
      renderer.domElement.addEventListener(type, handler));
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    grabbing = false;
    listeners.forEach(([type, handler]) =>
      renderer.domElement.removeEventListener(type, handler));
    if (heldButtons) controls.mouseButtons = heldButtons;
    heldButtons = null;
    offsets.fill(0);
    velocities.fill(0);
    field.needsUpdate = true;
    moving = false;
    release();
    render();
  }

  function dispose() {
    disable();
    depthMaterial.dispose();
    field.dispose();
  }

  return {
    prepare, reset, update, enable, disable, dispose,
    get busy() { return enabled && moving; },
    get grabbing() { return grabbing; }
  };
}
