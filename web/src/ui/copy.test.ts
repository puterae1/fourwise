import { describe, expect, it } from 'vitest';
import { blunderSentence } from './copy.js';

describe('blunderSentence', () => {
  it('phrases a win thrown away generically ("a win"), covering both win -> draw and win -> loss', () => {
    expect(blunderSentence('win', 3)).toBe('That threw away a win. Column 4 held it.');
  });

  it('phrases a draw thrown away distinctly (draw -> loss), never claiming a win existed', () => {
    expect(blunderSentence('draw', 6)).toBe('That threw away the draw. Column 7 held it.');
  });

  it('names the 1-indexed column', () => {
    expect(blunderSentence('win', 0)).toContain('Column 1 held it.');
  });
});
