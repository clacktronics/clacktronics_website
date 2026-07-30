/* Inline 3D models in markdown pages.
 *
 * The `@[model](path/to/part.stl "Caption"){options}` directive renders a
 * placeholder (see modelEmbed() in clackos.js and model_embed() in
 * scripts/build_plain_site.py); this module turns each placeholder into a live
 * viewport built on the shared core in model-scene.js — the same loaders,
 * lighting rig and palette the 3D Model Viewer application uses.
 *
 * The module hydrates whatever is already on the page and watches for more, so
 * it works on the static mirror and inside ClackOS windows, which mount their
 * markdown long after the script loads. Viewports are only built once they are
 * near the viewport, and they stop rendering when they scroll away.
 */
import { createModelScene, axisOrderFor, THREE } from './model-scene.js';

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const flag = (element, name, fallback) => {
  const value = element.dataset[name];
  return value === undefined ? fallback : value === 'true';
};

function statusLine(stage, text, error = false) {
  let line = stage.querySelector('.model-embed-status');
  if (!text) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement('p');
    line.className = 'model-embed-status';
    line.setAttribute('role', 'status');
    stage.appendChild(line);
  }
  line.classList.toggle('error', error);
  line.textContent = text;
}

async function hydrate(stage) {
  const src = stage.dataset.modelSrc;
  if (!src) return;

  const background = stage.dataset.background || '';
  const transparent = !background || background === 'none';
  /* zoom is a plain multiplier for the author: >1 fills more of the frame. */
  const viewer = createModelScene(stage, {
    transparent,
    fitMargin: 1.18 / Math.min(Math.max(number(stage.dataset.zoom, 1), 0.2), 4)
  });
  if (!transparent) viewer.setColour('background', background);
  const colourOptions = { model: 'colour', grid: 'gridcolour', key: 'key', fill: 'fill', sky: 'sky', ground: 'ground' };
  Object.entries(colourOptions).forEach(([key, option]) => {
    const value = stage.dataset[option];
    if (value) viewer.setColour(key, value);
  });
  viewer.setGridVisible(flag(stage, 'grid', false));
  viewer.setShadows(flag(stage, 'shadows', true));
  viewer.setLightingPreset(stage.dataset.lighting || 'studio');
  viewer.setBrightness(number(stage.dataset.brightness, 100) / 100);

  /* Inline viewers keep out of the reader's way: dragging orbits the model, but
     the wheel and one-finger touch stay with the page unless the page author
     asked for the full control set. */
  const interaction = stage.dataset.controls || 'orbit';
  const { controls } = viewer;
  if (interaction === 'none') {
    controls.enabled = false;
    viewer.renderer.domElement.style.pointerEvents = 'none';
  } else if (interaction !== 'full') {
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.touches.ONE = null;
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
    viewer.renderer.domElement.style.touchAction = 'pan-y';
  }

  /* {animation=hover} picks one by name; {spin}/{nospin} are the older, shorter
     way of asking for the turntable or for nothing. */
  const animation = stage.dataset.animation
    || (flag(stage, 'rotate', true) ? 'turntable' : 'none');
  const speed = number(stage.dataset.speed, 0.9);

  const themeChanged = () => viewer.refreshTheme();
  window.addEventListener('clackos-themechange', themeChanged);
  const resizes = new ResizeObserver(() => viewer.resize());
  resizes.observe(stage);

  /* Animating off-screen burns frames for nothing, so the loop follows
     visibility — paused rather than stopped, so a model's own animation carries
     on from where it was rather than restarting on every scroll past.
     Hydration starts a screen early, so an embed can finish loading before it
     is actually in view. */
  viewer.setPlaying(false);
  const visibility = new IntersectionObserver(entries => {
    viewer.setPlaying(entries[entries.length - 1].isIntersecting);
  });
  visibility.observe(stage);

  stage.modelEmbedDispose = () => {
    window.removeEventListener('clackos-themechange', themeChanged);
    resizes.disconnect();
    visibility.disconnect();
    viewer.dispose();
  };

  statusLine(stage, 'Loading model…');
  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = await viewer.parse(await response.arrayBuffer(), src,
      message => statusLine(stage, message));
    /* Z-up formats are turned as they load; {axes=…} overrides that. */
    viewer.setAxisOrder(stage.dataset.axes || axisOrderFor(src), { refit: false });
    viewer.setModel(parsed.root, { animations: parsed.animations });
    viewer.setWireframe(flag(stage, 'wireframe', false));
    viewer.setAnimation(animation, speed);
    statusLine(stage, '');
    stage.dataset.modelState = 'ready';
  } catch (error) {
    console.error(error);
    statusLine(stage, 'This model could not be loaded.', true);
    stage.dataset.modelState = 'error';
  }
}

/* Placeholders start hydrating a screen before they are reached, so the model
   is usually there by the time it is scrolled to. */
const pending = new IntersectionObserver((entries, observer) => {
  entries.filter(entry => entry.isIntersecting).forEach(entry => {
    observer.unobserve(entry.target);
    hydrate(entry.target);
  });
}, { rootMargin: '200px' });

function claim(stage) {
  if (stage.dataset.modelState) return;
  stage.dataset.modelState = 'pending';
  pending.observe(stage);
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches?.('.model-embed-stage')) claim(root);
  root.querySelectorAll?.('.model-embed-stage').forEach(claim);
}

/* Windows are torn down by replacing their body, which leaves orphaned WebGL
   contexts behind; browsers only allow a handful of those at a time. */
function release(root) {
  if (root.nodeType !== 1) return;
  const stages = [...(root.matches?.('.model-embed-stage') ? [root] : []),
                  ...(root.querySelectorAll?.('.model-embed-stage') || [])];
  stages.forEach(stage => {
    if (stage.isConnected) return;
    pending.unobserve(stage);
    stage.modelEmbedDispose?.();
  });
}

scan(document.body);
new MutationObserver(records => records.forEach(record => {
  record.addedNodes.forEach(scan);
  record.removedNodes.forEach(release);
})).observe(document.body, { childList: true, subtree: true });
