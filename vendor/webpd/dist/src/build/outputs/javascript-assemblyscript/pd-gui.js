import { discoverPdGui, traversePdGui } from '../../../pd-gui/index.js';

const collectIoMessageReceiversFromGui = (pd, graph) => _collectControlNodes(pd, graph).reduce((messageReceivers, node) => ({
    ...messageReceivers,
    [node.id]: ['0'],
}), {});
const collectIoMessageSendersFromGui = (pd, graph) => _collectControlNodes(pd, graph).reduce((messageSenders, node) => ({
    ...messageSenders,
    [node.id]: ['0'],
}), {});
const _collectControlNodes = (pdJson, graph) => {
    const pdGuiNodes = discoverPdGui(pdJson);
    const nodes = [];
    traversePdGui(pdGuiNodes, (control) => {
        if (control.nodeClass !== 'control') {
            return;
        }
        const node = graph[control.nodeId];
        // Important because some nodes are deleted at dsp-graph compilation.
        // and if we declare messageReceivers for them it will cause error.
        // TODO : maybe the compiler should detect this instead of doing it here ?
        if (node) {
            nodes.push(node);
        }
    });
    return nodes;
};

export { collectIoMessageReceiversFromGui, collectIoMessageSendersFromGui };
