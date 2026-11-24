import { type CommonOptions, type Rule, type Scope } from './context.js';
export interface TrpcOptions extends CommonOptions {
    /** Where the server declares its routers. */
    routers: Scope;
    /** Files that call procedures. Defaults to everything outside `routers`. */
    callers?: Scope;
    /** The client object callers import: `trpc.counter.increment.mutate()`. */
    client?: string;
    /** How a router is made: `t.router`, `router`. */
    router?: string | string[];
    /** How a procedure starts: `t.procedure`, `publicProcedure`. */
    procedure?: string | string[];
    /**
     * Also link the files that build the client (`httpBatchLink`, `httpLink`,
     * `createWSClient`) to the server files that answer them: the HTTP handler
     * mounted at that path, the WebSocketServer listening on it. Default true.
     */
    connection?: boolean;
}
export declare const trpc: (options: TrpcOptions) => Rule;
