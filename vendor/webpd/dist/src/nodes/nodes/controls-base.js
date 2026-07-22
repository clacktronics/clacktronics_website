import { Sequence, Func, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

const EMPTY_BUS_NAME = 'empty';
const build = () => ({
    inlets: {
        '0': { type: 'message', id: '0' },
    },
    outlets: {
        '0': { type: 'message', id: '0' },
    },
    // This is always true, because the object can receive 
    // messages through message bus
    isPushingMessages: true
});
const controlsCore = (ns, { msg, msgBuses }) => Sequence([
    Func(ns.setReceiveBusName, [
        Var(ns.State, `state`),
        Var(`string`, `busName`),
    ], 'void') `
            if (state.receiveBusName !== "${EMPTY_BUS_NAME}") {
                ${msgBuses.unsubscribe}(state.receiveBusName, state.messageReceiver)
            }
            state.receiveBusName = busName
            if (state.receiveBusName !== "${EMPTY_BUS_NAME}") {
                ${msgBuses.subscribe}(state.receiveBusName, state.messageReceiver)
            }
        `,
    Func(ns.setSendReceiveFromMessage, [
        Var(ns.State, `state`),
        Var(msg.Message, `m`),
    ], 'boolean') `
            if (
                ${msg.isMatching}(m, [${msg.STRING_TOKEN}, ${msg.STRING_TOKEN}])
                && ${msg.readStringToken}(m, 0) === 'receive'
            ) {
                ${ns.setReceiveBusName}(state, ${msg.readStringToken}(m, 1))
                return true

            } else if (
                ${msg.isMatching}(m, [${msg.STRING_TOKEN}, ${msg.STRING_TOKEN}])
                && ${msg.readStringToken}(m, 0) === 'send'
            ) {
                state.sendBusName = ${msg.readStringToken}(m, 1)
                return true
            }
            return false
        `,
    Func(ns.defaultMessageHandler, [Var(msg.Message, `m`)], `void`) ``,
]);

export { EMPTY_BUS_NAME, build, controlsCore };
