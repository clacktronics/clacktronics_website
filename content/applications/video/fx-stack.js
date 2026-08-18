/* The effect stack: what is applied to every frame, in what order, and the
 * panel that edits it.
 *
 * Two libraries supply the filters and they describe their controls
 * differently — ClackPaint's filters call a control `{ id, value }` and the
 * dithers call the same thing `{ key, default }` — so both are normalised to
 * one shape here and one renderer draws them. That is the only reason this
 * file knows anything about either: the maths is theirs, the layout is ours.
 *
 * Values are held exactly as the controls give them, strings and all. The
 * dithers want their own normalise() run over them before the algorithms see
 * them and the worker does that on the way in, so what is stored stays the
 * same shape as what a saved stack would carry.
 */

import {
  MOTION_KINDS, motionCatalogue, isMotion, readTarget, targetOptions, targetField, useFieldLookup
} from './fx-motion.js';

const FX = () => globalThis.ClackFX;
const DITHER = () => globalThis.ClackDither;

/* A ClackPaint filter control and a dither control, flattened into the same
   thing. `when` survives only on the ClackPaint side, which is where it
   exists — it is what hides the twenty Pixel Sorting controls that do not
   apply to the method chosen. */
const fromEffectField = field => ({ ...field, id: field.id, value: field.value });
const fromDitherParam = param => ({
  id: param.key, label: param.label, type: param.type, options: param.options,
  min: param.min, max: param.max, step: param.step, unit: param.unit, value: param.default
});

/* Background removal. The maths is paint-matte.js, shared with ClackPaint, but
   the controls are described here rather than imported: ClackPaint's own list
   carries advice about layers and selections that means nothing over video,
   and video needs the two things a still does not — something to put where the
   background was, and a warning about what happens frame to frame.

   Only the methods that judge a frame on its own are offered. GrowCut needs
   scribbles on the picture and difference matting needs a second layer;
   neither has an answer for frame four hundred. */
const MATTE_METHODS = [
  {
    id: 'chroma',
    title: 'Remove Background — Chroma key',
    help: 'Keys out one colour by hue alone, ignoring brightness, so a shadow falling across the screen goes with it. The right tool for video: it judges each pixel on its own, so it does not crawl from frame to frame the way a cleverer method would.',
    params: [
      { id: 'key', label: 'Key colour', type: 'colour', value: '#00b140' },
      { id: 'tolerance', label: 'Tolerance', type: 'range', min: 1, max: 100, value: 35, step: 1 }
    ]
  },
  {
    id: 'colour-range',
    title: 'Remove Background — Colour range',
    help: 'Every pixel near one colour goes, wherever it is in the frame. Brightness counts here, unlike the chroma key — what you want for a white sweep, not for a green screen.',
    params: [
      { id: 'key', label: 'Background colour', type: 'colour', value: '#ffffff' },
      { id: 'tolerance', label: 'Tolerance', type: 'range', min: 1, max: 100, value: 25, step: 1 }
    ]
  },
  {
    id: 'border-flood',
    title: 'Remove Background — Flood from the edges',
    help: 'A magic wand run from all four edges at once, so the sky behind the subject goes and the identical blue of their shirt stays. Connectedness can change between frames, so check a filtered clip end to end rather than one frame of it.',
    params: [
      { id: 'tolerance', label: 'Tolerance', type: 'range', min: 1, max: 100, value: 20, step: 1 }
    ]
  },
  {
    id: 'brightness',
    title: 'Remove Background — By brightness',
    help: 'Keeps the light and drops the dark, or the other way about. For a subject lit against a black studio, or a silhouette.',
    params: [
      { id: 'background', label: 'Background is', type: 'select', value: 'dark',
        options: [['dark', 'Dark'], ['light', 'Light']] }
    ]
  },
  {
    id: 'saliency',
    title: 'Remove Background — What stands out',
    help: 'Measures how far each pixel sits from the average colour of the whole frame; what stands out is what is left. Works when one subject stands clear of a settled background, and not at all on a busy one.',
    params: []
  }
];

