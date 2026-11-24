/** Where a project keeps its own adapter. `sinopia` loads it by default when it exists. */
export declare const LOCAL_ADAPTER = ".sinopia/adapter.mjs";
export declare const adapterTemplate: (name: string, mode: "js" | "plain", date: string) => string;
export declare const mapTemplate: (name: string, date: string) => string;
export declare const mapInit: ({ repo, force }: {
    repo: string;
    force: boolean;
}) => void;
export declare const adapterInit: ({ repo, mode, force, }: {
    repo: string;
    mode: "js" | "plain" | null;
    force: boolean;
}) => void;
