/* Motion: the cards in the stack that move other cards' controls.
 *
 * A motion card renders nothing. It names one parameter of one other card and
 * a source to drive it with, and every frame it contributes a number. That is
 * the whole idea, and it is why motion is a card rather than a panel: it wants
 * add, reorder, switch-off and remove, and the stack already has all four.
 *
 * Everything here is a pure function of *time*, never of how many frames have
 * been drawn. The preview draws frames irregularly and drops them; the
 * pre-render and the export do not. If a source advanced per drawn frame the
 * export would not match what was watched, so the clock is the only input.
 *
 * Cards are aimed by the id of the entry they target, not by where they sit,
 * so reordering the stack does not repoint anything. Position still means
 * something, though: resolution runs top to bottom, so a motion card can drive
 * another motion card's own rate or depth — which is the only reason the list
 * is ordered rather than a set.
 */

const FX = () => globalThis.ClackFX;

export const isMotion = kind => String(kind || '').startsWith('motion:');

/* A target is "<entry id>:<field id>". Only numbers can be driven — there is no
   halfway between two entries of a select, and a checkbox has no ramp. */
const TARGETABLE = new Set(['range', 'number']);

export const readTarget = value => {
  const [id, field] = String(value || '').split(':');
  return id && field ? { id: Number(id), field } : null;
};

const labelOf = (field, values) =>
  typeof field.label === 'function' ? field.label(values) : field.label;

/* Every numeric control in the stack, named the way the stack shows it, so the
   picker reads as the panel does: "2. Pixel Sorting · Lower threshold". */
export function targetOptions(effects, self) {
  const options = [];
  effects.forEach((entry, index) => {
    if (entry === self) return;
    for (const field of fieldsOf(entry)) {
      if (!TARGETABLE.has(field.type)) continue;
      options.push([`${entry.id}:${field.id}`, `${index + 1}. ${entry.title} · ${labelOf(field, entry.values)}`]);
    }
  });
  return options;
}

/* The catalogue's fields for an entry, whichever family it belongs to. Motion
   cards describe their own; everything else asks the shared libraries. */
let fieldLookup = () => [];
export function useFieldLookup(lookup) { fieldLookup = lookup; }
const fieldsOf = entry => (isMotion(entry.kind) ? MOTION_KINDS[entry.kind]?.fields || [] : fieldLookup(entry.kind));

export function targetField(effects, target) {
  if (!target) return null;
  const entry = effects.find(item => item.id === target.id);
  if (!entry) return null;
  const field = fieldsOf(entry).find(item => item.id === target.field);
  return field ? { entry, field } : null;
}

/* ------------------------------------------------------------------ sources
   Each returns a number in -1..1 for a given time. What that number means to
   the target is the source's business: an offset for the ones that wobble
   around whatever the slider says, an absolute for the ramp, which replaces it. */

const easings = {
  linear: t => t,
  smooth: t => t * t * (3 - 2 * t),
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t)
};

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

