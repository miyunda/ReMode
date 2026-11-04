// Who owns a key press. Pure enough to test: it only reads the event target.

/** Fields where keys are text (or a <select>'s type-ahead), never shortcuts. */
const TYPING =
  'textarea, select, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"])';

/** Controls that Space activates natively. */
const SPACE_CONTROLS = 'button, a[href], summary, input[type="checkbox"], input[type="radio"]';

export const isTyping = (target: EventTarget | null): boolean =>
  !!(target as Element | null)?.closest?.(TYPING);

/**
 * Should Space go to the transport? Not while typing, and not on a control
 * reached by keyboard, where Space means "activate this". A control that merely
 * keeps focus after a mouse click does not own Space: otherwise, after clicking
 * a variant tab, Space would click that tab again instead of pausing.
 * (:focus-visible cannot tell these apart: a key press turns it on.)
 */
export function spaceIsTransport(target: EventTarget | null, focusedByPointer: boolean): boolean {
  if (isTyping(target)) return false;
  return focusedByPointer || !(target as Element | null)?.closest?.(SPACE_CONTROLS);
}
