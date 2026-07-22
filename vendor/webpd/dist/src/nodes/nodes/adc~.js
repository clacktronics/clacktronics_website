import { assertNumber } from '../validation.js';
import { Sequence } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
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
// TODO : set message not supported
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: (pdNode, patch) => {
        let channelMapping;
        if (pdNode.args.length) {
            // Channels are provided as 1-indexed, so we translate them back to 0-indexed.
            channelMapping = pdNode.args.map((channel) => assertNumber(channel) - 1);
        }
        else {
            // If no channel is provided, since a patch doesn't contain the channel count info,
            // we just guess the `channelMapping` according to inlets that are defined on the dac.
            const adcOutletIds = new Set();
            patch.connections.forEach((connection) => {
                if (connection.source.nodeId === pdNode.id) {
                    adcOutletIds.add(connection.source.portletId);
                }
            });
            const maxOutlet = Math.max(...adcOutletIds);
            channelMapping = [];
            for (let channel = 0; channel <= maxOutlet; channel++) {
                channelMapping.push(channel);
            }
        }
        return { channelMapping };
    },
    build: (nodeArgs) => ({
        inlets: {},
        outlets: mapArray(nodeArgs.channelMapping, (_, i) => [`${i}`, { type: 'signal', id: `${i}` }]),
    }),
};
// ------------------------------- node implementation ------------------------------ //
const nodeImplementation = {
    flags: {
        alphaName: 'adc_t',
    },
    dsp: ({ outs, node }, { core }, { audio, target }) => Sequence([
        node.args.channelMapping
            // Save the original index 
            .map((source, i) => [source, i])
            // Ignore channels that are out of bounds
            .filter(([source]) => 0 <= source && source < audio.channelCount.in)
            .map(([source, i]) => target === 'javascript'
            ? `${outs[`${i}`]} = ${core.INPUT}[${source}][${core.IT_FRAME}]`
            : `${outs[`${i}`]} = ${core.INPUT}[${core.IT_FRAME} + ${core.BLOCK_SIZE} * ${source}]`)
    ])
};

export { builder, nodeImplementation };
