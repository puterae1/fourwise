// Fixed perf-smoke suite (Wave 6a, ROADMAP.md gate #3's desk proxy). Every
// position below is copied VERBATIM (moves + expected score both, though only
// `moves` is used here -- the score is carried along purely so this file
// stays traceable to its source line without a second lookup) from the
// engine's own reference fixtures:
//
//   engine/tests/fixtures/test_l2_r1.txt
//   engine/tests/fixtures/test_l2_r2.txt
//
// Format there is `<moves> <expected score>`, one per line (`docs/ENGINE.md`,
// `engine/tests/reference.rs`). `moves` is a bare digit string in the
// standard 1-7 column notation -- exactly what `EngineClient#analyse`/
// `#analyseProgressive` take as a position string (`game/gameState.ts`'s
// `enginePosition`), so these can be fed to the real client with no
// translation at all.
//
// Selection: ROADMAP.md's gate #3 talks about ply >= 12; the task asked for
// plies 12-25 specifically. Neither fixture file contains anything shorter
// than ply 15 (checked directly: `awk '{print length($1)}' | sort -n | uniq
// -c` over both files bottoms out at 15) -- there is no ply-12/13/14 line to
// draw from without inventing one, which CLAUDE.md's "no placeholder data"
// rules out. This suite therefore spans the sub-range that actually exists
// in these files, 15-25, alternating between the two fixtures at every other
// ply so both are represented across the whole span: 11 positions total,
// comfortably over the "at least 10" floor.
export interface PerfPosition {
  /** The bare move-sequence string -- exactly what the engine client takes
   * as a position (`ui/useGameController.ts`'s `enginePosition`). */
  moves: string;
  /** Ply count = `moves.length`, restated here so the harness/table never
   * has to recompute it. */
  ply: number;
  /** Which fixture file this line came from. */
  source: 'test_l2_r1.txt' | 'test_l2_r2.txt';
  /** 1-indexed line number within `source`, for tracing back to the exact
   * fixture entry (`grep -n` against the file reproduces this). */
  line: number;
}

export const PERF_POSITIONS: readonly PerfPosition[] = [
  { moves: '544111732146347', ply: 15, source: 'test_l2_r1.txt', line: 42 },
  { moves: '5455174361263362', ply: 16, source: 'test_l2_r2.txt', line: 2 },
  { moves: '47611556754127222', ply: 17, source: 'test_l2_r1.txt', line: 37 },
  { moves: '165713352355467777', ply: 18, source: 'test_l2_r2.txt', line: 9 },
  { moves: '3455565261655364217', ply: 19, source: 'test_l2_r1.txt', line: 8 },
  { moves: '71324677554451437653', ply: 20, source: 'test_l2_r2.txt', line: 21 },
  { moves: '122435527534575161761', ply: 21, source: 'test_l2_r1.txt', line: 19 },
  { moves: '7225753363613131156611', ply: 22, source: 'test_l2_r2.txt', line: 11 },
  { moves: '52753311433677442422121', ply: 23, source: 'test_l2_r1.txt', line: 2 },
  { moves: '246767232112661771721576', ply: 24, source: 'test_l2_r2.txt', line: 12 },
  { moves: '5554224333234511764415115', ply: 25, source: 'test_l2_r1.txt', line: 1 },
];
