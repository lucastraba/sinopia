import { type Server } from 'node:http';
export interface ServeOptions {
    host: string;
    port: number;
    /** One map: its folder (graph.json, descriptions.json, diff.json), served at /. */
    data?: string;
    /** Many maps: a folder with one subfolder per project, served at /p/<name>/. */
    maps?: string;
}
/**
 * Serves the prebuilt viewer and map data over plain HTTP: one map at / with
 * `data`, or every map under `maps` at /p/<name>/ with an index at /.
 */
export declare const serve: ({ host, port, data, maps }: ServeOptions) => Server;
