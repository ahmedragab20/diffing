/**
 * Lazy loader for the `@pierre/diffs/edit` entry point.
 *
 * The Editor implementation is a separate bundle from the core renderer.
 * We only pull it into the page when the user first enters edit mode, so
 * review-only sessions never pay the editor cost. The module is cached after
 * the first successful load and retried on failure.
 */

let modulePromise: Promise<typeof import('@pierre/diffs/edit')> | null = null
let editorClass: typeof import('@pierre/diffs/edit').Editor | null = null

export function loadEditModule(): Promise<typeof import('@pierre/diffs/edit')> {
  if (!modulePromise) {
    modulePromise = import('@pierre/diffs/edit')
      .then((mod) => {
        editorClass = mod.Editor
        return mod
      })
      .catch((err) => {
        modulePromise = null
        editorClass = null
        throw err
      })
  }
  return modulePromise
}

/** Loads the edit entry and caches the Editor class for EditProvider. */
export async function ensureEditModuleLoaded(): Promise<void> {
  await loadEditModule()
}

/** Editor class cached by the lazy load; null until the module has loaded. */
export function getEditorClass(): typeof import('@pierre/diffs/edit').Editor | null {
  return editorClass
}
