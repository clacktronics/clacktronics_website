import { assertOptionalNumber } from '../validation.js';
import { bangUtils, actionUtils } from '../global-code/core.js';
import { soundFileOpenOpts, readWriteFsOpts } from '../global-code/fs.js';
import { Class, Var, AnonFunc, ast, Sequence, Func, ConstVar } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { mapArray, countTo } from '../../../node_modules/@webpd/compiler/dist/src/functional-helpers.js';
import { fsReadSoundStream } from '../../../node_modules/@webpd/compiler/dist/src/stdlib/fs/fs.js';

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
// TODO : check the real state machine of readsf
//      - what happens when start / stopping / start stream ?
//      - what happens when stream ended and starting again ?
//      - etc ...
// TODO : second arg : "buffer channel size" not implemented
// TODO : implement raw
// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: (pdNode) => ({
        channelCount: assertOptionalNumber(pdNode.args[0]) || 1,
    }),
    build: (nodeArgs) => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: {
            ...mapArray(countTo(nodeArgs.channelCount), (channel) => [`${channel}`, { type: 'signal', id: `${channel}` }]),
            [`${nodeArgs.channelCount}`]: {
                type: 'message',
                id: `${nodeArgs.channelCount}`,
            }
        },
    })
};
// ------------------------------ node implementations ------------------------------ //
const nodeImplementation = {
    flags: {
        alphaName: 'readsf_t',
    },
    state: ({ ns }, { buf, fs }) => Class(ns.State, [
        Var(`Array<${buf.SoundBuffer}>`, `buffers`, `[]`),
        Var(fs.OperationId, `streamOperationId`, -1),
        Var(`Int`, `readingStatus`, 0),
    ]),
    messageReceivers: ({ ns, node, state, }, { actionUtils, msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            if (${msg.getLength}(m) >= 2) {
                if (${msg.isStringToken}(m, 0) 
                    && ${msg.readStringToken}(m, 0) === 'open'
                ) {
                    ${ns.openStream}(
                        ${state},
                        m,
                        ${node.args.channelCount},
                        ${AnonFunc() `
                            ${state}.streamOperationId = -1
                            if (${state}.readingStatus === 1) {
                                ${state}.readingStatus = 2
                            } else {
                                ${state}.readingStatus = 3
                            }
                        `}
                    )
                    return
                }
    
            } else if (${msg.isMatching}(m, [${msg.FLOAT_TOKEN}])) {
                if (${msg.readFloatToken}(m, 0) === 0) {
                    ${state}.readingStatus = 3
                    return
    
                } else {
                    if (${state}.streamOperationId !== -1) {
                        ${state}.readingStatus = 1
                    } else {
                        console.log('[readsf~] start requested without prior open')
                    }
                    return
    
                }
                
            } else if (${actionUtils.isAction}(m, 'print')) {
                console.log('[readsf~] reading = ' + ${state}.readingStatus.toString())
                return
            }
        `,
    }),
    dsp: ({ state, snds, outs, node: { args: { channelCount }, }, }, { buf, bangUtils }) => ast `
        switch(${state}.readingStatus) {
            case 1: 
                ${countTo(channelCount).map((i) => `${outs[i]} = ${buf.pullSample}(${state}.buffers[${i}])`)}
                break
                
            case 2: 
                ${countTo(channelCount).map((i) => `${outs[i]} = ${buf.pullSample}(${state}.buffers[${i}])`)}
                if (${state}.buffers[0].pullAvailableLength === 0) {
                    ${snds[channelCount]}(${bangUtils.bang}())
                    ${state}.readingStatus = 3
                }
                break
    
            case 3: 
                ${countTo(channelCount).map((i) => `${outs[i]} = 0`)}
                ${state}.readingStatus = 0
                break
        }
    `,
    core: ({ ns }, { msg, fs, core, soundFileOpenOpts, readWriteFsOpts }) => Sequence([
        Func(ns.openStream, [
            Var(ns.State, `state`),
            Var(msg.Message, `m`),
            Var(`Int`, `channelCount`),
            Var(fs.OperationCallback, `onStreamClose`),
        ], 'void') `
                if (state.streamOperationId !== -1) {
                    state.readingStatus = 3
                    ${fs.closeSoundStream}(state.streamOperationId, ${fs.OPERATION_SUCCESS})
                }
        
                ${ConstVar(fs.SoundInfo, `soundInfo`, `{
                    channelCount,
                    sampleRate: toInt(${core.SAMPLE_RATE}),
                    bitDepth: 32,
                    encodingFormat: '',
                    endianness: '',
                    extraOptions: '',
                }`)}
                ${ConstVar(`Set<Int>`, `unhandledOptions`, `${soundFileOpenOpts.parse}(
                    m,
                    soundInfo,
                )`)}
                ${ConstVar(`string`, `url`, `${readWriteFsOpts.parse}(
                    m,
                    soundInfo,
                    unhandledOptions
                )`)}
                if (url.length === 0) {
                    return
                }
                state.streamOperationId = ${fs.openSoundReadStream}(
                    url,
                    soundInfo,
                    onStreamClose,
                )
                state.buffers = ${fs.SOUND_STREAM_BUFFERS}.get(state.streamOperationId)
            `
    ]),
    dependencies: [
        soundFileOpenOpts,
        readWriteFsOpts,
        bangUtils,
        actionUtils,
        fsReadSoundStream,
    ],
};

export { builder, nodeImplementation };
