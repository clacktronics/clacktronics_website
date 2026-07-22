import { assertString } from '../validation.js';
import { bangUtils } from '../global-code/core.js';
import { resolveTypeArgumentAlias, assertTypeArgument, renderMessageTransfer, messageTokenToFloat, messageTokenToString } from '../type-arguments.js';
import { AnonFunc, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { mapArray } from '../../../node_modules/@webpd/compiler/dist/src/functional-helpers.js';

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
// TODO : 
// - pointer
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: ({ args }) => ({
        typeArguments: args.length === 0 ? ['bang', 'bang'] : args
            .map(assertString)
            .map(resolveTypeArgumentAlias)
            .map(assertTypeArgument),
    }),
    build: ({ typeArguments }) => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: mapArray(typeArguments, (_, i) => [`${i}`, { type: 'message', id: `${i}` }]),
    }),
};
// ---------------------------------- node implementation --------------------------------- //
const nodeImplementation = {
    messageReceivers: ({ snds, node: { args: { typeArguments } } }, globals) => ({
        '0': AnonFunc([
            Var(globals.msg.Message, `m`)
        ]) `
            ${typeArguments.reverse().map((typeArg, i) => `${snds[typeArguments.length - i - 1]}(${renderMessageTransfer(typeArg, 'm', 0, globals)})`)}
            return
        `,
    }),
    dependencies: [
        messageTokenToFloat,
        messageTokenToString,
        bangUtils,
    ],
};

export { builder, nodeImplementation };
