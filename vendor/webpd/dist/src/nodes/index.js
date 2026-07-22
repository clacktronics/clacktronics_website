import { nodeBuilders } from './nodes/subpatch.js';
import { builder as builder$7, nodeImplementation as nodeImplementation$7 } from './nodes/dac~.js';
import { builder as builder$8, nodeImplementation as nodeImplementation$8 } from './nodes/adc~.js';
import { builder as builder$9, nodeImplementation as nodeImplementation$9 } from './nodes/samplerate~.js';
import { builders as builders$2, nodeImplementations as nodeImplementations$2 } from './nodes/osc~-phasor~.js';
import { builder as builder$4, nodeImplementation as nodeImplementation$4 } from './nodes/clip~.js';
import { builder as builder$2, nodeImplementation as nodeImplementation$2 } from './nodes/sig~.js';
import { builder as builder$3, nodeImplementation as nodeImplementation$3 } from './nodes/samphold~.js';
import { builder as builder$1, nodeImplementation as nodeImplementation$1 } from './nodes/snapshot~.js';
import { builder as builder$5, nodeImplementation as nodeImplementation$5 } from './nodes/vline~.js';
import { builder as builder$6, nodeImplementation as nodeImplementation$6 } from './nodes/line~.js';
import { builder as builder$D, nodeImplementation as nodeImplementation$D } from './nodes/line.js';
import { builders as builders$1, nodeImplementations as nodeImplementations$1 } from './nodes/funcs~.js';
import { builder as builder$F, nodeImplementation as nodeImplementation$E } from './nodes/tabread.js';
import { builder as builder$G, nodeImplementation as nodeImplementation$F } from './nodes/tabwrite.js';
import { builder as builder$b, nodeImplementation as nodeImplementation$b } from './nodes/tabwrite~.js';
import { builders as builders$8, nodeImplementations as nodeImplementations$8 } from './nodes/tabread~-tabread4~.js';
import { builder as builder$a, nodeImplementation as nodeImplementation$a } from './nodes/tabplay~.js';
import { builder as builder$c, nodeImplementation as nodeImplementation$c } from './nodes/readsf~.js';
import { builder as builder$d, nodeImplementation as nodeImplementation$d } from './nodes/writesf~.js';
import { builder as builder$e, nodeImplementation as nodeImplementation$f } from './nodes/filters-bp~.js';
import { builders as builders$6, nodeImplementations as nodeImplementations$6 } from './nodes/throw~-catch~-send~-receive~.js';
import { builder as builder$A, nodeImplementation as nodeImplementation$A } from './nodes/metro.js';
import { builder as builder$B, nodeImplementation as nodeImplementation$B } from './nodes/timer.js';
import { builder as builder$C, nodeImplementation as nodeImplementation$C } from './nodes/delay.js';
import { builders as builders$9, nodeImplementations as nodeImplementations$9 } from './nodes/controls-float.js';
import { builder as builder$j, nodeImplementation as nodeImplementation$j } from './nodes/controls-bang.js';
import { builders as builders$a, nodeImplementations as nodeImplementations$a } from './nodes/controls-atoms.js';
import { builder as builder$m, nodeImplementation as nodeImplementation$m } from './nodes/loadbang.js';
import { builders as builders$d, nodeImplementations as nodeImplementations$c } from './nodes/float-int.js';
import { builders as builders$c, nodeImplementations as nodeImplementations$d } from './nodes/funcs.js';
import { builders, nodeImplementations } from './nodes/binop~.js';
import { builder, nodeImplementation } from './nodes/noise~.js';
import { builders as builders$5, nodeImplementations as nodeImplementations$5 } from './nodes/delread~-delread4~.js';
import { builder as builder$i, nodeImplementation as nodeImplementation$e } from './nodes/delwrite~.js';
import { builders as builders$3, nodeImplementations as nodeImplementations$3 } from './nodes/filters-real~.js';
import { builders as builders$4, nodeImplementations as nodeImplementations$4 } from './nodes/filters-complex~.js';
import { builder as builder$f, nodeImplementation as nodeImplementation$g } from './nodes/filters-hip~.js';
import { builder as builder$g, nodeImplementation as nodeImplementation$h } from './nodes/filters-lop~.js';
import { builder as builder$h, nodeImplementation as nodeImplementation$i } from './nodes/filters-vcf~.js';
import { builder as builder$z, nodeImplementation as nodeImplementation$z } from './nodes/msg.js';
import { builder as builder$k, nodeImplementation as nodeImplementation$k } from './nodes/list.js';
import { builder as builder$l, nodeImplementation as nodeImplementation$l } from './nodes/symbol.js';
import { builders as builders$7, nodeImplementations as nodeImplementations$7 } from './nodes/send-receive.js';
import { builder as builder$E, nodeImplementation as nodeImplementation$G } from './nodes/soundfiler.js';
import { builder as builder$n, nodeImplementation as nodeImplementation$n } from './nodes/print.js';
import { builder as builder$o, nodeImplementation as nodeImplementation$o } from './nodes/trigger.js';
import { builder as builder$p, nodeImplementation as nodeImplementation$p } from './nodes/change.js';
import { builder as builder$s, nodeImplementation as nodeImplementation$s } from './nodes/moses.js';
import { builder as builder$q, nodeImplementation as nodeImplementation$q } from './nodes/clip.js';
import { builder as builder$y, nodeImplementation as nodeImplementation$x } from './nodes/route.js';
import { builder as builder$v, nodeImplementation as nodeImplementation$v } from './nodes/spigot.js';
import { builder as builder$w, nodeImplementation as nodeImplementation$w } from './nodes/until.js';
import { builder as builder$x, nodeImplementation as nodeImplementation$y } from './nodes/random.js';
import { builder as builder$r, nodeImplementation as nodeImplementation$r } from './nodes/pipe.js';
import { builder as builder$t, nodeImplementation as nodeImplementation$t } from './nodes/pack.js';
import { builder as builder$u, nodeImplementation as nodeImplementation$u } from './nodes/unpack.js';
import { builders as builders$e, nodeImplementations as nodeImplementations$e } from './nodes/expr-expr~.js';
import { builders as builders$b, nodeImplementations as nodeImplementations$b } from './nodes/binop.js';
import { builder as builder$I, nodeImplementation as nodeImplementation$I } from './nodes/_routemsg.js';
import { builder as builder$H, nodeImplementation as nodeImplementation$H } from './nodes/_mixer~.js';

