import { buildGraphNodeId } from '../../../compile-dsp-graph/to-dsp-graph.js';
import { resolveRootPatch } from '../../../compile-dsp-graph/compile-helpers.js';

const collectIoMessageReceiversFromSendNodes = (pdJson, graph) => _collectSendReceiveNodes(pdJson, graph, 'send').reduce((messageReceivers, node) => ({
    ...messageReceivers,
    [node.id]: ['0'],
}), {});
const collectIoMessageSendersFromReceiveNodes = (pdJson, graph) => _collectSendReceiveNodes(pdJson, graph, 'receive').reduce((messageSenders, node) => ({
    ...messageSenders,
    [node.id]: ['0'],
}), {});
const _collectSendReceiveNodes = (pdJson, graph, nodeType) => {
    const rootPatch = resolveRootPatch(pdJson);
    return Object.values(rootPatch.nodes)
        .map((pdNode) => {
        const nodeId = buildGraphNodeId(rootPatch.id, pdNode.id);
        const node = graph[nodeId];
        if (
        // Important because some nodes are deleted at dsp-graph compilation.
        // and if we declare messageReceivers for them it will cause error.
        // TODO : maybe the compiler should detect this instead of doing it here ?
        !!node &&
            node.type === nodeType) {
            return node;
        }
        else {
            return null;
        }
    })
        .filter((node) => node !== null);
};

export { collectIoMessageReceiversFromSendNodes, collectIoMessageSendersFromReceiveNodes };
