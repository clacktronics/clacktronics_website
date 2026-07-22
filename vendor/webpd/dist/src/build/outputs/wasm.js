let ASC = null;
/**
 * This function sets the assemblyscript compiler so that WebPd can use it.
 * The assemblyscript compiler is quite heavy and causes problems with bundling.
 * Also, depending on the host environment (web or node), it is loaded differently.
 * Therefore we leave it to the consumer to load it themselves and then pass the loaded
 * instance to WebPd.
 */
const setAsc = (asc) => ASC = asc;
const compileAssemblyscript = async (code, bitDepth) => {
    if (!ASC) {
        throw new Error(`assemblyscript compiler was not set properly. Please use WebPd's setAsc function to initialize it.`);
    }
    const compileOptions = {
        optimizeLevel: 3,
        runtime: 'incremental',
        exportRuntime: true,
        sourceMap: true,
    };
    if (bitDepth === 32) {
        // For 32 bits version of Math
        compileOptions.use = ['Math=NativeMathf'];
    }
    const { error, binary, stderr } = await ASC.compileString(code, compileOptions);
    if (error) {
        throw new Error(stderr.toString());
    }
    return binary.buffer;
};

export { compileAssemblyscript, setAsc };
