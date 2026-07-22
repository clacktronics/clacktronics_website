import { assertOptionalString } from '../validation.js';
import { sigBuses } from '../global-code/buses.js';
import { ast, AnonFunc, Var, Sequence, Func, Class } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
const builderThrow = {
    translateArgs: (pdNode) => ({
        busName: assertOptionalString(pdNode.args[0]) || '',
    }),
    build: () => ({
        inlets: {
            '0': { type: 'signal', id: '0' },
            '0_message': { type: 'message', id: '0_message' },
        },
        outlets: {},
        isPullingSignal: true,
    }),
    configureMessageToSignalConnection: (inletId) => {
        if (inletId === '0') {
            return { reroutedMessageInletId: '0_message' };
        }
        return undefined;
    },
};
const builderReceive = {
    translateArgs: (pdNode) => ({
        busName: assertOptionalString(pdNode.args[0]) || '',
    }),
    build: () => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: {
            '0': { type: 'signal', id: '0' },
        },
    }),
};
const builderSend = {
    translateArgs: (pdNode) => ({
        busName: assertOptionalString(pdNode.args[0]) || '',
    }),
    build: () => ({
        inlets: {
            '0': { type: 'signal', id: '0' },
        },
        outlets: {},
        isPullingSignal: true,
    }),
};
const builderCatch = {
    translateArgs: (pdNode) => ({
        busName: assertOptionalString(pdNode.args[0]) || '',
    }),
    build: () => ({
        inlets: {},
        outlets: {
            '0': { type: 'signal', id: '0' },
        },
    }),
};
// ------------------------------- node implementation ------------------------------ //
const sharedCore = (ns, { sigBuses }) => Sequence([
    Func(ns.setBusName, [
        Var(ns.State, `state`), Var(`string`, `busName`)
    ], 'void') `
            if (busName.length) {
                state.busName = busName
                ${sigBuses.reset}(state.busName)
            }
        `,
]);
const sharedNodeImplementation = {
    state: ({ ns }) => Class(ns.State, [Var(`string`, `busName`, `""`)]),
    initialization: ({ ns, node: { args }, state }) => ast `
        ${ns.setBusName}(${state}, "${args.busName}")
    `,
};
// --------------------------------- node implementation - throw~ ---------------------------------- //
const nodeImplementationThrow = {
    ...sharedNodeImplementation,
    flags: {
        alphaName: 'throw_t',
    },
    dsp: ({ ins, state }, { sigBuses }) => ast `
        ${sigBuses.addAssign}(${state}.busName, ${ins.$0})
    `,
    messageReceivers: ({ ns, state }, { msg }) => ({
        '0_message': AnonFunc([Var(msg.Message, `m`)], `void`) `
            if (
                ${msg.isMatching}(m, [${msg.STRING_TOKEN}, ${msg.STRING_TOKEN}])
                && ${msg.readStringToken}(m, 0) === 'set'
            ) {
                ${ns.setBusName}(${state}, ${msg.readStringToken}(m, 1))
                return
            }
        `
    }),
    core: ({ ns }, globals) => sharedCore(ns, globals),
    dependencies: [
        sigBuses,
    ]
};
// --------------------------------- node implementation - catch~ ---------------------------------- //
const nodeImplementationCatch = {
    ...sharedNodeImplementation,
    flags: {
        alphaName: 'catch_t',
    },
    dsp: ({ outs, state }, { sigBuses }) => ast `
        ${outs.$0} = ${sigBuses.read}(${state}.busName)
        ${sigBuses.reset}(${state}.busName)
    `,
    core: ({ ns }, globals) => sharedCore(ns, globals),
    dependencies: [
        sigBuses,
    ],
};
// --------------------------------- node implementation - send~ ---------------------------------- //
const nodeImplementationSend = {
    ...sharedNodeImplementation,
    flags: {
        alphaName: 'send_t',
    },
    dsp: ({ state, ins }, { sigBuses }) => ast `
        ${sigBuses.set}(${state}.busName, ${ins.$0})
    `,
    core: ({ ns }, globals) => sharedCore(ns, globals),
    dependencies: [
        sigBuses,
    ],
};
// --------------------------------- node implementation - receive~ ---------------------------------- //
const nodeImplementationReceive = {
    ...sharedNodeImplementation,
    flags: {
        alphaName: 'receive_t',
        isDspInline: true,
    },
    dsp: ({ state }, { sigBuses }) => ast `${sigBuses.read}(${state}.busName)`,
    messageReceivers: ({ ns, state }, { msg }) => ({
        '0': AnonFunc([Var(msg.Message, `m`)]) `
            if (
                ${msg.isMatching}(m, [${msg.STRING_TOKEN}, ${msg.STRING_TOKEN}])
                && ${msg.readStringToken}(m, 0) === 'set'
            ) {
                ${ns.setBusName}(${state}, ${msg.readStringToken}(m, 1))
                return
            }
        `
    }),
    core: ({ ns }, globals) => sharedCore(ns, globals),
    dependencies: [
        sigBuses,
    ]
};
// -------------------------------------------------------------------------------------------- //
const builders = {
    'throw~': builderThrow,
    'catch~': builderCatch,
    'send~': builderSend,
    'receive~': builderReceive,
};
const nodeImplementations = {
    'throw~': nodeImplementationThrow,
    'catch~': nodeImplementationCatch,
    'send~': nodeImplementationSend,
    'receive~': nodeImplementationReceive,
};

export { builders, nodeImplementations };
