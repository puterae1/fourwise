import { describe, expect, it } from 'vitest';
import { buildPlyTrack, notEvaluatedLine, plyMark, type PlyKnowledge } from './reviewTrack.js';

const win: PlyKnowledge = { evaluated: true, kind: 'win', best: 3 };
const draw: PlyKnowledge = { evaluated: true, kind: 'draw', best: 2 };
const loss: PlyKnowledge = { evaluated: true, kind: 'loss', best: 0 };
const unevaluated: PlyKnowledge = { evaluated: false, kind: null, best: null };

describe('plyMark', () => {
  it('is unevaluated when the "before" side is missing entirely', () => {
    expect(plyMark(undefined, win)).toEqual({ kind: 'unevaluated' });
  });

  it('is unevaluated when the "after" side is missing entirely', () => {
    expect(plyMark(win, undefined)).toEqual({ kind: 'unevaluated' });
  });

  it('is unevaluated when either side was analysed but never settled (SPEC §3.1, never a guess)', () => {
    expect(plyMark(unevaluated, win)).toEqual({ kind: 'unevaluated' });
    expect(plyMark(win, unevaluated)).toEqual({ kind: 'unevaluated' });
  });

  it('is clean when the verdict kind does not degrade (win -> win, distance-only change)', () => {
    expect(plyMark(win, win)).toEqual({ kind: 'clean' });
  });

  it('is clean when the verdict actually improves (loss -> draw, the opponent\'s own mistake)', () => {
    expect(plyMark(loss, draw)).toEqual({ kind: 'clean' });
  });

  it('is a blunder when the verdict degrades win -> draw, carrying the pre-move best column and kind', () => {
    expect(plyMark(win, draw)).toEqual({ kind: 'blunder', bestColumnBefore: 3, beforeKind: 'win' });
  });

  it('is a blunder when the verdict degrades draw -> loss', () => {
    expect(plyMark(draw, loss)).toEqual({ kind: 'blunder', bestColumnBefore: 2, beforeKind: 'draw' });
  });

  it('is a blunder when the verdict degrades win -> loss', () => {
    expect(plyMark(win, loss)).toEqual({ kind: 'blunder', bestColumnBefore: 3, beforeKind: 'win' });
  });
});

describe('buildPlyTrack', () => {
  it('builds one mark per move and counts only the genuinely unevaluated ones', () => {
    // A 4-move game: ply0=win(best 3), ply1=unknown (never visited), ply2=draw(best 2), ply3=loss(best 0), ply4=unknown.
    const knowledge = new Map<number, PlyKnowledge>([
      [0, win],
      [2, draw],
      [3, loss],
    ]);
    const track = buildPlyTrack(4, (ply) => knowledge.get(ply));

    expect(track.marks).toEqual([
      { kind: 'unevaluated' }, // 0->1: ply1 never visited
      { kind: 'unevaluated' }, // 1->2: ply1 never visited
      { kind: 'blunder', bestColumnBefore: 2, beforeKind: 'draw' }, // 2->3: draw -> loss
      { kind: 'unevaluated' }, // 3->4: ply4 never visited
    ]);
    expect(track.notEvaluatedCount).toBe(3);
  });

  it('the count reaches zero once every move has settled evaluations on both sides', () => {
    const knowledge = new Map<number, PlyKnowledge>([
      [0, win],
      [1, win],
      [2, win],
    ]);
    const track = buildPlyTrack(2, (ply) => knowledge.get(ply));
    expect(track.notEvaluatedCount).toBe(0);
    expect(track.marks.every((m) => m.kind === 'clean')).toBe(true);
  });
});

describe('notEvaluatedLine', () => {
  it('is null at zero -- the caption disappears rather than reading "0 plies"', () => {
    expect(notEvaluatedLine(0)).toBeNull();
  });

  it('is singular at exactly one', () => {
    expect(notEvaluatedLine(1)).toBe('1 ply not evaluated yet.');
  });

  it('is plural above one, matching the design\'s own example string', () => {
    expect(notEvaluatedLine(8)).toBe('8 plies not evaluated yet.');
  });
});
