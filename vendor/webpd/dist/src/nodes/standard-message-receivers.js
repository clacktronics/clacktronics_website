import { AnonFunc, Var } from '../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
// prettier-ignore
const coldFloatInlet = (storageName, msg) => AnonFunc([Var(msg.Message, `m`)]) `
    if (${msg.isMatching}(m, [${msg.FLOAT_TOKEN}])) {
        ${storageName} = ${msg.readFloatToken}(m, 0)
        return
    }
`;
// prettier-ignore
const coldStringInlet = (storageName, msg) => AnonFunc([Var(msg.Message, `m`)]) `
    if (${msg.isMatching}(m, [${msg.STRING_TOKEN}])) {
        ${storageName} = ${msg.readStringToken}(m, 0)
        return
    }
`;
// prettier-ignore
const coldFloatInletWithSetter = (setterName, state, msg) => AnonFunc([Var(msg.Message, `m`)]) `
    if (${msg.isMatching}(m, [${msg.FLOAT_TOKEN}])) {
        ${setterName}(${state}, ${msg.readFloatToken}(m, 0))
        return
    }
`;

export { coldFloatInlet, coldFloatInletWithSetter, coldStringInlet };
