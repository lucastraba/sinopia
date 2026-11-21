/**
 * The adapter interface version this sinopia implements. Bump it on any change
 * an existing adapter has to follow, and add a section to docs/adapters.md
 * ("Changes between versions") that says how to upgrade.
 */
export const ADAPTER_INTERFACE_VERSION = 1;
/** Thrown when an adapter was written for another interface version. */
export class AdapterVersionError extends Error {
}
/**
 * Refuses an adapter written for another interface version, with what to do
 * about it. `source` names where the adapter came from, for the message.
 */
export const assertAdapterVersion = (adapter, source) => {
    const declared = adapter.interfaceVersion;
    const want = ADAPTER_INTERFACE_VERSION;
    if (declared === want)
        return;
    const docs = 'docs/adapters.md in the sinopia repo, or `sinopia adapter docs`';
    if (typeof declared !== 'number') {
        throw new AdapterVersionError(`The adapter in ${source} declares no interfaceVersion, so it predates versioned adapters. ` +
            `This sinopia implements adapter interface v${want}. Upgrade the adapter: follow "Changes between versions" in ${docs}, ` +
            `then set interfaceVersion: ${want}. The sinopia-adapter skill does this for you.`);
    }
    if (declared < want) {
        throw new AdapterVersionError(`The adapter in ${source} implements adapter interface v${declared}; this sinopia needs v${want}. ` +
            `Upgrade the adapter: follow "Changes between versions" from v${declared} to v${want} in ${docs}, ` +
            `then set interfaceVersion: ${want}. The sinopia-adapter skill does this for you.`);
    }
    throw new AdapterVersionError(`The adapter in ${source} implements adapter interface v${declared}, newer than this sinopia (v${want}). ` +
        'Update sinopia to a version that supports it.');
};
