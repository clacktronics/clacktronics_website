import { mtof, ftom } from '../global-code/funcs.js';
import { AnonFunc, Var, ConstVar } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

// ------------------------------- node builder ------------------------------ //
const builder = {
    translateArgs: () => ({}),
    build: () => ({
        inlets: {
            '0': { type: 'message', id: '0' },
        },
        outlets: {
            '0': { type: 'message', id: '0' },
        },
    }),
};
const makeNodeImplementation = ({ generateOperation, dependencies = [], }) => {
    // ------------------------------- node implementation ------------------------------ //
    return {
        messageReceivers: ({ snds }, globals) => {
            const { msg } = globals;
            return {
                '0': AnonFunc([Var(msg.Message, `m`)]) `
                    if (${msg.isMatching}(m, [${msg.FLOAT_TOKEN}])) {
                        ${ConstVar(`Float`, `value`, `${msg.readFloatToken}(m, 0)`)}
                        ${snds.$0}(${msg.floats}([${generateOperation(globals)}]))
                        return
                    }
                `
            };
        },
        dependencies
    };
};
// ------------------------------------------------------------------- //
const nodeImplementations = {
    'abs': makeNodeImplementation({ generateOperation: () => `Math.abs(value)` }),
    'wrap': makeNodeImplementation({ generateOperation: () => `(1 + (value % 1)) % 1` }),
    'cos': makeNodeImplementation({ generateOperation: () => `Math.cos(value)` }),
    'sin': makeNodeImplementation({ generateOperation: () => `Math.sin(value)` }),
    'tan': makeNodeImplementation({ generateOperation: () => `Math.tan(value)` }),
    'atan': makeNodeImplementation({ generateOperation: () => `Math.atan(value)` }),
    'exp': makeNodeImplementation({ generateOperation: () => `Math.exp(value)` }),
    'sqrt': makeNodeImplementation({ generateOperation: () => `value >= 0 ? Math.pow(value, 0.5): 0` }),
    'mtof': makeNodeImplementation({ generateOperation: ({ funcs }) => `${funcs.mtof}(value)`, dependencies: [mtof] }),
    'ftom': makeNodeImplementation({ generateOperation: ({ funcs }) => `${funcs.ftom}(value)`, dependencies: [ftom] }),
    'rmstodb': makeNodeImplementation({ generateOperation: () => `value <= 0 ? 0 : 20 * Math.log(value) / Math.LN10 + 100` }),
    'dbtorms': makeNodeImplementation({ generateOperation: () => `value <= 0 ? 0 : Math.exp(Math.LN10 * (value - 100) / 20)` }),
    'powtodb': makeNodeImplementation({ generateOperation: () => `value <= 0 ? 0 : 10 * Math.log(value) / Math.LN10 + 100` }),
    'dbtopow': makeNodeImplementation({ generateOperation: () => `value <= 0 ? 0 : Math.exp(Math.LN10 * (value - 100) / 10)` }),
    // Implement vu as a noop
    'vu': makeNodeImplementation({ generateOperation: () => `value` }),
};
const builders = {
    'abs': builder,
    'cos': builder,
    'sin': builder,
    'tan': builder,
    'atan': builder,
    'exp': builder,
    'wrap': builder,
    'sqrt': builder,
    'mtof': builder,
    'ftom': builder,
    'rmstodb': builder,
    'dbtorms': builder,
    'powtodb': builder,
    'dbtopow': builder,
    'vu': builder,
};

export { builders, nodeImplementations };
