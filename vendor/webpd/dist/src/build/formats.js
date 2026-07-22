const BUILD_FORMATS = {
    pd: {
        extensions: ['.pd'],
        description: 'Pure Data text',
    },
    pdJson: {
        extensions: ['.pd.json'],
        description: 'Pure Data JSON',
    },
    dspGraph: {
        extensions: ['.dsp-graph.json'],
        description: 'WebPd DSP graph',
    },
    javascript: {
        extensions: ['.js'],
        description: 'JavaScript WebPd module',
    },
    assemblyscript: {
        extensions: ['.as', '.ts'],
        description: 'AssemblyScript DSP code',
    },
    wasm: {
        extensions: ['.wasm'],
        description: 'Web Assembly WebPd module',
    },
    wav: {
        extensions: ['.wav'],
        description: 'An audio preview of your patch',
    },
    app: {
        extensions: [],
        description: 'Complete web app embedding your compiled WebPd patch',
    },
};
const BUILD_TREE = [
    'pd',
    'pdJson',
    'dspGraph',
    [
        ['javascript', 'wav'],
        ['assemblyscript', 'wasm', 'wav'],
        ['assemblyscript', 'wasm', 'app'],
        ['javascript', 'app'],
    ],
];
const guessFormat = (filepath) => {
    const formats = Object.entries(BUILD_FORMATS).filter(([_, specs]) => {
        if (specs.extensions.some((extension) => filepath.endsWith(extension))) {
            return true;
        }
        return false;
    });
    if (formats.length === 0) {
        return null;
    }
    return formats[0][0];
};
const listBuildSteps = (inFormat, outFormat, intermediateStep) => {
    let paths = _findBuildPaths(BUILD_TREE, outFormat, [])
        .filter((path) => path.includes(inFormat))
        .map((path) => path.slice(path.indexOf(inFormat) + 1));
    if (intermediateStep && intermediateStep !== inFormat) {
        paths = paths.filter((path) => path.includes(intermediateStep));
    }
    if (paths.length === 0) {
        return null;
    }
    return paths[0];
};
const listOutputFormats = (inFormat) => new Set(_traverseBuildTree(BUILD_TREE, [])
    .filter((path) => path.includes(inFormat))
    .map((path) => path.slice(path.indexOf(inFormat) + 1))
    .flat());
const _findBuildPaths = (branch, target, parentPath) => {
    let path = [...parentPath];
    return branch.flatMap((node) => {
        if (Array.isArray(node)) {
            return _findBuildPaths(node, target, path);
        }
        path = [...path, node];
        if (node === target) {
            return [path];
        }
        return [];
    });
};
const _traverseBuildTree = (branch, parentPath) => {
    let path = [...parentPath];
    return branch.flatMap((node, i) => {
        if (Array.isArray(node)) {
            return _traverseBuildTree(node, path);
        }
        path = [...path, node];
        if (i === branch.length - 1) {
            return [path];
        }
        return [];
    });
};

export { BUILD_FORMATS, BUILD_TREE, _findBuildPaths, _traverseBuildTree, guessFormat, listBuildSteps, listOutputFormats };
