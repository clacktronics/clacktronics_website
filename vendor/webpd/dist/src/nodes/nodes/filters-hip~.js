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
// TODO : very inneficient compute coeff at each iter
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
    configureMessageToSignalConnection: (inletId, nodeArgs) => {
        if (inletId === '1') {
            return { initialSignalValue: nodeArgs.initValue };
        }
        return undefined;
    },
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    flags: {
        alphaName: 'hip_t',
    },
    state: ({ ns }) => Class(ns.State, [
        Var(`Float`, `previous`, 0),
        Var(`Float`, `current`, 0),
        Var(`Float`, `coeff`, 0),
        Var(`Float`, `normal`, 0),
    ]),
    dsp: ({ ins, state, outs }, { core }) => ({
        inlets: {
            '1': ast `
                ${state}.coeff = Math.min(Math.max(1 - ${ins.$1} * (2 * Math.PI) / ${core.SAMPLE_RATE}, 0), 1)
                ${state}.normal = 0.5 * (1 + ${state}.coeff)
            `
        },
        loop: ast `
            ${state}.current = ${ins.$0} + ${state}.coeff * ${state}.previous
            ${outs.$0} = ${state}.normal * (${state}.current - ${state}.previous)
            ${state}.previous = ${state}.current
        `
    }),
};

export { builder, nodeImplementation };
