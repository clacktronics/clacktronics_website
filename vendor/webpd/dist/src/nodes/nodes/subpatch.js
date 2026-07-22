const emptyBuilder = {
    translateArgs: () => ({}),
    build: () => ({
        inlets: {},
        outlets: {},
    }),
};
const nodeBuilders = {
    pd: emptyBuilder,
    inlet: emptyBuilder,
    outlet: emptyBuilder,
    'inlet~': emptyBuilder,
    'outlet~': emptyBuilder,
};

export { nodeBuilders };
