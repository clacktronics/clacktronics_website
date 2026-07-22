import { assertOptionalNumber } from '../validation.js';
import { bangUtils } from '../global-code/core.js';
import { coldFloatInletWithSetter } from '../standard-message-receivers.js';
import { Class, Var, AnonFunc, Sequence, Func } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
// TODO : make seed work
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: ({ args }) => ({
        maxValue: assertOptionalNumber(args[0]) || 0,
    }),
    build: () => ({
        inlets: {
            '0': { type: 'message', id: '0' },
            '1': { type: 'message', id: '1' },
        },
        outlets: {
            '0': { type: 'message', id: '0' },
        },
    }),
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    state: ({ node: { args }, ns }) => Class(ns.State, [
        Var(`Float`, `maxValue`, args.maxValue),
    ]),
    messageReceivers: ({ ns, snds, state }, { bangUtils, msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            if (${bangUtils.isBang}(m)) {
                ${snds['0']}(${msg.floats}([Math.floor(Math.random() * ${state}.maxValue)]))
                return
            } else if (
                ${msg.isMatching}(m, [${msg.STRING_TOKEN}, ${msg.FLOAT_TOKEN}])
                && ${msg.readStringToken}(m, 0) === 'seed'
            ) {
                console.log('WARNING : seed not implemented yet for [random]')
                return
            }
        `,
        '1': coldFloatInletWithSetter(ns.setMaxValue, state, msg),
    }),
    core: ({ ns }) => Sequence([
        Func(ns.setMaxValue, [
            Var(ns.State, `state`),
            Var(`Float`, `maxValue`),
        ], 'void') `
                state.maxValue = Math.max(maxValue, 0)
            `
    ]),
    dependencies: [
        bangUtils,
    ],
};

export { builder, nodeImplementation };
