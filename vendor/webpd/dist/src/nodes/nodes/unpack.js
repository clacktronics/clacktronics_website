import { resolveTypeArgumentAlias } from '../type-arguments.js';
import { AnonFunc, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { mapArray, renderSwitch } from '../../../node_modules/@webpd/compiler/dist/src/functional-helpers.js';

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
    translateArgs: ({ args }) => ({
        typeArguments: args.length === 0 ? ['float', 'float'] : args
            .map(resolveTypeArgumentAlias)
            .map(arg => {
            if (typeof arg === 'number') {
                return 'float';
            }
            else if (arg === 'symbol' || arg === 'float') {
                return arg;
            }
            else {
                throw new Error(`Invalid type argument for unpack "${arg}"`);
            }
        }),
    }),
    build: ({ typeArguments }) => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: mapArray(typeArguments, (_, i) => [`${i}`, { type: 'message', id: `${i}` }]),
    }),
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    messageReceivers: ({ snds, node: { args } }, { msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            ${args.typeArguments.map((t, i) => [t, i]).reverse().map(([t, reversedI]) => `
                    if (
                        ${msg.getLength}(m) >= ${reversedI + 1}
                    ) {
                        if (${msg.getTokenType}(m, ${reversedI}) === ${t === 'float' ? msg.FLOAT_TOKEN : msg.STRING_TOKEN}) {
                            ${renderSwitch([t === 'float', `${snds[reversedI]}(${msg.floats}([${msg.readFloatToken}(m, ${reversedI})]))`], [t === 'symbol', `${snds[reversedI]}(${msg.strings}([${msg.readStringToken}(m, ${reversedI})]))`])}
                        } else {
                            console.log('unpack : invalid token type index ${reversedI}')
                        }
                    }
                `)}
            return
        `,
    }),
};

export { builder, nodeImplementation };
