import type { Description, FileNode, Graph, Operation, Part } from '../model.js';
/** Bump when the prompts change, so cached descriptions are written again. */
export declare const PROMPT_VERSION = "v1";
export interface RulesOptions {
    /** "Helu Map" */
    mapName: string;
    /** What the code is: "Helu's main web app (the app customers use)". */
    subject: string;
    /** Who reads the map, as a sentence. */
    readers: string;
    /** Who the plain description is for: "Becky". */
    plainReader: string;
    /** "Helu's own words" */
    ownWords: string;
    /** "the person using Helu" */
    user: string;
    /** Example of a title that isn't the file name, plus any naming rule. */
    titleExample: string;
    /** The words to avoid in plain descriptions and what to say instead. */
    codeWords: string;
    /** Domain nouns to keep, as a sentence, or null. */
    nouns: string | null;
    /** A specific plain sentence beating a vague one. */
    plainExample: string;
}
export declare const writingRules: (options: RulesOptions) => string;
/** What an adapter gives describe: the rules, background reading, and an overview for the whole-app summary. */
export interface DescribeContext {
    rules: RulesOptions;
    backgroundLabel: string;
    background: string;
    overviewLabel: string;
    overview: string;
}
export declare const systemPrompt: (context: DescribeContext) => string;
/** Plain-language defaults for a personal repo, where Lucas is the reader. */
export declare const personalRules: (name: string) => RulesOptions;
export declare const filesPrompt: (part: Part, files: {
    file: FileNode;
    content: string;
}[], graph: Graph) => string;
export declare const partPrompt: (part: Part, graph: Graph, fileDescriptions: Record<string, Description>, operations: Operation[]) => string;
export declare const appPrompt: (graph: Graph, partDescriptions: Record<string, Description>, context: DescribeContext) => string;
export declare const FILES_SCHEMA: {
    type: string;
    properties: {
        files: {
            type: string;
            items: {
                type: string;
                properties: {
                    title: {
                        readonly type: "string";
                    };
                    plain: {
                        readonly type: "string";
                    };
                    dev: {
                        readonly type: "string";
                    };
                    path: {
                        type: string;
                    };
                };
                required: string[];
            };
        };
    };
    required: string[];
};
export declare const PART_SCHEMA: {
    type: string;
    properties: {
        part: {
            readonly type: "object";
            readonly properties: {
                readonly title: {
                    readonly type: "string";
                };
                readonly plain: {
                    readonly type: "string";
                };
                readonly dev: {
                    readonly type: "string";
                };
            };
            readonly required: readonly ["title", "plain", "dev"];
        };
        operations: {
            type: string;
            items: {
                type: string;
                properties: {
                    title: {
                        readonly type: "string";
                    };
                    plain: {
                        readonly type: "string";
                    };
                    dev: {
                        readonly type: "string";
                    };
                    name: {
                        type: string;
                    };
                };
                required: string[];
            };
        };
    };
    required: string[];
};
export declare const APP_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly title: {
            readonly type: "string";
        };
        readonly plain: {
            readonly type: "string";
        };
        readonly dev: {
            readonly type: "string";
        };
    };
    readonly required: readonly ["title", "plain", "dev"];
};
