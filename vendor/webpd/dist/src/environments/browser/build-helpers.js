import { makeAbstractionLoader, UnknownNodeTypeError } from '../../build/helpers.js';
import { defaultSettingsForBuild as defaultSettingsForBuild$1 } from '../../build/build.js';
import '../../nodes/nodes/expr-expr~.js';
import '../../nodes/nodes/binop.js';
import '../../compile-dsp-graph/to-dsp-graph.js';

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
const defaultSettingsForBuild = (rootUrl) => ({
    ...defaultSettingsForBuild$1(),
    abstractionLoader: makeUrlAbstractionLoader(rootUrl),
});
/**
 * Helper to build an abstraction loader from a root url.
 * The returned loader will :
 * - use the root url to resolve relative paths for abstractions.
 * - suffix all abstraction names with .pd if they don't already have an extension.
 *
 * @param rootUrl
 * @returns
 */
const makeUrlAbstractionLoader = (rootUrl) => makeAbstractionLoader(async (nodeType) => {
    const url = `${rootUrl}/${nodeType.endsWith('.pd') ? nodeType : `${nodeType}.pd`}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new UnknownNodeTypeError(nodeType);
    }
    return await response.text();
});

export { defaultSettingsForBuild, makeUrlAbstractionLoader };
