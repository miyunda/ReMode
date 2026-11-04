// Who owns a key press. Pure enough to test: it only reads the event target.

/** Fields where keys are text (or a <select>'s type-ahead), never shortcuts. */
const TYPING =
  'textarea, select, [contenteditable="true"], input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"])';

/** Controls that Space activates natively. */
const SPACE_CONTROLS = 'button, a[href], summary, input[type="checkbox"], input[type="radio"]';

export const isTyping = (target: EventTarget | null): boolean =>
  !!(target as Element | null)?.closest?.(TYPING);

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // older engines: keep the native behaviour
  }
}

/**
 * Should Space go to the transport? Not while typing, and not on a control
 * reached by keyboard, where Space means "activate this". A control that merely
 * keeps focus after a mouse click does not own Space: otherwise, after clicking
 * a variant tab, Space would click that tab again instead of pausing.
 */
export function spaceIsTransport(target: EventTarget | null): boolean {
  if (isTyping(target)) return false;
  const control = (target as Element | null)?.closest?.(SPACE_CONTROLS);
  return !control || !focusVisible(control);
}
