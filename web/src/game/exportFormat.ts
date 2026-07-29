// JSON export/import -- SPEC §5, amended 2026-07-28 ("Format versioning").
// The version field lives on the EXPORT ENVELOPE, never on the game record
// itself: `{ version, exported, games: [...] }`. Phase 1 always exports
// exactly one game (the current one); Phase 3 extends the game record
// inside an unchanged envelope, per the amendment's own wording ("a Phase 1
// export must still load then").
//
// Import is the first code in this project that eats untrusted input
// (delegation brief). Three distinct, honest failures, never a crash and
// never a half-import:
//   (a) malformed JSON            -- caught in `parseImportFile`, before the
//                                     shape validator ever runs.
//   (b) valid JSON, wrong shape   -- `validateImportEnvelope` says what's
//                                     actually wrong (SPEC §6's "name the
//                                     actual problem" standard, applied to
//                                     file content instead of a board).
//   (c) valid envelope, version   -- rejected explicitly and distinctly from
//       newer than supported         "wrong shape"; older-or-current loads.
//
// Wave 12 (game log, OPPONENT-MODEL.md): the plan-of-record decision was
// "envelope versioning over a new parallel store" -- the game log rides this
// SAME envelope rather than getting its own export/import surface. Version
// bumps 1 -> 2 with exactly one new, OPTIONAL, additive field: `loggedGames`.
// A v1 file (no such field at all) still loads perfectly -- `loggedGames`
// simply comes back `[]`, never invented, never dropped silently as an
// error. This is the "v1 -> v2 migration" the wave's DoD requires, and it is
// exercised by the "(older-or-current) a v1 file with NO loggedGames field
// loads with an empty log" test below plus every pre-existing v1 test in
// this file, none of which mention `loggedGames` and all of which must keep
// passing unmodified.

import type { GameState, Move } from './gameState.js';
import type { Seat } from './seat.js';
import { isSeat, isSetupPrefixShape, parseMoveArray, replayIsLegal } from './gameRecordValidation.js';
import { parseLoggedGameArray, type LoggedGame } from './loggedGame.js';

export const CURRENT_EXPORT_VERSION = 2;

/** SPEC §5: "moves, setup prefix, seat, date" -- deliberately NOT `mode` or
 * `currentPly`: those are live-session concerns the export format has never
 * been specced to carry. An imported game resumes fully played out, in Play
 * mode (`toGameState` below), matching `gameState.ts#createGame`'s own
 * default mode. */
export interface ExportedGame {
  seat: Seat;
  setupPrefix: string;
  moves: Move[];
  /** ISO timestamp. Phase 1 exports exactly one game, so this always equals
   *  the envelope's own `exported` -- kept as its own field because Phase 3's
   *  multi-game archive needs a per-game date and the envelope only has one
   *  export-time date for the whole file. */
  date: string;
}

export interface ExportEnvelope {
  version: number;
  exported: string;
  games: ExportedGame[];
  /** Wave 12, envelope v2: the WHOLE game-log archive, optional and additive
   *  (see this file's own header comment). Omitted entirely -- never an
   *  empty array -- when there is nothing to carry, so a v1-shaped object
   *  built before this field existed round-trips through `toEqual` exactly
   *  as it always has. */
  loggedGames?: LoggedGame[];
}

/** Builds the export envelope for the CURRENT game (Phase 1: `games` is
 * always length 1) plus, as of Wave 12, the whole game-log archive.
 * `exportedAt` is injectable for tests; production calls this with just the
 * state (or state + logged games). `loggedGames` defaults to `[]` and, when
 * empty, is OMITTED from the envelope entirely -- so a call site that never
 * passes it (every pre-Wave-12 caller) produces an envelope byte-identical
 * in shape to before, just carrying the bumped version number. */
export function exportGameState(
  state: GameState,
  exportedAt: string = new Date().toISOString(),
  loggedGames: LoggedGame[] = [],
): ExportEnvelope {
  const game: ExportedGame = {
    seat: state.seat,
    setupPrefix: state.setupPrefix,
    moves: state.moves.map((m) =>
      m.partial ? { column: m.column, partial: true, ...(m.origin ? { origin: m.origin } : {}) } : { column: m.column },
    ),
    date: exportedAt,
  };
  return {
    version: CURRENT_EXPORT_VERSION,
    exported: exportedAt,
    games: [game],
    ...(loggedGames.length > 0 ? { loggedGames } : {}),
  };
}

/** Rebuilds a live `GameState` from one exported game record. */
export function toGameState(game: ExportedGame): GameState {
  return { seat: game.seat, mode: 'play', setupPrefix: game.setupPrefix, moves: game.moves, currentPly: game.moves.length };
}

