// The one sentence slot above the board — docs/DESIGN-DIRECTION.md §8
// ("Above it, one slot holding a single sentence") and §10 ("Headline
// slot... fixed 96px min-height on phone so the board never jumps").

import './HeadlineSlot.css';

export interface HeadlineSlotProps {
  contextLine?: string;
  sentence: string;
  /** The Setup illegal-position / error treatment (design §8.3) and the Play
   * blunder line (design §8.1) share the same `--c-n-0` surface with a 3px
   * `Frame` left edge -- 'blunder' is its own variant only so the dismiss
   * control (below) can attach to it specifically. */
  variant?: 'default' | 'error' | 'blunder';
  /**
   * Non-blocking dismiss for the blunder line (task requirement, on top of
   * design §8.1's "no button on the blunder line" -- that rule is about NOT
   * lighting/naming a second column here, not about withholding a close
   * control). Only ever passed for `variant === 'blunder'`; the game is
   * never blocked by this banner either way -- dismissing it does not touch
   * the position, and the next move/undo/jump replaces it regardless.
   */
  onDismiss?: () => void;
}

export function HeadlineSlot({ contextLine, sentence, variant = 'default', onDismiss }: HeadlineSlotProps) {
  return (
    <div className="headline" data-variant={variant} aria-live="polite">
      {onDismiss && (
        <button type="button" className="headline__dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
      {contextLine && <p className="headline__context">{contextLine}</p>}
      <p className="headline__sentence">{sentence}</p>
    </div>
  );
}