/*
 * Copyright (c) 2022-2023 Sébastien Piquemal <sebpiq@protonmail.com>, Chris McCormick.
 *
 * This file is part of WebPd
 * (see https://github.com/sebpiq/WebPd).
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
const NODE_BUILDERS = {
    ...nodeBuilders,
    ...builders,
    ...builders$1,
    ...builders$2,
    ...builders$3,
    ...builders$4,
    ...builders$5,
    ...builders$6,
    ...builders$7,
    ...builders$7,
    ...builders$8,
    'noise~': builder,
    'snapshot~': builder$1,
    'sig~': builder$2,
    'samphold~': builder$3,
    'clip~': builder$4,
    'vline~': builder$5,
    'line~': builder$6,
    'dac~': builder$7,
    'adc~': builder$8,
    'samplerate~': builder$9,
    'tabplay~': builder$a,
    'tabwrite~': builder$b,
    'readsf~': builder$c,
    'writesf~': builder$d,
    'vd~': { aliasTo: 'delread4~' },
    'bp~': builder$e,
    'hip~': builder$f,
    'lop~': builder$g,
    'vcf~': builder$h,
    'delwrite~': builder$i,
    's~': { aliasTo: 'send~' },
    'r~': { aliasTo: 'receive~' },
    ...builders$9,
    ...builders$a,
    ...builders$b,
    ...builders$c,
    ...builders$d,
    ...builders$e,
    bang: builder$j,
    bng: { aliasTo: 'bang' },
    b: { aliasTo: 'bang' },
    list: builder$k,
    symbol: builder$l,
    loadbang: builder$m,
    s: { aliasTo: 'send' },
    r: { aliasTo: 'receive' },
    print: builder$n,
    trigger: builder$o,
    t: { aliasTo: 'trigger' },
    change: builder$p,
    clip: builder$q,
    pipe: builder$r,
    moses: builder$s,
    pack: builder$t,
    unpack: builder$u,
    spigot: builder$v,
    until: builder$w,
    random: builder$x,
    route: builder$y,
    select: { aliasTo: 'route' },
    sel: { aliasTo: 'route' },
    msg: builder$z,
    metro: builder$A,
    timer: builder$B,
    delay: builder$C,
    del: { aliasTo: 'delay' },
    line: builder$D,
    soundfiler: builder$E,
    tabread: builder$F,
    tabwrite: builder$G,
    // The following are internal nodes used by the compiler
    // to help reproduce Pd's behavior
    '_mixer~': builder$H,
    '_routemsg': builder$I,
    // The following don't need implementations as they will never
    // show up in the graph traversal.
    graph: { isNoop: true },
    table: { isNoop: true },
    array: { isNoop: true },
    text: { isNoop: true },
    cnv: { isNoop: true },
    'block~': { isNoop: true },
    openpanel: { isNoop: true },
};
const NODE_IMPLEMENTATIONS = {
    ...nodeImplementations,
    ...nodeImplementations$1,
    ...nodeImplementations$2,
    ...nodeImplementations$3,
    ...nodeImplementations$4,
    ...nodeImplementations$5,
    ...nodeImplementations$6,
    ...nodeImplementations$7,
    ...nodeImplementations$8,
    'noise~': nodeImplementation,
    'snapshot~': nodeImplementation$1,
    'sig~': nodeImplementation$2,
    'samphold~': nodeImplementation$3,
    'clip~': nodeImplementation$4,
    'vline~': nodeImplementation$5,
    'line~': nodeImplementation$6,
    'dac~': nodeImplementation$7,
    'adc~': nodeImplementation$8,
    'samplerate~': nodeImplementation$9,
    'tabplay~': nodeImplementation$a,
    'tabwrite~': nodeImplementation$b,
    'readsf~': nodeImplementation$c,
    'writesf~': nodeImplementation$d,
    'delwrite~': nodeImplementation$e,
    'bp~': nodeImplementation$f,
    'hip~': nodeImplementation$g,
    'lop~': nodeImplementation$h,
    'vcf~': nodeImplementation$i,
    ...nodeImplementations$9,
    ...nodeImplementations$a,
    ...nodeImplementations$b,
    ...nodeImplementations$c,
    ...nodeImplementations$d,
    ...nodeImplementations$e,
    bang: nodeImplementation$j,
    list: nodeImplementation$k,
    symbol: nodeImplementation$l,
    loadbang: nodeImplementation$m,
    print: nodeImplementation$n,
    trigger: nodeImplementation$o,
    change: nodeImplementation$p,
    clip: nodeImplementation$q,
    pipe: nodeImplementation$r,
    moses: nodeImplementation$s,
    pack: nodeImplementation$t,
    unpack: nodeImplementation$u,
    spigot: nodeImplementation$v,
    until: nodeImplementation$w,
    route: nodeImplementation$x,
    random: nodeImplementation$y,
    msg: nodeImplementation$z,
    metro: nodeImplementation$A,
    timer: nodeImplementation$B,
    delay: nodeImplementation$C,
    line: nodeImplementation$D,
    tabread: nodeImplementation$E,
    tabwrite: nodeImplementation$F,
    soundfiler: nodeImplementation$G,
    // Internal nodes
    '_mixer~': nodeImplementation$H,
    '_routemsg': nodeImplementation$I,
};

export { NODE_BUILDERS, NODE_IMPLEMENTATIONS };
