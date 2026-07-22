import { bangUtils } from '../global-code/core.js';
import { ast } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { commonsWaitFrame } from '../../../node_modules/@webpd/compiler/dist/src/stdlib/commons/commons.js';

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
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: () => ({}),
    build: () => ({
        inlets: {},
        outlets: { '0': { type: 'message', id: '0' } },
        isPushingMessages: true
    }),
};
// ---------------------------- node implementation -------------------------- //
const nodeImplementation = {
    initialization: ({ snds }, { bangUtils, commons }) => ast `${commons.waitFrame}(0, () => ${snds.$0}(${bangUtils.bang}()))`,
    dependencies: [
        bangUtils,
        commonsWaitFrame
    ],
};

export { builder, nodeImplementation };
