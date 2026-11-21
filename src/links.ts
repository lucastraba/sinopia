import type { FileLink, FileNode } from './model.js';

/** Every link out of a file, with its kind: imports, rendered components and the adapter's own links. */
export const fileLinks = (file: FileNode): FileLink[] => [
  ...file.imports.map((target) => ({ target, kind: 'import', label: null })),
  ...file.components.flatMap((use) =>
    use.target ? [{ target: use.target, kind: 'component', label: use.tag }] : []
  ),
  ...(file.links ?? []),
];

/** The distinct file ids a file links to, whatever the kind. */
export const linkTargets = (file: FileNode): string[] => [
  ...new Set(fileLinks(file).map((link) => link.target)),
];

/**
 * Adds a link to a file node, once per target, kind and label. For adapters
 * that find links the generic scan can't see.
 */
export const addLink = (file: FileNode, link: FileLink): void => {
  const links = (file.links ??= []);
  if (
    !links.some(
      (existing) =>
        existing.target === link.target &&
        existing.kind === link.kind &&
        existing.label === link.label
    )
  ) {
    links.push(link);
  }
};
