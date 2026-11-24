export interface Capture {
    value: string;
    /** True when it was a string literal, false for an identifier. */
    quoted: boolean;
}
export interface TemplateMatch {
    index: number;
    end: number;
    /** True when a regular expression matched: its captures say nothing about quotes. */
    raw: boolean;
    values: Record<string, Capture>;
}
export interface CompiledTemplate {
    source: string;
    raw: boolean;
    names: string[];
    match(text: string): TemplateMatch[];
}
export declare const compileTemplate: (template: string | RegExp) => CompiledTemplate;
/**
 * Matches of several templates, tried in order. A match that starts where an
 * earlier template already matched is dropped, so a longer shape listed first
 * wins over a shorter one that covers the same code.
 */
export declare const matchAll: (templates: CompiledTemplate[], text: string) => TemplateMatch[];
