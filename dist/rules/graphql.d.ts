import type { OperationType } from '../model.js';
import { type CommonOptions, type Rule, type Scope } from './context.js';
export interface GraphqlOptions extends CommonOptions {
    /** Where the operations are declared: `.graphql`/`.gql` files, and gql`…` or graphql(`…`) in code. Default: the whole repo. */
    documents?: Scope;
    /**
     * The file(s) graphql-codegen writes (`src/gql/generated.ts`). With it, only
     * names the client exports count, only files that import it (or a file that
     * re-exports it) are callers, and each document links to it.
     */
    client?: string | string[];
    /** Files that call the operations. Default: the whole repo. */
    in?: Scope;
}
export type DefinitionKind = OperationType | 'fragment';
export interface GraphqlDefinition {
    kind: DefinitionKind;
    name: string;
    /** Offsets in the text the definitions were read from. */
    start: number;
    end: number;
    /** Top-level fields of its selection, aliases dropped. */
    rootFields: string[];
    /** Fragments it spreads (`...TodoFields`). */
    spreads: string[];
}
/** GraphQL text with `#` comments blanked out, offsets kept. Strings, block strings included, stay. */
export declare const stripGraphqlComments: (text: string) => string;
/** The named operations and fragments of a GraphQL text, at the top level only. */
export declare const graphqlDefinitions: (source: string) => GraphqlDefinition[];
/** gql`…` and graphql(`…`) in code: the text of each, at its offset in the file. */
export declare const taggedDocuments: (code: string) => {
    index: number;
    text: string;
}[];
/**
 * An operation name as graphql-codegen writes it: PascalCase by change-case's
 * rules, underscores kept (`currentUser` → `CurrentUser`, `setAPIKey` →
 * `SetApiKey`, `list_todos` → `List_Todos`).
 */
export declare const codegenName: (name: string) => string;
/**
 * The names codegen's plugins give a definition's hooks and documents: urql,
 * vue-apollo, Apollo React (`use…Query`, `use…LazyQuery`, `…Document`),
 * apollo-angular (`…GQL`), with and without `dedupeOperationSuffix` and
 * `omitOperationSuffix`. The last ones only count when the client exports them.
 */
export declare const generatedNames: (kind: DefinitionKind, name: string) => {
    sure: string[];
    ifExported: string[];
};
/**
 * GraphQL operations, matched across codegen's renaming: each file that uses a
 * generated hook or document (`useCurrentUserQuery`, `CurrentUserDocument`)
 * links to the document that declares `query currentUser`, and makes that
 * call as a server call on the map.
 */
export declare const graphql: (options?: GraphqlOptions) => Rule;
