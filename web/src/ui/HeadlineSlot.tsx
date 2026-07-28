// The one sentence slot above the board — docs/DESIGN-DIRECTION.md §8
// ("Above it, one slot holding a single sentence") and §10 ("Headline
// slot... fixed 96px min-height on phone so the board never jumps").

import './HeadlineSlot.css';

export interface HeadlineSlotProps {
  contextLine?: string;
  sentence: string;
  /** The Setup illegal-position / error treatment (design §8.3): a
   * `--c-n-0` surface with a 3px `Frame` left edge. */
  variant?: 'default' | 'error';
}

export function HeadlineSlot({ contextLine, sentence, variant = 'default' }: HeadlineSlotProps) {
  return (
    <div className="headline" data-variant={variant} aria-live="polite">
      {contextLine && <p className="headline__context">{contextLine}</p>}
      <p className="headline__sentence">{sentence}</p>
    </div>
  );
}
