import '../../../node_modules/@webpd/runtime/dist/src/utils.js';
import index from '../../../node_modules/@webpd/runtime/dist/src/fs-web/index.js';
import { urlDirName } from './url-helpers.js';
import { readMetadata as readMetadata$1 } from '../../../node_modules/@webpd/compiler/dist/src/run/index.js';

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
const defaultSettingsForRun = (patchUrl, messageSender) => {
    const rootUrl = urlDirName(patchUrl);
    return {
        messageHandler: (node, messageEvent) => {
            const message = messageEvent.data;
            switch (message.type) {
                case 'fs':
                    return index(node, messageEvent, { rootUrl });
                case 'io:messageSender':
                    if (messageSender) {
                        messageSender(message.payload.nodeId, message.payload.portletId, message.payload.message);
                    }
                    return null;
                default:
                    return null;
            }
        },
    };
};
const readMetadata = (compiledPatch) => {
    if (typeof compiledPatch === 'string') {
        return readMetadata$1('javascript', compiledPatch);
    }
    else {
        return readMetadata$1('assemblyscript', compiledPatch);
    }
};

export { defaultSettingsForRun, readMetadata };
