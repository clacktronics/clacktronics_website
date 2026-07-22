import { Sequence, ConstVar, Func, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';
import { msg } from '../../../node_modules/@webpd/compiler/dist/src/stdlib/msg/msg.js';

const sigBuses = {
    namespace: 'sigBuses',
    // prettier-ignore
    code: ({ ns: sigBuses }) => Sequence([
        ConstVar(`Map<string, Float>`, sigBuses._BUSES, `new Map()`),
        `${sigBuses._BUSES}.set('', 0)`,
        Func(sigBuses.addAssign, [
            Var(`string`, `busName`),
            Var(`Float`, `value`)
        ], 'Float') `
            ${ConstVar('Float', 'newValue', `${sigBuses._BUSES}.get(busName) + value`)}
            ${sigBuses._BUSES}.set(
                busName,
                newValue,
            )
            return newValue
        `,
        Func(sigBuses.set, [
            Var(`string`, `busName`),
            Var(`Float`, `value`),
        ], 'void') `
            ${sigBuses._BUSES}.set(
                busName,
                value,
            )
        `,
        Func(sigBuses.reset, [
            Var(`string`, `busName`)
        ], 'void') `
            ${sigBuses._BUSES}.set(busName, 0)
        `,
        Func(sigBuses.read, [
            Var(`string`, `busName`)
        ], 'Float') `
            return ${sigBuses._BUSES}.get(busName)
        `
    ]),
};
const msgBuses = {
    namespace: 'msgBuses',
    // prettier-ignore
    code: ({ ns: msgBuses }, { msg }) => Sequence([
        ConstVar(`Map<string, Array<${msg.Handler}>>`, msgBuses._BUSES, 'new Map()'),
        Func(msgBuses.publish, [
            Var(`string`, `busName`),
            Var(msg.Message, `message`)
        ], 'void') `
            ${Var(`Int`, `i`, `0`)}
            ${ConstVar(`Array<${msg.Handler}>`, 'callbacks', `${msgBuses._BUSES}.has(busName) ? ${msgBuses._BUSES}.get(busName): []`)}
            for (i = 0; i < callbacks.length; i++) {
                callbacks[i](message)
            }
        `,
        Func(msgBuses.subscribe, [
            Var(`string`, `busName`),
            Var(msg.Handler, `callback`)
        ], 'void') `
            if (!${msgBuses._BUSES}.has(busName)) {
                ${msgBuses._BUSES}.set(busName, [])
            }
            ${msgBuses._BUSES}.get(busName).push(callback)
        `,
        Func(msgBuses.unsubscribe, [
            Var(`string`, `busName`),
            Var(msg.Handler, `callback`)
        ], 'void') `
            if (!${msgBuses._BUSES}.has(busName)) {
                return
            }
            ${ConstVar(`Array<${msg.Handler}>`, `callbacks`, `${msgBuses._BUSES}.get(busName)`)}
            ${ConstVar(`Int`, `found`, `callbacks.indexOf(callback)`)}
            if (found !== -1) {
                callbacks.splice(found, 1)
            }
        `
    ]),
    dependencies: [msg],
};

export { msgBuses, sigBuses };
