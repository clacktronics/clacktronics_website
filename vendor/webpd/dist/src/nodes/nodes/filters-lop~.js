import { assertOptionalNumber } from '../validation.js';
import { coldFloatInletWithSetter } from '../standard-message-receivers.js';
import { Class, Var, ast, Sequence, Func } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
// TODO : very inneficient compute coeff at each iter
// TODO : tests + cleaner implementations
// TODO : separate rfilters with lastInput from the ones that don't need
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: ({ args }) => ({
        frequency: assertOptionalNumber(args[0]) || 0,
    }),
    build: () => ({
        inlets: {
            '0': { type: 'signal', id: '0' },
            '1': { type: 'signal', id: '1' },
        },
        outlets: {
            '0': { type: 'signal', id: '0' },
        },
    }),
    configureMessageToSignalConnection: (inletId, nodeArgs) => {
        if (inletId === '1') {
            return { initialSignalValue: nodeArgs.frequency };
        }
        return undefined;
    },
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    flags: {
        alphaName: 'lop_t',
    },
    state: ({ ns }) => Class(ns.State, [
        Var(`Float`, `previous`, 0),
        Var(`Float`, `coeff`, 0),
    ]),
    dsp: ({ ns, ins, state, outs }) => ({
        inlets: {
            '1': ast `${ns.setFreq}(${state}, ${ins.$1})`
        },
        loop: ast `${state}.previous = ${outs.$0} = ${state}.coeff * ${ins.$0} + (1 - ${state}.coeff) * ${state}.previous`
    }),
    messageReceivers: ({ ns, state }, { msg }) => ({
        '1': coldFloatInletWithSetter(ns.setFreq, state, msg),
    }),
    core: ({ ns }, { core }) => Sequence([
        Func(ns.setFreq, [
            Var(ns.State, `state`),
            Var(`Float`, `freq`),
        ], 'void') `
                state.coeff = Math.max(Math.min(freq * 2 * Math.PI / ${core.SAMPLE_RATE}, 1), 0)
            `
    ])
};

export { builder, nodeImplementation };
