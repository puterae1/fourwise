// A typed escape hatch for setting CSS custom properties via inline
// `style`. React's `CSSProperties` type doesn't (in the TypeScript version
// pinned here) accept arbitrary `--custom-property` keys, and several
// components need to hand a per-instance value (a column index, a colour
// name) to CSS that a static stylesheet can't know ahead of time — the
// lamp caret's horizontal position, the turn caret's tint. One shared,
// narrow cast, rather than repeating `as unknown as CSSProperties` at every
// call site.

import type { CSSProperties } from 'react';

export type CSSVars = CSSProperties & Record<`--${string}`, string | number | undefined>;
