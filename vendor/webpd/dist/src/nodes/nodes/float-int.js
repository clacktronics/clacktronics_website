import { assertOptionalNumber } from '../validation.js';
import { bangUtils } from '../global-code/core.js';
import { coldFloatInletWithSetter } from '../standard-message-receivers.js';
import { roundFloatAsPdInt } from '../global-code/numbers.js';
import { Sequence, Func, Var, Class, ast, AnonFunc } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
// TODO: proper support for $ args
// TODO: simple number - shortcut for float
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: (pdNode) => ({
        value: assertOptionalNumber(pdNode.args[0]) || 0,
    }),
    build: () => ({
        inlets: {
            '0': { type: 'message', id: '0' },
            '1': { type: 'message', id: '1' },
        },
        outlets: {
            '0': { type: 'message', id: '0' },
        },
        isPushingMessages: true,
    }),
};
// ------------------------------- node implementation - shared ------------------------------ //
const sharedNodeImplementation = {
    state: ({ ns }) => Class(ns.State, [
        Var(`Float`, `value`, 0),
    ]),
    initialization: ({ ns, node: { args }, state }) => ast `
            ${ns.setValue}(${state}, ${args.value})
        `,
    messageReceivers: ({ ns, snds, state, }, { bangUtils, msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            if (${msg.isMatching}(m, [${msg.FLOAT_TOKEN}])) {
                ${ns.setValue}(${state}, ${msg.readFloatToken}(m, 0))
                ${snds.$0}(${msg.floats}([${state}.value]))
                return 

            } else if (${bangUtils.isBang}(m)) {
                ${snds.$0}(${msg.floats}([${state}.value]))
                return
                
            }
        `,
        '1': coldFloatInletWithSetter(ns.setValue, state, msg),
    }),
};
// ------------------------------- node implementation - float ------------------------------ //
const nodeImplementationFloat = {
    ...sharedNodeImplementation,
    core: ({ ns }) => Sequence([
        Func(ns.setValue, [
            Var(ns.State, `state`),
            Var(`Float`, `value`),
        ], 'void') `
                state.value = value
            `
    ]),
    dependencies: [
        bangUtils,
    ],
};
// ------------------------------- node implementation - int ------------------------------ //
const nodeImplementationInt = {
    ...sharedNodeImplementation,
    core: ({ ns }, { numbers }) => Sequence([
        Func(ns.setValue, [
            Var(ns.State, `state`),
            Var(`Float`, `value`),
        ], 'void') `
                state.value = ${numbers.roundFloatAsPdInt}(value)
            `,
    ]),
    dependencies: [
        roundFloatAsPdInt,
        bangUtils,
    ],
};
// ------------------------------------------------------------------- //
const builders = {
    float: builder,
    f: { aliasTo: 'float' },
    int: builder,
    i: { aliasTo: 'int' },
};
const nodeImplementations = {
    float: nodeImplementationFloat,
    int: nodeImplementationInt,
};

export { builders, nodeImplementations };
