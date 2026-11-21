/** Runs `task` over `items` with at most `limit` running at once. */
export const runPool = async (items, limit, task) => {
    const queue = [...items];
    const worker = async () => {
        const item = queue.shift();
        if (item === undefined)
            return;
        await task(item);
        return worker();
    };
    await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
};
