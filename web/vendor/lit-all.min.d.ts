// Types for the vendored lit bundle, as far as the app uses it (src/lib/html.js). With this beside it, the type check
// reads these few lines and leaves the bundle itself alone. The browser never asks for this file.

/** What a template tag gives back: something to pass to render(), or to put inside another template. */
export type Template = { readonly _template: unique symbol };

export function html(strings: TemplateStringsArray, ...values: unknown[]): Template;
export function staticHtml(strings: TemplateStringsArray, ...values: unknown[]): Template;
export function unsafeStatic(value: string): unknown;
export function render(value: unknown, container: Element | DocumentFragment): unknown;
/** Renders nothing at all, where '' would leave an empty text node. */
export const nothing: Template;
export function repeat<T>(items: Iterable<T>, keyOrTemplate: (item: T, index: number) => unknown, template?: (item: T, index: number) => unknown): Template;
export function keyed(key: unknown, value: unknown): Template;
export function live(value: unknown): unknown;
export function ifDefined(value: unknown): unknown;
export function unsafeHTML(value: string | null | undefined): Template;