export const MOTION_KINDS = {
  'motion:lfo': {
    title: 'LFO',
    mode: 'offset',
    help: 'Wobbles the parameter around wherever its slider is set. Rate is in cycles a second of project time, so slowing the footage slows the wobble with it.',
    fields: [
      { id: 'target', label: 'Target', type: 'target', value: '' },
      {
        id: 'shape', label: 'Shape', type: 'select', value: 'sine',
        options: () => Object.entries(FX()?.WAVES || {}).map(([id, wave]) => [id, wave.label])
      },
      { id: 'rate', label: 'Rate', type: 'range', min: .05, max: 12, value: .75, step: .05, decimals: 2, unit: ' /sec' },
      { id: 'depth', label: 'Depth', type: 'range', min: 0, max: 100, value: 18, step: 1, unit: '% of range' },
      { id: 'phase', label: 'Phase', type: 'range', min: 0, max: 360, value: 0, step: 1, unit: '°' }
    ],
    at(values, time) {
      const wave = (FX()?.WAVES || {})[values.shape] || FX()?.WAVES?.sine;
      const phase = (time * Number(values.rate) + Number(values.phase) / 360) % 1;
      return wave ? wave.at(phase < 0 ? phase + 1 : phase) : 0;
    },
    amount: values => Number(values.depth) / 100,
    summary: values => `${(FX()?.WAVES || {})[values.shape]?.label?.toLowerCase() || 'sine'} · ${Number(values.rate)} cycles a second`
  },

  'motion:ramp': {
    title: 'A → B ramp',
    mode: 'absolute',
    help: 'Slides the parameter from one value to another across the A and B markers, holding at each end. Without markers it runs the length of the project.',
    fields: [
      { id: 'target', label: 'Target', type: 'target', value: '' },
      { id: 'from', label: 'From', type: 'range', range: 'target', value: 'min' },
      { id: 'to', label: 'To', type: 'range', range: 'target', value: 'max' },
      {
        id: 'easing', label: 'Easing', type: 'select', value: 'smooth',
        options: [['linear', 'Linear'], ['smooth', 'Smooth'], ['in', 'Ease in'], ['out', 'Ease out']]
      }
    ],
    /* -1..1 across the marked range, so it shares the shape of every other
       source; the caller maps it back onto From and To. */
    at(values, time, context) {
      const { start, end } = context.range;
      const span = end - start;
      const progress = span > 0.0001 ? clamp01((time - start) / span) : 1;
      return (easings[values.easing] || easings.smooth)(progress) * 2 - 1;
    },
    absolute(values, unit) {
      const from = Number(values.from), to = Number(values.to);
      return from + (to - from) * ((unit + 1) / 2);
    },
    summary: (values, context) => context.marked
      ? 'across the A/B range' : 'across the whole project'
  },

  'motion:audio': {
    title: 'Audio envelope',
    mode: 'offset',
    help: 'Follows how loud the clip is. The envelope is measured once and kept, so scrubbing and rendering read the same numbers.',
    fields: [
      { id: 'target', label: 'Target', type: 'target', value: '' },
      {
        id: 'band', label: 'Listen to', type: 'select', value: 'full',
        options: [['full', 'Everything'], ['low', 'Low end'], ['high', 'Top end']]
      },
      { id: 'depth', label: 'Depth', type: 'range', min: 0, max: 100, value: 60, step: 1, unit: '% of range' },
      { id: 'smoothing', label: 'Smoothing', type: 'range', min: 0, max: 500, value: 120, step: 10, unit: ' ms' },
      { id: 'centred', label: 'Swing both ways', type: 'check', value: false }
    ],
    at(values, time, context) {
      const level = context.audio?.at(time, values.band, Number(values.smoothing)) ?? 0;
      /* Loudness only ever grows, so by default it pushes the parameter one way
         from where the slider sits. Swinging both ways is the same envelope
         re-centred, for when the resting value should be the middle. */
      return values.centred ? level * 2 - 1 : level;
    },
    amount: values => Number(values.depth) / 100,
    summary: (values, context) => context.audio
      ? `${context.audio.seconds.toFixed(1)} s analysed` : 'no audio analysed yet'
  }
};

export const motionCatalogue = () => Object.entries(MOTION_KINDS).map(([kind, source]) => ({
  kind, title: source.title, help: source.help, fields: source.fields, motion: true
}));

/* ---------------------------------------------------------------- resolving
   Offsets from every source aiming at the same control add up — a slow drift
   with a fast wobble on top is a patch, not a conflict — and an absolute
   source sets what they add to. The result is clamped to the control's own
   range, so nothing can drive a filter outside what its dialog allows. */
export function resolveStack(effects, time, context = {}) {
  const live = effects.filter(entry => !entry.bypass);
  const values = new Map(live.map(entry => [entry.id, { ...entry.values }]));
  const drivers = new Map();

  for (const entry of live) {
    if (!isMotion(entry.kind)) continue;
    const source = MOTION_KINDS[entry.kind];
    if (!source) continue;

    /* its own controls, as they stand after anything above has moved them —
       which is what lets one motion card drive another's rate or depth */
    const own = values.get(entry.id);
    const target = readTarget(own.target);
    if (!target) continue;
    const aimed = targetField(effects, target);
    if (!aimed || aimed.entry.bypass) continue;

    const unit = source.at(own, time, context);
    if (!Number.isFinite(unit)) continue;

    const holder = values.get(target.id);
    if (!holder) continue;
    const field = aimed.field;
    const low = Number(field.min), high = Number(field.max);
    const span = (high - low) || 1;

    /* Applied here and now rather than gathered up and folded in at the end.
       Two offsets aimed at one control therefore add — a slow drift with a
       fast wobble on top — and an absolute source replaces whatever the cards
       above it had arrived at. Signal flows down the stack, so a ramp that
       others should ride on belongs above them. */
    let next = source.mode === 'absolute'
      ? source.absolute(own, unit)
      : Number(holder[target.field]) + unit * source.amount(own) * span;
    if (Number.isFinite(low) && next < low) next = low;
    if (Number.isFinite(high) && next > high) next = high;
    holder[target.field] = next;

    const key = `${target.id}:${target.field}`;
    const held = drivers.get(key) || { by: [], settled: Number(entryValue(effects, target.id, target.field)) };
    held.by.push(entry);
    held.value = next;
    drivers.set(key, held);
  }

  /* motion cards never leave the page — the render workers only ever see
     filters, with numbers already worked out */
  const stack = live
    .filter(entry => !isMotion(entry.kind))
    .map(entry => ({ ...entry, values: values.get(entry.id) }));

  return { stack, drivers };
}

const entryValue = (effects, id, field) => effects.find(entry => entry.id === id)?.values?.[field];

/* Whether anything in the stack is actually moving. A stack of filters alone
   renders the same picture for a given frame however often it is asked, which
   is what lets the preview sit still rather than re-running on a timer. */
export const hasMotion = effects =>
  effects.some(entry => !entry.bypass && isMotion(entry.kind) && readTarget(entry.values.target));
