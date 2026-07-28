// @vitest-environment jsdom

// Closes a 4b-era coverage hole: `litColumn` (the board's backlight state,
// design §9) was previously only asserted at the hook level
// (`useGameController.blunder.test.tsx`'s own tests read `result.current!.
// litColumn` directly) -- nothing rendered the actual `<Board>` DOM and
// checked the lamp shows up there. This uses the same responding-fake-client
// pattern as that file (an `EngineClient` fake that resolves on demand, not
// the never-answering `FakeWorker` used by `App.test.tsx`/`firstRun.test.tsx`),
// wired through a small harness that renders `useGameController`'s live
// state straight into the real `Board` component.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useGameController } from './useGameController.js';
import { Board } from './Board.js';
import type { AnalyseProgressiveOptions, Calibration, EngineClient } from '../engine/client.js';
import type { AnalysisResult } from '../engine/types.js';
import type { Seat } from '../game/seat.js';

interface PendingCall {
  position: string;
  onUpdate: AnalyseProgressiveOptions['onUpdate'];
  resolve: (result: AnalysisResult) => void;
}

function createFakeClient(): { client: EngineClient; pending: PendingCall[] } {
  const pending: PendingCall[] = [];
  const client: EngineClient = {
    analyse: async () => {
      throw new Error('analyse() is not used by useGameController directly');
    },
    analyseProgressive: (position, options) =>
      new Promise<AnalysisResult>((resolve) => {
        pending.push({ position, onUpdate: options.onUpdate, resolve });
      }),
    calibrate: async (): Promise<Calibration> => ({
      nodesPerMs: 1_000_000,
      msToNodeBudget: (ms) => Math.max(1, Math.round(ms * 1_000_000)),
    }),
    tacticalFallback: async () => {
      throw new Error('tacticalFallback() is not used by this test');
    },
    loadBookFromNetwork: async () => {
      throw new Error('loadBookFromNetwork() is not used by this test');
    },
    setBookEnabled: async () => {
      throw new Error('setBookEnabled() is not used by this test');
    },
    terminate: () => {},
  };
  return { client, pending };
}

function fullResult(score: number, sideToMove: 'first' | 'second', best = 3): AnalysisResult {
  return {
    columns: Array.from({ length: 7 }, () => ({ kind: 'score' as const, score })),
    best,
    complete: true,
    sideToMove,
    threats: { current: [], opponent: [] },
    nodes: 1000,
  };
}

async function respondTo(pending: PendingCall[], position: string, result: AnalysisResult): Promise<void> {
  let idx = -1;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]!.position === position) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    throw new Error(`No pending analyseProgressive call for position ${JSON.stringify(position)}.`);
  }
  const [call] = pending.splice(idx, 1);
  await act(async () => {
    call!.onUpdate({ result, budget: result.nodes, elapsedMs: 0 });
    call!.resolve(result);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Renders `useGameController`'s live state straight into the real `Board`
// component -- a genuine DOM assertion on `litColumn`, not a hook-level one.
function Harness({ client, seat }: { client: EngineClient; seat: Seat }) {
  const controller = useGameController(client, seat);
  if (!controller) return null;
  return (
    <div>
      <button type="button" onClick={() => controller.setMode('analyse')}>
        go to analyse
      </button>
      <button type="button" onClick={controller.showBest}>
        show me
      </button>
      <Board
        grid={controller.board.grid}
        winLine={controller.board.winLine}
        turnColour={controller.turnColour}
        litColumn={controller.litColumn}
        lastPlayedColumn={controller.board.lastPlayedColumn}
        onDrop={controller.play}
        canDrop={controller.canDrop}
        parityUserRows={null}
      />
    </div>
  );
}

const USER_FIRST: Seat = { firstMover: 'red', userColour: 'red' };

afterEach(cleanup);

describe('lamp reveal in the DOM (design §9): automatic in Play, gated in Analyse', () => {
  it('Play mode: the lamp caret and a lit column appear once analysis resolves with a best column', async () => {
    const { client, pending } = createFakeClient();
    const { container } = render(<Harness client={client} seat={USER_FIRST} />);

    // Before any analysis has resolved, nothing is lit.
    expect(container.querySelector('.board__lamp-caret')).not.toBeInTheDocument();

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));

    await waitFor(() => expect(container.querySelector('.board__lamp-caret')).toBeInTheDocument());
    expect(container.querySelector('.board__column[data-lit="true"]')).toHaveAttribute(
      'aria-label',
      'Drop in column 4',
    );
  });

  it('Analyse mode: no lamp appears pre-reveal, even once analysis resolves with a best column', async () => {
    const { client, pending } = createFakeClient();
    const { container, getByText } = render(<Harness client={client} seat={USER_FIRST} />);

    await waitFor(() => expect(pending.some((p) => p.position === '')).toBe(true));
    await respondTo(pending, '', fullResult(9, 'first', 3));
    await waitFor(() => expect(container.querySelector('.board__lamp-caret')).toBeInTheDocument());

    act(() => getByText('go to analyse').click());
    // Switching modes clears the analyse gate (`useGameController`'s own
    // effect) -- the lamp that was on in Play must go dark immediately.
    await waitFor(() => expect(container.querySelector('.board__lamp-caret')).not.toBeInTheDocument());

    // The position is unchanged and already fully solved (same position key
    // as before), so this is a genuine "pre-reveal, analysis already
    // available" state -- not just "still thinking".
    expect(container.querySelector('.board__lamp-caret')).not.toBeInTheDocument();

    act(() => getByText('show me').click());
    await waitFor(() => expect(container.querySelector('.board__lamp-caret')).toBeInTheDocument());
  });
});
