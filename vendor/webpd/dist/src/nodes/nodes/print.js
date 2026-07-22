import { AnonFunc, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
    translateArgs: (pdNode) => {
        let prefix = 'print:';
        if (pdNode.args.length === 1 && pdNode.args[0] === '-n') {
            prefix = '';
        }
        else if (pdNode.args.length >= 1) {
            prefix = pdNode.args.join(' ') + ':';
        }
        return { prefix };
    },
    build: () => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: {},
    }),
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    messageReceivers: ({ node: { args } }, { msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            console.log("${args.prefix} " + ${msg.display}(m))
            return
        `,
    })
};

export { builder, nodeImplementation };
