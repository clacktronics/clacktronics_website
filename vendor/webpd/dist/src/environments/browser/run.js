import WebPdWorkletNode from '../../../node_modules/@webpd/runtime/dist/src/WebPdWorkletNode.js';
import '../../../node_modules/@webpd/runtime/dist/src/utils.js';
import '../../../node_modules/@webpd/runtime/dist/node_modules/@webpd/compiler/dist/src/compile/proxies.js';
import '../../../node_modules/@webpd/runtime/dist/node_modules/@webpd/compiler/dist/src/compile/precompile/proxies.js';

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
var run = async (audioContext, compiledPatch, settings) => {
    const { messageHandler } = settings;
    const webpdNode = new WebPdWorkletNode(audioContext);
    webpdNode.port.onmessage = (msg) => messageHandler(webpdNode, msg);
    if (typeof compiledPatch === 'string') {
        webpdNode.port.postMessage({
            type: 'code:JS',
            payload: {
                jsCode: compiledPatch,
            },
        });
    }
    else {
        webpdNode.port.postMessage({
            type: 'code:WASM',
            payload: {
                wasmBuffer: compiledPatch,
            },
        });
    }
    return webpdNode;
};

export { run as default };
