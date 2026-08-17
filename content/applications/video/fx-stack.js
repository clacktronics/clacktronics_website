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
  return { effects, dithers };
}

const byKind = new Map();
function entryFor(kind) {
  if (!byKind.size) {
    const { effects, dithers } = catalogue();
    for (const item of [...effects, ...dithers]) byKind.set(item.kind, item);
  }
  return byKind.get(kind);
}

/* The Custom Matrix filter is the one control the dialog fills rather than the
   definition: its weights come from the identity kernel for the chosen size. */
function seedValues(item) {
  const values = {};
  for (const field of item.fields) {
    if (field.type === 'matrix') {
      const size = Number(values.size || item.fields.find(f => f.id === 'size')?.value || 3);
      values[field.id] = (FX().CUSTOM_KERNELS[size] || [1]).slice();
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

/* Which controls a filter is showing right now. ClackPaint's `when` predicates
   read the current values, so this has to be asked again after every change. */
export function visibleFields(entry) {
  const item = entryFor(entry.kind);
  if (!item) return [];
  return item.fields.filter(field => typeof field.when !== 'function' || field.when(entry.values));
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
    if (entry.bypass) continue;
    const own = entryFor(entry.kind)?.livePixels;
    const value = typeof own === 'function' ? own(entry.values) : own;
    if (value) budget = Math.min(budget, value);
  }
  /* several filters in a row cost the sum of them */
  const active = stack.filter(entry => !entry.bypass).length || 1;
  return Math.max(24_000, Math.round(budget / active));
}

/* ------------------------------------------------------------------ panel */

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

function controlFor(entry, field, onChange) {
  const row = document.createElement('label');
  row.className = 'fx-field';

  const caption = document.createElement('span');
  caption.className = 'fx-field-label';
  const name = document.createElement('span');
  /* A few controls rename themselves: Pixel Sorting's angle becomes "Ring cut"
     on a spin path and "Spiral cut" on a spiral one, so the label is a function
     of the other values rather than a string. */
  name.textContent = typeof field.label === 'function' ? field.label(entry.values) : field.label;
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

  const sync = () => {
    if (field.type === 'check') entry.values[field.id] = input.checked;
    else if (field.type !== 'matrix') entry.values[field.id] = input.value;
    /* Custom Matrix changes shape when its size does */
    if (field.id === 'size' && entry.values.matrix) {
      const item = entryFor(entry.kind);
      entry.values.matrix = (FX().CUSTOM_KERNELS[Number(input.value)] || [1]).slice();
      void item;
    }
    readout.textContent = field.type === 'matrix' ? '' : formatValue(field, entry.values[field.id]);
    onChange();
  };
  if (field.type !== 'matrix') input.addEventListener('input', sync);
  readout.textContent = field.type === 'matrix' ? '' : formatValue(field, entry.values[field.id]);

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

  stack.forEach((entry, index) => {
    const card = document.createElement('div');
    card.className = `fx-card${entry.bypass ? ' bypassed' : ''}`;

    const head = document.createElement('div');
    head.className = 'fx-card-head';

    const title = document.createElement('span');
    title.className = 'fx-card-title';
    title.textContent = `${index + 1}. ${entry.title}`;

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

    const fields = document.createElement('div');
    fields.className = 'fx-fields';
    const draw = () => {
      fields.textContent = '';
      for (const field of visibleFields(entry)) {
        fields.append(controlFor(entry, field, () => {
          /* a select can change which controls apply; a slider cannot */
          if (field.type === 'select' || field.type === 'check') draw();
          handlers.onChange(entry);
        }));
      }
    };
    draw();
    card.append(fields);
    container.append(card);
  });
}

/* The Effects menu and the "add" control are built from the same catalogue, so
   a filter added to ClackPaint shows up in both without being named twice. */
export function fillPicker(select) {
  const { effects, dithers } = catalogue();
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
}