/* Every method ends the same way — a ramp turned into a cut, and something put
   where the background was — so those controls are appended to all of them. */
const MATTE_SHAPING = [
  { id: 'cutoff', label: 'Cutoff', type: 'range', min: 0, max: 100, value: 50, step: 1, unit: '%' },
  { id: 'softness', label: 'Edge softness', type: 'range', min: 1, max: 100, value: 30, step: 1, unit: '%' },
  { id: 'invert', label: 'Keep the background instead', type: 'check', value: false },
  { id: 'output', label: 'Background becomes', type: 'select', value: 'fill',
    options: [['fill', 'A flat colour'], ['transparent', 'Transparent']] },
  { id: 'fillColour', label: 'Fill colour', type: 'colour', value: '#00b140',
    when: values => values.output !== 'transparent' }
];

export function catalogue() {
  const effects = Object.entries(FX()?.EFFECTS || {}).map(([id, config]) => ({
    kind: `fx:${id}`,
    title: config.title,
    help: config.help || '',
    fields: (config.fields || []).map(fromEffectField),
    livePixels: config.livePixels
  }));
  const dithers = Object.entries(DITHER()?.GROUPS || {}).map(([id, group]) => ({
    kind: `dither:${id}`,
    title: `${group.label} Dither`,
    help: group.hint || '',
    fields: DITHER().params(id).map(fromDitherParam)
  }));
  const mattes = MATTE_METHODS.map(method => ({
    kind: `matte:${method.id}`,
    title: method.title,
    help: method.help,
    fields: [...method.params, ...MATTE_SHAPING]
  }));
  return { effects, dithers, mattes, motions: motionCatalogue() };
}

const byKind = new Map();
function entryFor(kind) {
  if (!byKind.size) {
    const { effects, dithers, mattes, motions } = catalogue();
    for (const item of [...effects, ...dithers, ...mattes, ...motions]) byKind.set(item.kind, item);
  }
  return byKind.get(kind);
}

/* fx-motion works out what a motion card is aiming at, which means asking what
   controls the card at the other end has. It cannot reach the catalogue itself
   without the two files importing each other, so it is handed the lookup. */
useFieldLookup(kind => entryFor(kind)?.fields || []);

/* The Custom Matrix filter is the one control the dialog fills rather than the
   definition: its weights come from the identity kernel for the chosen size. */
function seedValues(item) {
  const values = {};
  for (const field of item.fields) {
    if (field.type === 'matrix') {
      const size = Number(values.size || item.fields.find(f => f.id === 'size')?.value || 3);
      values[field.id] = (FX().CUSTOM_KERNELS[size] || [1]).slice();
    } else if (field.value === 'min' || field.value === 'max') {
      /* a ramp starts life with nothing to span and is re-seeded from the
         target's own extremes the moment one is chosen */
      values[field.id] = 0;
    } else values[field.id] = field.value;
  }
  return values;
}

let nextId = 1;

export function makeEntry(kind) {
  const item = entryFor(kind);
  if (!item) return null;
  return { id: nextId += 1, kind, title: item.title, values: seedValues(item), bypass: false };
}

/* Two things about a motion card's controls cannot be written down in advance.
   Its target list is whatever else is in the stack, and a ramp's From and To
   are measured in the units of the parameter it is aimed at — degrees for an
   angle, percent for a threshold. Both are settled here, at the moment the row
   is drawn, against the stack as it stands. */
function resolveField(field, entry, stack) {
  if (typeof field.options === 'function') {
    return { ...field, options: field.options(stack, entry) };
  }
  if (field.type === 'target') {
    return { ...field, type: 'select', options: [['', 'Choose a parameter…'], ...targetOptions(stack, entry)] };
  }
  if (field.range === 'target') {
    const aimed = targetField(stack, readTarget(entry.values.target));
    if (!aimed) return { ...field, type: 'range', min: 0, max: 100, step: 1 };
    const { min, max, step, unit, decimals } = aimed.field;
    return { ...field, type: 'range', min, max, step, unit, decimals };
  }
  return field;
}

