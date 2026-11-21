/** Runs `task` over `items` with at most `limit` running at once. */
export const runPool = async <T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> => {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    const item = queue.shift();
    if (item === undefined) return;
    await task(item);
    return worker();
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, worker)
  );
};
