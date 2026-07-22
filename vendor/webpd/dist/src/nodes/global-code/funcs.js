import { Func, Var } from '../../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

const MAX_MIDI_FREQ = Math.pow(2, (1499 - 69) / 12) * 440;
// Also possible to use optimized version, but gives approximate results : 8.17579891564 * Math.exp(0.0577622650 * value)
const mtof = {
    namespace: 'funcs',
    // prettier-ignore
    code: ({ ns: funcs }) => Func(funcs.mtof, [
        Var(`Float`, `value`),
    ], 'Float') `
        return value <= -1500 ? 0: (value > 1499 ? ${MAX_MIDI_FREQ} : Math.pow(2, (value - 69) / 12) * 440)
    `,
};
// optimized version of formula : 12 * Math.log(freq / 440) / Math.LN2 + 69
// which is the same as : Math.log(freq / mtof(0)) * (12 / Math.LN2)
// which is the same as : Math.log(freq / 8.1757989156) * (12 / Math.LN2)
const ftom = {
    namespace: 'funcs',
    // prettier-ignore
    code: ({ ns: funcs }) => Func(funcs.ftom, [
        Var(`Float`, `value`),
    ], 'Float') `
        return value <= 0 ? -1500: 12 * Math.log(value / 440) / Math.LN2 + 69
    `,
};
// TODO : tests (see in binop)
const pow = {
    namespace: 'funcs',
    // prettier-ignore
    code: ({ ns: funcs }) => Func(funcs.pow, [
        Var(`Float`, `leftOp`),
        Var(`Float`, `rightOp`),
    ], 'Float') `
        return leftOp > 0 || (Math.round(rightOp) === rightOp) ? Math.pow(leftOp, rightOp): 0
    `,
};
// TODO : tests (see in binop)
const log = {
    namespace: 'funcs',
    // prettier-ignore
    code: ({ ns: funcs }) => Func(funcs.log, [
        Var(`Float`, `leftOp`),
        Var(`Float`, `rightOp`),
    ], 'Float') `
        return Math.max(Math.log(leftOp) / Math.log(rightOp), -1000)
    `,
};

export { ftom, log, mtof, pow };