export type ImportFailureReason = 'malformed-json' | 'invalid-shape' | 'newer-version';

export type ImportOutcome =
  | {
      ok: true;
      version: number;
      exported: string;
      games: ExportedGame[];
      /** Wave 12: always present on success, even for a v1 file that never
       *  had this field -- `[]` in that case (the "v1 -> v2 migration": an
       *  old export loads cleanly with an empty log, nothing invented,
       *  nothing lost). */
      loggedGames: LoggedGame[];
    }
  | { ok: false; reason: ImportFailureReason; message: string };

function invalidShape(message: string): ImportOutcome {
  return { ok: false, reason: 'invalid-shape', message };
}

/** Validates one entry of `games` -- returns the parsed record, or a
 * specific message naming what's wrong with it (never "invalid position" /
 * "invalid shape" alone -- SPEC §6's standard, applied to file content). */
function validateExportedGame(value: unknown, index: number): ExportedGame | string {
  const label = `Game ${index + 1} in this file`;
  if (typeof value !== 'object' || value === null) return `${label} is not a valid record.`;
  const v = value as Record<string, unknown>;
  if (!isSeat(v.seat)) return `${label} is missing a valid seat (firstMover/userColour).`;
  if (!isSetupPrefixShape(v.setupPrefix)) return `${label} has an invalid setup prefix.`;
  const moves = parseMoveArray(v.moves);
  if (moves === null) return `${label} has an invalid move list.`;
  if (typeof v.date !== 'string') return `${label} is missing its date.`;
  if (!replayIsLegal(v.seat as Seat, v.setupPrefix as string, moves)) {
    return `${label}'s moves do not form a legal game -- it cannot be replayed without an illegal drop.`;
  }
  return { seat: v.seat as Seat, setupPrefix: v.setupPrefix as string, moves, date: v.date };
}

/**
 * Validates an already-`JSON.parse`d value against the export envelope
 * shape. Malformed JSON is the CALLER's concern (`parseImportFile` below);
 * this function only ever sees a value `JSON.parse` already accepted, so
 * everything it rejects is a SHAPE problem or a VERSION problem, never a
 * syntax one.
 */
export function validateImportEnvelope(value: unknown): ImportOutcome {
  if (typeof value !== 'object' || value === null) {
    return invalidShape('This file is not a fourwise export -- expected an object, got something else.');
  }
  const v = value as Record<string, unknown>;

  if (typeof v.version !== 'number' || !Number.isInteger(v.version) || v.version < 1) {
    return invalidShape('This file has no valid version number, so it cannot be a fourwise export.');
  }
  // Newer-than-supported is checked, and reported, BEFORE any other shape
  // check runs -- a newer version is expected to add fields this parser has
  // never heard of, so failing one of ITS checks first would misreport a
  // version problem as a shape problem.
  if (v.version > CURRENT_EXPORT_VERSION) {
    return {
      ok: false,
      reason: 'newer-version',
      message: 'This file is from a newer version of fourwise. Update fourwise to open it.',
    };
  }
  if (typeof v.exported !== 'string') {
    return invalidShape('This file is missing its export date.');
  }
  if (!Array.isArray(v.games) || v.games.length === 0) {
    return invalidShape('This file has no games in it.');
  }

  const games: ExportedGame[] = [];
  for (let i = 0; i < v.games.length; i++) {
    const result = validateExportedGame(v.games[i], i);
    if (typeof result === 'string') return invalidShape(result);
    games.push(result);
  }

  // Wave 12, envelope v2: `loggedGames` is OPTIONAL. Absent entirely (every
  // v1 file, by construction -- the field did not exist yet) maps to `[]`,
  // never an error and never a fabricated entry -- this is the "v1 -> v2
  // migration" the wave's DoD requires. Present, it must be a valid array of
  // `LoggedGame` records (`parseLoggedGameArray`'s own house-pattern
  // validation, including the legal-replay check) or the whole import is
  // rejected with a specific message, same as any other malformed field.
  let loggedGames: LoggedGame[] = [];
  if (v.loggedGames !== undefined) {
    const result = parseLoggedGameArray(v.loggedGames);
    if (typeof result === 'string') return invalidShape(`This file's game log is invalid: ${result}`);
    loggedGames = result;
  }

  return { ok: true, version: v.version, exported: v.exported, games, loggedGames };
}

/** Parses raw file text end-to-end -- the actual entry point for an
 * imported file. Malformed JSON is caught HERE, before the shape validator
 * ever sees it, so failure (a) is always reported distinctly from failure
 * (b). */
export function parseImportFile(text: string): ImportOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed-json', message: 'That file is not valid JSON.' };
  }
  return validateImportEnvelope(parsed);
}
