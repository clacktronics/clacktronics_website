import { Sequence, ConstVar, Func, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { bufCore } from '../../../node_modules/@webpd/compiler/dist/src/stdlib/buf/buf.js';
import { sked } from '../../../node_modules/@webpd/compiler/dist/src/stdlib/sked/sked.js';

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
const delayBuffers = {
    namespace: 'delayBuffers',
    // prettier-ignore
    code: ({ ns: delayBuffers }, { buf, sked }) => Sequence([
        ConstVar(`Map<string, ${buf.SoundBuffer}>`, delayBuffers._BUFFERS, `new Map()`),
        ConstVar(sked.Skeduler, delayBuffers._SKEDULER, `${sked.create}(true)`),
        ConstVar(`${buf.SoundBuffer}`, delayBuffers.NULL_BUFFER, `${buf.create}(1)`),
        Func(delayBuffers.get, [
            Var(`string`, `delayName`),
        ], buf.SoundBuffer) `
            ${delayBuffers._BUFFERS}.get(delayName, buffer)
        `,
        Func(delayBuffers.set, [
            Var(`string`, `delayName`),
            Var(buf.SoundBuffer, `buffer`)
        ], 'void') `
            ${delayBuffers._BUFFERS}.set(delayName, buffer)
            ${sked.emit}(${delayBuffers._SKEDULER}, delayName)
        `,
        Func(delayBuffers.wait, [
            Var(`string`, `delayName`),
            Var(sked.Callback, `callback`),
        ], 'void') `
            ${sked.wait}(${delayBuffers._SKEDULER}, delayName, callback)
        `,
        Func(delayBuffers.delete, [
            Var(`string`, `delayName`)
        ], 'void') `
            ${delayBuffers._BUFFERS}.delete(delayName)
        `,
    ]),
    dependencies: [bufCore, sked],
};

export { delayBuffers };
