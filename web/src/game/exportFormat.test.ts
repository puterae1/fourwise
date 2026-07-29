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
import { buildLoggedGame, type LoggedGame } from './loggedGame.js';
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

  it('round trip preserves a move\'s origin ("tactical") intact, not just its partial flag', () => {
    const original: GameState = {
      seat: SEAT,
      mode: 'play',
      setupPrefix: '',
      moves: [{ column: 3, partial: true, origin: 'tactical' }, { column: 2 }],
      currentPly: 2,
    };
    const envelope = exportGameState(original);
    expect(envelope.games[0]!.moves).toEqual([{ column: 3, partial: true, origin: 'tactical' }, { column: 2 }]);

    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games[0]!.moves).toEqual([{ column: 3, partial: true, origin: 'tactical' }, { column: 2 }]);
  });

  it('round trip preserves a move\'s origin ("centre-fallback") intact', () => {
    const original: GameState = {
      seat: SEAT,
      mode: 'play',
      setupPrefix: '',
      moves: [{ column: 5, partial: true, origin: 'centre-fallback' }],
      currentPly: 1,
    };
    const envelope = exportGameState(original);
    expect(envelope.games[0]!.moves).toEqual([{ column: 5, partial: true, origin: 'centre-fallback' }]);

    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.games[0]!.moves).toEqual([{ column: 5, partial: true, origin: 'centre-fallback' }]);
  });
});

describe('parseImportFile -- an invalid origin string is an honest rejection, not a silently-dropped field', () => {
  it('rejects a move with an unrecognised origin value (e.g. "banana") as an invalid move list, never a crash or a silent drop', () => {
    const envelope = {
      version: CURRENT_EXPORT_VERSION,
      exported: 'x',
      games: [
        {
          seat: SEAT,
          setupPrefix: '',
          moves: [{ column: 3, partial: true, origin: 'banana' }],
          date: 'x',
        },
      ],
    };
    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/invalid move list/i);
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

// Wave 12 (OPPONENT-MODEL.md game log): the envelope bumped 1 -> 2 with one
// new, optional, additive field (`loggedGames`) -- "envelope versioning over
// a new parallel store" (plan-of-record decision). These tests are the
// TESTED v1 -> v2 migration the wave's DoD requires, plus round-trip and
// hostile-input coverage for the new field specifically.
const LOG_SEAT: Seat = { firstMover: 'red', userColour: 'yellow' };

function loggedGame(overrides: Partial<Parameters<typeof buildLoggedGame>[0]> = {}): LoggedGame {
  return buildLoggedGame({
    seat: LOG_SEAT,
    moves: [3, 2, 4],
    winner: 'yellow',
    opponent: 'Anna',
    source: 'live',
    id: 'log-1',
    date: '2026-07-29T00:00:00.000Z',
    ...overrides,
  });
}

describe('exportGameState / import -- v1 -> v2 migration for the game log (Wave 12)', () => {
  it('CURRENT_EXPORT_VERSION is 2, now that the log rides this envelope', () => {
    expect(CURRENT_EXPORT_VERSION).toBe(2);
  });

  it('a literal v1 file (no loggedGames field at all) imports cleanly with an EMPTY log -- nothing invented, nothing lost', () => {
    const v1File = {
      version: 1,
      exported: '2026-07-28T00:00:00.000Z',
      games: [{ seat: SEAT, setupPrefix: '', moves: [{ column: 3 }], date: '2026-07-28T00:00:00.000Z' }],
    };
    const outcome = parseImportFile(JSON.stringify(v1File));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loggedGames).toEqual([]);
    // The current-game import is completely unaffected by the migration.
    expect(outcome.games[0]!.moves).toEqual([{ column: 3 }]);
  });

  it('exportGameState with no loggedGames argument omits the field entirely (byte-identical shape to before Wave 12, just the bumped version)', () => {
    const envelope = exportGameState(playedGame(), '2026-07-28T00:00:00.000Z');
    expect(envelope).toEqual({
      version: CURRENT_EXPORT_VERSION,
      exported: '2026-07-28T00:00:00.000Z',
      games: [{ seat: SEAT, setupPrefix: '', moves: [{ column: 4 }, { column: 4 }, { column: 5 }], date: '2026-07-28T00:00:00.000Z' }],
    });
    expect('loggedGames' in envelope).toBe(false);
  });

  it('exportGameState with a non-empty log includes loggedGames, and it round-trips through JSON.stringify -> parseImportFile exactly', () => {
    const games = [loggedGame({ id: 'a' }), loggedGame({ id: 'b', source: 'reconstructed', winner: 'red' })];
    const envelope = exportGameState(playedGame(), '2026-07-28T00:00:00.000Z', games);
    expect(envelope.loggedGames).toEqual(games);

    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loggedGames).toEqual(games);
  });

  it('round trip preserves every LoggedGame field, including a draw (winner: null -> result: "draw") and source: "reconstructed"', () => {
    const drawn = buildLoggedGame({
      seat: LOG_SEAT,
      moves: [0, 1, 2, 3, 4, 5, 6],
      winner: null,
      opponent: '',
      source: 'reconstructed',
      id: 'drawn-1',
      date: '2026-07-29T00:00:00.000Z',
    });
    const envelope = exportGameState(playedGame(), '2026-07-28T00:00:00.000Z', [drawn]);
    const outcome = parseImportFile(JSON.stringify(envelope));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.loggedGames).toEqual([drawn]);
    expect(outcome.loggedGames[0]!.result).toBe('draw');
    expect(outcome.loggedGames[0]!.opponent).toBe('');
  });
});

describe('parseImportFile -- honest rejections for a hostile loggedGames field (Wave 12)', () => {
  it('rejects loggedGames that is not an array at all', () => {
    const file = { version: 2, exported: 'x', games: [{ seat: SEAT, setupPrefix: '', moves: [], date: 'x' }], loggedGames: 'not an array' };
    const outcome = parseImportFile(JSON.stringify(file));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/game log is invalid/i);
  });

  it('rejects a loggedGames entry with an invalid result value', () => {
    const bad = { ...loggedGame(), result: 'tie' };
    const file = { version: 2, exported: 'x', games: [{ seat: SEAT, setupPrefix: '', moves: [], date: 'x' }], loggedGames: [bad] };
    const outcome = parseImportFile(JSON.stringify(file));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/invalid result/i);
  });

  it('rejects a loggedGames entry whose moves cannot be legally replayed (an overfull column)', () => {
    const illegal = { ...loggedGame(), moves: Array.from({ length: 7 }, () => 3) };
    const file = { version: 2, exported: 'x', games: [{ seat: SEAT, setupPrefix: '', moves: [], date: 'x' }], loggedGames: [illegal] };
    const outcome = parseImportFile(JSON.stringify(file));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('invalid-shape');
    expect(outcome.message).toMatch(/legal game/i);
  });
});