/* Which controls a card is showing right now. ClackPaint's `when` predicates
   read the current values, so this has to be asked again after every change. */
export function visibleFields(entry, stack = []) {
  const item = entryFor(entry.kind);
  if (!item) return [];
  return item.fields
    .filter(field => typeof field.when !== 'function' || field.when(entry.values))
    .map(field => resolveField(field, entry, stack));
}

export function helpFor(entry) {
  return entryFor(entry.kind)?.help || '';
}

/* The pixel budget a live preview should stay under. Most filters are happy at
   the shared ceiling; Pixel Sorting and Sonification set their own far lower
   because they run their whole algorithm again per pass. Video wants headroom
   on top of all of that, because a preview that lands after the next frame is
   already wanted is no preview at all. */
export function previewBudget(stack) {
  const shared = FX()?.EFFECT_LIVE_PIXELS || 1_500_000;
  let budget = Math.min(shared, 480_000);
  for (const entry of stack) {
    if (entry.bypass || isMotion(entry.kind)) continue;
    const own = entryFor(entry.kind)?.livePixels;
    const value = typeof own === 'function' ? own(entry.values) : own;
    if (value) budget = Math.min(budget, value);
  }
  /* several filters in a row cost the sum of them; motion cards render nothing
     and so cost nothing */
  const active = stack.filter(entry => !entry.bypass && !isMotion(entry.kind)).length || 1;
  return Math.max(24_000, Math.round(budget / active));
}

/* ------------------------------------------------------------------ panel */

const labelOf = (field, values) =>
  typeof field.label === 'function' ? field.label(values) : field.label;

