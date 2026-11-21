/** Runs `task` over `items` with at most `limit` running at once. */
export declare const runPool: <T>(items: T[], limit: number, task: (item: T) => Promise<void>) => Promise<void>;
