import { Func, Var, Class } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
const point = {
    namespace: 'points',
    // prettier-ignore
    code: ({ ns: points }) => Class(points.Point, [
        Var(`Float`, `x`),
        Var(`Float`, `y`),
    ])
};
const interpolateLin = {
    namespace: 'points',
    // prettier-ignore
    code: ({ ns: points }) => Func(points.interpolateLin, [
        Var(`Float`, `x`),
        Var(points.Point, `p0`),
        Var(points.Point, `p1`)
    ], 'Float') `
        return p0.y + (x - p0.x) * (p1.y - p0.y) / (p1.x - p0.x)
    `,
    dependencies: [point],
};

export { interpolateLin, point };
