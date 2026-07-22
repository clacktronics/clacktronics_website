import { ValidationError } from './validation.js';
import { Func, Var, ConstVar } from '../../node_modules/@webpd/compiler/dist/src/ast/declare.js';

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
const TYPE_ARGUMENTS = [
    'float',
    'bang',
    'symbol',
    'list',
    'anything',
];
const resolveTypeArgumentAlias = (value) => {
    switch (value) {
        case 'f':
            return 'float';
        case 'b':
            return 'bang';
        case 's':
            return 'symbol';
        case 'l':
            return 'list';
        case 'a':
            return 'anything';
        case 'p':
            return 'pointer';
        default:
            return value;
    }
};
const assertTypeArgument = (value) => {
    if (value === 'pointer') {
        throw new ValidationError(`"pointer" not supported (yet)`);
    }
    else if (!TYPE_ARGUMENTS.includes(value)) {
        throw new ValidationError(`invalid type ${value}`);
    }
    return value;
};
const renderMessageTransfer = (typeArgument, msgVariableName, index, { msg, bangUtils, tokenConversion }) => {
    switch (typeArgument) {
        case 'float':
            return `${msg.floats}([${tokenConversion.toFloat}(${msgVariableName}, ${index})])`;
        case 'bang':
            return `${bangUtils.bang}()`;
        case 'symbol':
            return `${msg.strings}([${tokenConversion.toString_}(${msgVariableName}, ${index})])`;
        case 'list':
        case 'anything':
            return `${msgVariableName}`;
        default:
            throw new Error(`type argument ${typeArgument} not supported (yet)`);
    }
};
const NAMESPACE = 'tokenConversion';
const messageTokenToFloat = {
    namespace: NAMESPACE,
    // prettier-ignore
    code: ({ ns: tokenConversion }, { msg }) => Func(tokenConversion.toFloat, [
        Var(msg.Message, `m`),
        Var(`Int`, `i`)
    ], 'Float') `
        if (${msg.isFloatToken}(m, i)) {
            return ${msg.readFloatToken}(m, i)
        } else {
            return 0
        }
    `,
};
const messageTokenToString = {
    namespace: NAMESPACE,
    // prettier-ignore
    code: ({ ns: tokenConversion }, { msg }) => Func(tokenConversion.toString_, [
        Var(msg.Message, `m`),
        Var(`Int`, `i`)
    ], 'string') `
        if (${msg.isStringToken}(m, i)) {
            ${ConstVar(`string`, `str`, `${msg.readStringToken}(m, i)`)}
            if (str === 'bang') {
                return 'symbol'
            } else {
                return str
            }
        } else {
            return 'float'
        }
    `,
};

export { assertTypeArgument, messageTokenToFloat, messageTokenToString, renderMessageTransfer, resolveTypeArgumentAlias };
