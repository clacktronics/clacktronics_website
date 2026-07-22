import '../../node_modules/@webpd/pd-parser/dist/parse.js';
import { CONTROL_TYPE } from '../../node_modules/@webpd/pd-parser/dist/types.js';
import { buildGraphNodeId } from '../compile-dsp-graph/to-dsp-graph.js';
import { resolveRootPatch } from '../compile-dsp-graph/compile-helpers.js';
import { makeTranslationTransform, sumPoints, computeRectanglesIntersection, isPointInsideRectangle } from './geometry.js';

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
const discoverPdGui = (pdJson) => _discoverPdGuiRecursive(pdJson, resolveRootPatch(pdJson));
const _discoverPdGuiRecursive = (pdJson, patch, viewport = null) => {
    if (viewport === null) {
        viewport = {
            topLeft: { x: -Infinity, y: -Infinity },
            bottomRight: { x: Infinity, y: Infinity },
        };
    }
    const pdGuiNodes = [];
    Object.values(patch.nodes).forEach((pdNode) => {
        if (pdNode.type === 'pd' && pdNode.nodeClass === 'subpatch') {
            const subpatch = pdJson.patches[pdNode.patchId];
            const nodeLayout = _assertNodeLayout(pdNode);
            if (!subpatch.layout.graphOnParent) {
                return;
            }
            const subpatchLayout = _assertPatchLayout(subpatch);
            // 1. we convert all coordinates to the subpatch coords system
            const toSubpatchCoords = makeTranslationTransform({ x: nodeLayout.x, y: nodeLayout.y }, { x: subpatchLayout.viewportX, y: subpatchLayout.viewportY });
            const parentViewport = {
                topLeft: toSubpatchCoords(viewport.topLeft),
                bottomRight: toSubpatchCoords(viewport.bottomRight),
            };
            const topLeft = {
                x: subpatchLayout.viewportX,
                y: subpatchLayout.viewportY,
            };
            const subpatchViewport = {
                topLeft,
                bottomRight: sumPoints(topLeft, {
                    x: subpatchLayout.viewportWidth,
                    y: subpatchLayout.viewportHeight,
                }),
            };
            // 2. we compute the visible intersection in the subpatch coords system
            // and call the function for the subpatch
            const visibleSubpatchViewport = computeRectanglesIntersection(parentViewport, subpatchViewport);
            if (visibleSubpatchViewport === null) {
                return;
            }
            const children = _discoverPdGuiRecursive(pdJson, subpatch, visibleSubpatchViewport);
            const pdGuiNode = {
                nodeClass: 'subpatch',
                patchId: patch.id,
                pdNodeId: pdNode.id,
                children,
            };
            pdGuiNodes.push(pdGuiNode);
            // 3. When we get an actual control node, we see if it is inside the
            // visible viewport (which was previously transformed to local coords).
        }
        else if (pdNode.type in CONTROL_TYPE &&
            pdNode.nodeClass === 'control') {
            const nodeLayout = _assertNodeLayout(pdNode);
            if (!isPointInsideRectangle({
                x: nodeLayout.x,
                y: nodeLayout.y,
            }, viewport)) {
                return;
            }
            const pdGuiNode = {
                nodeClass: 'control',
                patchId: patch.id,
                pdNodeId: pdNode.id,
                nodeId: buildGraphNodeId(patch.id, pdNode.id),
            };
            pdGuiNodes.push(pdGuiNode);
            // We collect only comments that are in the root patch
        }
        else if (patch.id === pdJson.rootPatchId &&
            pdNode.nodeClass === 'text') {
            const pdGuiNode = {
                nodeClass: 'text',
                patchId: patch.id,
                pdNodeId: pdNode.id,
            };
            pdGuiNodes.push(pdGuiNode);
        }
    });
    return pdGuiNodes;
};
const traversePdGui = (controls, func) => {
    controls.forEach((pdGuiNode) => {
        if (pdGuiNode.nodeClass === 'subpatch') {
            func(pdGuiNode);
            traversePdGui(pdGuiNode.children, func);
        }
        else {
            func(pdGuiNode);
        }
    });
};
const _assertPatchLayout = (patch) => {
    const layout = patch.layout;
    const viewportX = layout.viewportX;
    const viewportY = layout.viewportY;
    const viewportWidth = layout.viewportWidth;
    const viewportHeight = layout.viewportHeight;
    if (typeof viewportX !== 'number' ||
        typeof viewportY !== 'number' ||
        typeof viewportWidth !== 'number' ||
        typeof viewportHeight !== 'number') {
        throw new Error(`Missing patch layout attributes`);
    }
    return {
        viewportX,
        viewportY,
        viewportWidth,
        viewportHeight,
    };
};
const _assertNodeLayout = (pdNode) => {
    const x = pdNode.layout.x;
    const y = pdNode.layout.y;
    if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error(`Missing node layout attributes`);
    }
    let label = null;
    if (pdNode.nodeClass === 'control') {
        label = pdNode.layout.label;
    }
    else if (pdNode.nodeClass === 'subpatch') {
        label = pdNode.args[0] ? pdNode.args[0].toString() : null;
    }
    return {
        x,
        y,
        label,
    };
};

export { _assertNodeLayout, _assertPatchLayout, discoverPdGui, traversePdGui };
