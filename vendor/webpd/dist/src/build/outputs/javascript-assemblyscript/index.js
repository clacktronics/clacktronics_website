import { collectIoMessageReceiversFromSendNodes, collectIoMessageSendersFromReceiveNodes } from './send-receive.js';
import { collectIoMessageReceiversFromGui, collectIoMessageSendersFromGui } from './pd-gui.js';
import { discoverPdGui, traversePdGui } from '../../../pd-gui/index.js';

const applySettingsDefaults = (settings, graph, pd) => {
    const webPdMetadata = {
        pdNodes: {},
        graph: {},
        pdGui: [],
    };
    const io = settings.io || {};
    // If io.messageReceivers / io.messageSenders are not defined, we infer them by
    // discovering UI controls and [send] / [receive] nodes and generating
    // messageReceivers / messageSenders for each one.
    if (!io.messageReceivers) {
        io.messageReceivers = {
            ...collectIoMessageReceiversFromGui(pd, graph),
            ...collectIoMessageReceiversFromSendNodes(pd, graph),
        };
    }
    if (!io.messageSenders) {
        io.messageSenders = {
            ...collectIoMessageSendersFromGui(pd, graph),
            ...collectIoMessageSendersFromReceiveNodes(pd, graph),
        };
    }
    Object.keys(io.messageReceivers).forEach((nodeId) => {
        webPdMetadata.graph[nodeId] = graph[nodeId];
    });
    Object.keys(io.messageSenders).forEach((nodeId) => {
        webPdMetadata.graph[nodeId] = graph[nodeId];
    });
    if (pd) {
        const pdGui = discoverPdGui(pd);
        traversePdGui(pdGui, (pdGuiNode) => {
            // Add pd node to customMetadata
            // We keep both controls and subpatches
            webPdMetadata.pdNodes[pdGuiNode.patchId] =
                webPdMetadata.pdNodes[pdGuiNode.patchId] || {};
            webPdMetadata.pdNodes[pdGuiNode.patchId][pdGuiNode.pdNodeId] =
                pd.patches[pdGuiNode.patchId].nodes[pdGuiNode.pdNodeId];
            // Add dsp graph node to customMetadata
            // Keep only controls, because subpatches are not part of the dsp graph
            if (pdGuiNode.nodeClass === 'control') {
                const node = graph[pdGuiNode.nodeId];
                if (node) {
                    webPdMetadata.graph[pdGuiNode.nodeId] = node;
                }
            }
        });
        webPdMetadata.pdGui = pdGui;
    }
    return {
        ...settings,
        io,
        customMetadata: {
            ...(settings.customMetadata || {}),
            ...webPdMetadata,
        },
    };
};

export { applySettingsDefaults };
