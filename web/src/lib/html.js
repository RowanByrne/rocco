// Templates, from the vendored lit (web/vendor/lit-all.min.js). Text put into a template is escaped, and rendering the
// same template again changes only what differs, so scroll, focus and what's being typed stay where they are.
import { staticHtml, unsafeStatic } from '../../vendor/lit-all.min.js';

export { html, render, nothing, repeat, keyed, live, ifDefined, unsafeHTML } from '../../vendor/lit-all.min.js';

// Our own fixed markup (an icon's SVG) as a template. Never for text that comes from outside.
export const fixed = markup => staticHtml`${unsafeStatic(markup)}`;
