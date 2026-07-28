import { describe, expect, it } from 'vitest';
import { createGame, playMove, type GameState } from './gameState.js';
import {
  CURRENT_EXPORT_VERSION,
  exportGameState,
  parseImportFile,
  toGameState,
  validateImportEnvelope,
  type ExportEnvelope,
} from './exportFormat.js';
import type { Seat } from './seat.js';

const SEAT: Seat = { firstMover: 'yellow', userColour: 'red' };

function play(state: GameState, column: number): GameState {
  const result = playMove(state, column);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function playedGame(): GameState {
  let state = createGame(SEAT, 'play');
  state = play(state, 4);
  state = play(state, 4);
  state = play(state, 5);
  return state;
}

describe('exportGameState / import round trip (SPEC §5 amendment)', () => {
  it('produces an envelope with version, exported, and one game', () => {
    const envelope = exportGameState(playedGame(), '2026-07-28T00:00:00.000Z');
    expect(envelope).toEqual({
      version: CURRENT_EXPORT_VERSION,
      exported: '2026-07-28T00:00:00.000Z',
      games: [
        {
          seat: SEAT,
          setupPrefix: '',
          moves: [{ column: 4 }, { column: 4 }, { column: 5 }],
          date: '2026-07-28T00:00:00.000Z',
        },
      ],
    });
  });

  it('round trip: export -> JSON.stringify -> parseImportFile -> toGameState reproduces the identical seat/setupPrefix/moves', () => {
    const original = playedGame();
    const envelope = exportGameState(original);
    const text = JSON.stringify(envelope);

    const outcome = parseImportFile(text);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const restored = toGameState(outcome.games[0]!);
    expect(restored.seat).toEqual(original.seat);
    expect(restored.setupPrefix).toEqual(original.setupPrefix);
    expect(restored.moves).toEqual(original.moves);
    // Not part of the export schema (SPEC §5 lists moves/setupPrefix/seat/date
    // only) -- an imported game resumes fully played out, in Play mode.
    expect(restored.mode).toBe('play');
    expect(restored.currentPly).toBe(original.moves.length);
  });

  it('round trip preserves a non-empty setup prefix and a partial-flagged move', () => {
    const original: GameState = {
      seat: SEAT,
      mode: 'play',
      setupPrefix: '44',
      moves: [{ column: 1, partial: true }, { column: 2 }],
      currentPly: 2,
    };
    const envelope = exportGameState(original);
    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games[0]!.setupPrefix).toBe('44');
    expect(outcome.games[0]!.moves).toEqual([{ column: 1, partial: true }, { column: 2 }]);
  });
});

describe('parseImportFile -- three distinct, honest failure modes (SPEC §5 amendment)', () => {
  it('(a) malformed JSON', () => {
    const outcome = parseImportFile('{ this is not json');
    expect(outcome).toEqual({ ok: false, reason: 'malformed-json', message: 'That file is not valid JSON.' });
  });

  it('(a) malformed JSON: empty string', () => {
    const outcome = parseImportFile('');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed-json');
  });

  it('(b) valid JSON, wrong shape: not an object at all', () => {
    const outcome = parseImportFile(JSON.stringify('just a string'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/not a fourwise export/);
  });

  it('(b) valid JSON, wrong shape: missing version', () => {
    const outcome = parseImportFile(JSON.stringify({ exported: 'x', games: [] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/version/i);
  });

  it('(b) valid JSON, wrong shape: no games at all', () => {
    const outcome = parseImportFile(JSON.stringify({ version: 1, exported: 'x', games: [] }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/no games/i);
  });

  it('(b) valid JSON, wrong shape: a game missing its seat', () => {
    const outcome = parseImportFile(
      JSON.stringify({ version: 1, exported: 'x', games: [{ setupPrefix: '', moves: [], date: 'x' }] }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/seat/i);
  });

  it('(b) valid JSON, wrong shape: a game whose moves cannot be legally replayed', () => {
    const illegalMoves = Array.from({ length: 7 }, () => ({ column: 3 }));
    const outcome = parseImportFile(
      JSON.stringify({
        version: 1,
        exported: 'x',
        games: [{ seat: SEAT, setupPrefix: '', moves: illegalMoves, date: 'x' }],
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/legal game/i);
  });

  it('(c) valid envelope, NEWER version than supported -- rejected distinctly from a shape problem', () => {
    const envelope = { version: CURRENT_EXPORT_VERSION + 1, exported: 'x', games: [{ seat: SEAT, setupPrefix: '', moves: [], date: 'x' }] };
    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('newer-version');
    expect(outcome.message).toMatch(/newer version/i);
  });

  it('an older-or-current version loads normally', () => {
    const envelope: ExportEnvelope = exportGameState(playedGame());
    expect(envelope.version).toBeLessThanOrEqual(CURRENT_EXPORT_VERSION);
    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
  });
});

describe('validateImportEnvelope -- never crashes on adversarial shapes', () => {
  it('null, arrays, numbers, booleans all resolve to a clean invalid-shape failure', () => {
    for (const input of [null, [], 42, true, undefined]) {
      const outcome = validateImportEnvelope(input);
      expect(outcome.ok).toBe(false);
    }
  });

  it('a games array containing a non-object entry fails with a specific message, not a crash', () => {
    const outcome = validateImportEnvelope({ version: 1, exported: 'x', games: [42] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/Game 1/);
  });
});