const formatValue = (field, value) => {
  if (field.type === 'check') return value ? 'on' : 'off';
  if (field.type === 'select') {
    const found = (field.options || []).find(([id]) => String(id) === String(value));
    return found ? found[1] : value;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${field.decimals ? number.toFixed(field.decimals) : number}${field.unit || ''}`;
};

function controlFor(entry, field, onChange, drivenBy = null) {
  const row = document.createElement('label');
  row.className = `fx-field${drivenBy ? ' patched' : ''}`;

  const caption = document.createElement('span');
  caption.className = 'fx-field-label';
  const name = document.createElement('span');
  /* A few controls rename themselves: Pixel Sorting's angle becomes "Ring cut"
     on a spin path and "Spiral cut" on a spiral one, so the label is a function
     of the other values rather than a string. */
  name.textContent = labelOf(field, entry.values);
  if (drivenBy) {
    const chip = document.createElement('span');
    chip.className = 'fx-wire-chip';
    chip.textContent = `⟳ ${drivenBy.join(', ')}`;
    chip.title = 'driven by a motion card';
    name.append(' ', chip);
  }
  const readout = document.createElement('output');
  readout.className = 'fx-field-value';
  caption.append(name, readout);

  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    for (const [value, label] of field.options || []) {
      const option = document.createElement('option');
      option.value = value; option.textContent = label;
      input.append(option);
    }
    input.value = entry.values[field.id];
  } else if (field.type === 'check') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!entry.values[field.id];
    row.classList.add('fx-field-check');
  } else if (field.type === 'colour') {
    input = document.createElement('input');
    input.type = 'color';
    input.value = entry.values[field.id];
    row.classList.add('fx-field-colour');
  } else if (field.type === 'matrix') {
    /* a grid of weights rather than one control */
    input = document.createElement('div');
    input.className = 'fx-matrix';
    const size = Number(entry.values.size || 3);
    const weights = entry.values[field.id] || [];
    input.style.setProperty('--fx-matrix-size', size);
    for (let i = 0; i < size * size; i += 1) {
      const cell = document.createElement('input');
      cell.type = 'number'; cell.step = '0.1';
      cell.value = weights[i] ?? 0;
      cell.addEventListener('input', () => {
        const next = (entry.values[field.id] || []).slice();
        next[i] = Number(cell.value) || 0;
        entry.values[field.id] = next;
        onChange();
      });
      input.append(cell);
    }
  } else {
    input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : 'range';
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    if (field.step !== undefined) input.step = field.step;
    input.value = entry.values[field.id];
  }

  /* Controls that say what they are without a readout: a colour swatch, a
     matrix of weights, and a target — which the select beneath it and the
     "drives" line above it already both name. */
  const quiet = field.type === 'matrix' || field.type === 'colour' || field.id === 'target';
  const sync = () => {
    if (field.type === 'check') entry.values[field.id] = input.checked;
    else if (field.type !== 'matrix') entry.values[field.id] = input.value;
    if (field.type === 'colour') readout.textContent = '';
    /* Custom Matrix changes shape when its size does */
    if (field.id === 'size' && entry.values.matrix) {
      const item = entryFor(entry.kind);
      entry.values.matrix = (FX().CUSTOM_KERNELS[Number(input.value)] || [1]).slice();
      void item;
    }
    if (!quiet) readout.textContent = formatValue(field, entry.values[field.id]);
    onChange();
  };
  if (field.type !== 'matrix') input.addEventListener('input', sync);
  readout.textContent = quiet ? '' : formatValue(field, entry.values[field.id]);

  /* A driven control keeps showing — and dragging — the value you set. The
     amber marker riding the track is what the motion has made of it this frame.
     Putting the motion on the thumb instead was the first idea and the wrong
     one: a thumb that runs away from the pointer cannot be adjusted. */
  if (field.type === 'range' || field.type === 'number') {
    row.dataset.field = field.id;
    const track = document.createElement('span');
    track.className = 'fx-track';
    const marker = document.createElement('span');
    marker.className = 'fx-live-marker';
    marker.hidden = true;
    track.append(input, marker);
    row.append(caption, track);
    row.dataset.min = field.min ?? 0;
    row.dataset.max = field.max ?? 100;
    row.dataset.unit = field.unit ?? '';
    /* a control that steps in whole numbers should not report two decimals
       just because the motion put it between two of them */
    row.dataset.decimals = field.decimals ?? (Number(field.step) < 1 ? 2 : 0);
    return row;
  }

  row.append(caption, input);
  return row;
}

/* Redrawing the whole list on every slider move would fight the pointer, so a
   value change only refreshes the rows whose visibility could have changed. */
export function renderStack(container, stack, handlers) {
  container.textContent = '';
  if (!stack.length) {
    const empty = document.createElement('p');
    empty.className = 'note fx-empty';
    empty.textContent = 'No effects. Add one and it runs on every frame — preview here, baked in on export.';
    container.append(empty);
    return;
  }

  /* which parameters are being driven, and by what — so a filter card can name
     the motion card moving each of its controls */
  const driven = new Map();
  for (const entry of stack) {
    if (entry.bypass || !isMotion(entry.kind)) continue;
    const target = readTarget(entry.values.target);
    if (!target) continue;
    const key = `${target.id}:${target.field}`;
    driven.set(key, [...(driven.get(key) || []), entry]);
  }
  const positionOf = entry => stack.indexOf(entry) + 1;

  stack.forEach((entry, index) => {
    const motion = isMotion(entry.kind);
    const card = document.createElement('div');
    card.className = `fx-card${entry.bypass ? ' bypassed' : ''}${motion ? ' motion' : ''}`;
    card.dataset.entry = entry.id;

    const head = document.createElement('div');
    head.className = 'fx-card-head';

    const title = document.createElement('span');
    title.className = 'fx-card-title';
    title.textContent = `${motion ? '⟳ ' : ''}${index + 1}. ${entry.title}`;

    const buttons = document.createElement('span');
    buttons.className = 'fx-card-buttons';
    const button = (content, label, disabled, action) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'icon-btn small';
      element.title = label;
      element.setAttribute('aria-label', `${label}: ${entry.title}`);
      element.disabled = !!disabled;
      element.innerHTML = content;
      element.addEventListener('click', action);
      return element;
    };
    const icon = name => `<span class="pixel-icon" data-icon="${name}" aria-hidden="true"></span>`;
    /* The icon set has no vertical arrows, and the menu bar already writes its
       fly-out arrow as a character, so order is moved with two of those. */
    const glyph = mark => `<span class="fx-glyph" aria-hidden="true">${mark}</span>`;
    buttons.append(
      button(icon(entry.bypass ? 'eye-off' : 'eye'), entry.bypass ? 'Switch on' : 'Switch off', false,
        () => handlers.onBypass(entry)),
      button(glyph('▲'), 'Move earlier', index === 0, () => handlers.onMove(entry, -1)),
      button(glyph('▼'), 'Move later', index === stack.length - 1, () => handlers.onMove(entry, 1)),
      button(icon('trash'), 'Remove', false, () => handlers.onRemove(entry))
    );

    head.append(title, buttons);
    card.append(head);

    const help = helpFor(entry);
    if (help) {
      const note = document.createElement('p');
      note.className = 'note fx-help';
      note.textContent = help;
      card.append(note);
    }

    /* A motion card says what it is aimed at before it says how, because that
       is the question you have when you look at one. */
    if (motion) {
      const aim = document.createElement('p');
      aim.className = 'fx-aim';
      const target = readTarget(entry.values.target);
      const aimed = target ? targetField(stack, target) : null;
      if (aimed) {
        aim.innerHTML = 'drives <b></b>';
        aim.querySelector('b').textContent =
          `${positionOf(aimed.entry)}. ${aimed.entry.title} · ${labelOf(aimed.field, aimed.entry.values)}`;
      } else if (target) {
        card.classList.add('orphan');
        aim.classList.add('broken');
        aim.textContent = 'Nothing to drive — the card this pointed at was removed. Pick another target, or remove this card.';
      } else {
        aim.classList.add('unset');
        aim.textContent = 'Not aimed at anything yet.';
      }
      card.append(aim);
    }

    const fields = document.createElement('div');
    fields.className = 'fx-fields';
    const draw = () => {
      fields.textContent = '';
      for (const field of visibleFields(entry, stack)) {
        const chip = motion ? null : driven.get(`${entry.id}:${field.id}`);
        const chipNames = chip ? chip.map(source => `${positionOf(source)}. ${source.title}`) : null;
        fields.append(controlFor(entry, field, () => {
          /* a select can change which controls apply; a slider cannot */
          if (field.type === 'select' || field.type === 'check') {
            /* choosing a target rewrites everything about a motion card: what
               its ramp is measured in, and what the card at the other end says
               about itself */
            if (field.id === 'target') { seedRamp(entry, stack); handlers.onRetarget(entry); return; }
            draw();
          }
          handlers.onChange(entry);
        }, chipNames));
      }
    };
    draw();
    card.append(fields);
    container.append(card);

    if (motion) card.append(scopeFor(entry));
  });
}

/* A ramp is measured in the units of whatever it is pointed at, so choosing a
   target for the first time sets its ends to that control's own extremes —
   0° to 180° for an angle — rather than leaving two zeroes behind. */
function seedRamp(entry, stack) {
  const source = MOTION_KINDS[entry.kind];
  if (!source) return;
  const aimed = targetField(stack, readTarget(entry.values.target));
  if (!aimed) return;
  for (const field of source.fields) {
    if (field.range !== 'target') continue;
    entry.values[field.id] = field.value === 'max' ? aimed.field.max : aimed.field.min;
  }
}

/* The little scope inside a motion card: the shape it will trace across the
   clip, with a playhead. Drawn once; the playhead and the readout are moved
   every frame by updateDriven. */
function scopeFor(entry) {
  const scope = document.createElement('div');
  scope.className = 'fx-scope';
  scope.innerHTML =
    '<svg viewBox="0 0 240 34" preserveAspectRatio="none" aria-hidden="true">' +
    '<line class="fx-scope-mid" x1="0" y1="17" x2="240" y2="17"></line>' +
    '<path class="fx-scope-trace" fill="none"></path>' +
    '<line class="fx-scope-head" x1="0" y1="0" x2="0" y2="34"></line>' +
    '</svg><div class="fx-scope-foot"><span class="fx-scope-what"></span><span class="fx-scope-now"></span></div>';
  return scope;
}

/* The Effects menu and the "add" control are built from the same catalogue, so
   a filter added to ClackPaint shows up in both without being named twice. */
export function fillPicker(select) {
  const { effects, dithers, mattes, motions } = catalogue();
  select.textContent = '';
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = 'Add an effect…';
  select.append(blank);
  const group = (label, items) => {
    if (!items.length) return;
    const optgroup = document.createElement('optgroup');
    optgroup.label = label;
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.kind; option.textContent = item.title;
      optgroup.append(option);
    }
    select.append(optgroup);
  };
  group('Filters', effects);
  group('Dither', dithers);
  group('Background', mattes);
  group('Motion', motions);
}

/* ------------------------------------------------- what moves every frame
   Rebuilding the panel per frame would fight the pointer and lose the focus
   ring, so the rows are built once and only the parts that move are written:
   the amber marker on a driven track, the value beside it, and each motion
   card's playhead. Everything here is a write — nothing is measured — so it
   costs nothing to call on every preview frame. */

const scopeShape = (entry, context, samples = 96) => {
  const source = MOTION_KINDS[entry.kind];
  if (!source) return [];
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const time = (i / samples) * (context.duration || 1);
    const value = Number(source.at(entry.values, time, context));
    points.push(Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0);
  }
  return points;
};

export function updateDriven(container, { effects, drivers, time, context }) {
  for (const card of container.querySelectorAll('.fx-card')) {
    const entry = effects.find(item => String(item.id) === card.dataset.entry);
    if (!entry) continue;

    /* a filter's driven controls */
    for (const row of card.querySelectorAll('.fx-field.patched')) {
      const held = drivers.get(`${entry.id}:${row.dataset.field}`);
      const marker = row.querySelector('.fx-live-marker');
      const readout = row.querySelector('.fx-field-value');
      if (!held || held.value === undefined) { if (marker) marker.hidden = true; continue; }
      const low = Number(row.dataset.min), high = Number(row.dataset.max);
      const span = (high - low) || 1;
      if (marker) {
        marker.hidden = false;
        marker.style.setProperty('--at', `${Math.max(0, Math.min(1, (held.value - low) / span)) * 100}%`);
      }
      if (readout) {
        readout.textContent = held.value.toFixed(Number(row.dataset.decimals) || 0) + (row.dataset.unit || '');
        readout.classList.add('driven');
      }
    }

    /* a motion card's scope */
    const scope = card.querySelector('.fx-scope');
    if (!scope || !isMotion(entry.kind)) continue;
    const trace = scope.querySelector('.fx-scope-trace');
    const head = scope.querySelector('.fx-scope-head');
    const shape = scopeShape(entry, context);
    if (trace && shape.length) {
      trace.setAttribute('d', 'M' + shape
        .map((value, i) => `${((i / (shape.length - 1)) * 240).toFixed(1)},${(17 - value * 13).toFixed(1)}`)
        .join(' L'));
    }
    if (head && context.duration) {
      const x = Math.max(0, Math.min(1, time / context.duration)) * 240;
      head.setAttribute('x1', x); head.setAttribute('x2', x);
    }
    const target = readTarget(entry.values.target);
    const held = target ? drivers.get(`${target.id}:${target.field}`) : null;
    const now = scope.querySelector('.fx-scope-now');
    if (now) {
      const row = held && container.querySelector(
        `.fx-card[data-entry="${target.id}"] .fx-field[data-field="${target.field}"]`);
      now.textContent = held?.value === undefined ? ''
        : held.value.toFixed(Number(row?.dataset.decimals) || 0) + (row?.dataset.unit || '');
    }
    const what = scope.querySelector('.fx-scope-what');
    if (what) what.textContent = MOTION_KINDS[entry.kind]?.summary?.(entry.values, context) || '';
  }
}
