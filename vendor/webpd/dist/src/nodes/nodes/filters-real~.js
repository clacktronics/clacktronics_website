import { assertOptionalNumber } from '../validation.js';
import { Class, Var, ast } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
// TODO : tests + cleaner implementations
// TODO : separate rfilters with lastInput from the ones that don't need
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: ({ args }) => ({
        initValue: assertOptionalNumber(args[0]) || 0,
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
    configureMessageToSignalConnection: (inletId, { initValue }) => {
        if (inletId === '1') {
            return { initialSignalValue: initValue };
        }
        return undefined;
    },
};
// ------------------------------- node implementation ------------------------------ //
const makeNodeImplementation = ({ generateOperation, alphaName, }) => {
    return {
        flags: {
            alphaName,
        },
        state: ({ ns }) => Class(ns.State, [
            Var(`Float`, `lastOutput`, 0),
            Var(`Float`, `lastInput`, 0),
        ]),
        dsp: ({ ins, state, outs }) => ast `
            ${state}.lastOutput = ${outs.$0} = ${generateOperation(ins.$0, ins.$1, `${state}.lastOutput`, `${state}.lastInput`)}
            ${state}.lastInput = ${ins.$0}
        `,
    };
};
// ------------------------------------------------------------------- //
const builders = {
    'rpole~': builder,
    'rzero~': builder,
    'rzero_rev~': builder,
};
const nodeImplementations = {
    'rpole~': makeNodeImplementation({
        alphaName: 'rpole_t',
        generateOperation: (input, coeff, lastOutput) => `${input} + ${coeff} * ${lastOutput}`,
    }),
    'rzero~': makeNodeImplementation({
        alphaName: 'rzero_t',
        generateOperation: (input, coeff, _, lastInput) => `${input} - ${coeff} * ${lastInput}`,
    }),
    'rzero_rev~': makeNodeImplementation({
        alphaName: 'rzero_rev_t',
        generateOperation: (input, coeff, _, lastInput) => `${lastInput} - ${coeff} * ${input}`
    }),
};

export { builders, nodeImplementations };
