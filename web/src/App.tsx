import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createEngineClient, type Calibration, type EngineClient, type ProgressiveUpdate } from './engine/client.js';
import { EngineError } from './engine/wrapper.js';
import type { AnalysisResult, ColumnEval } from './engine/types.js';
import './App.css';

// ---------------------------------------------------------------------------
// WAVE 3 SMOKE PAGE.
//
// This is not the product. It exists to prove, end to end, that
// wrapper.ts / worker.ts / client.ts are wired correctly against the real
// wasm engine: a position string in, an honest AnalysisResult out, with a
// visible "still thinking" state while the progressive budget escalates.
//
// It is replaced in Wave 4 by the designed UI (docs/DESIGN-DIRECTION.md).
// Do not extend this file with board rendering, seat controls, or modes —
// that work belongs to Wave 4, not here.
// ---------------------------------------------------------------------------

// A time budget the smoke page is willing to wait per analyse click, once
// calibration has converted it into a node budget. 1.5s is a reasonable
// "still responsive" ceiling for a manual smoke test.
const DEFAULT_WAIT_MS = 1500;
const FALLBACK_BUDGET_CEILING = 5_000_000; // used only if calibration hasn't resolved yet

function columnKindLabel(column: ColumnEval): string {
  switch (column.kind) {
    case 'score':
      return `score ${column.score}`;
    case 'full':
      return 'column full';
    case 'unknown':
      return 'not yet solved';
  }
}

function App() {
  const clientRef = useRef<EngineClient | null>(null);
  const [position, setPosition] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [lastUpdate, setLastUpdate] = useState<ProgressiveUpdate | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately does NOT trigger calibration here. React StrictMode
    // double-invokes effects in dev (mount, cleanup, mount again); a client
    // created on the first pass can be mid-calibration when its cleanup
    // terminates it, and that termination is a real, correct rejection —
    // not a bug to work around. Rather than special-case StrictMode, we
    // simply never calibrate a client before we know it is the one in use:
    // calibration is lazy, first triggered from `handleSubmit` below, by
    // which point exactly one client is ever live.
    const client = createEngineClient();
    clientRef.current = client;

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, []);

  const stillThinking = isAnalysing && (result === null || !result.complete);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = clientRef.current;
    if (!client) {
      setError('The analysis worker has not started yet.');
      return;
    }

    setError(null);
    setResult(null);
    setLastUpdate(null);
    setCalibrationError(null);
    setIsAnalysing(true);

    let activeCalibration = calibration;
    if (!activeCalibration) {
      try {
        activeCalibration = await client.calibrate();
        setCalibration(activeCalibration);
      } catch (err) {
        setCalibrationError(err instanceof Error ? err.message : String(err));
      }
    }

    const budgetCeiling = activeCalibration
      ? activeCalibration.msToNodeBudget(DEFAULT_WAIT_MS)
      : FALLBACK_BUDGET_CEILING;

    try {
      await client.analyseProgressive(position, {
        budgetCeiling: Math.max(budgetCeiling, 50_000),
        onUpdate: (update) => {
          setResult(update.result);
          setLastUpdate(update);
        },
      });
    } catch (err) {
      setError(err instanceof EngineError ? err.message : err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalysing(false);
    }
  }

  return (
    <main className="smoke-page">
      <header>
        <h1>fourwise — engine smoke test</h1>
        <p className="smoke-page__note">
          Wave 3 scaffold, not the product. Replaced in Wave 4 by the designed UI
          (see <code>docs/DESIGN-DIRECTION.md</code>).
        </p>
        {calibrationError && (
          <p className="smoke-page__note">
            Calibration did not complete ({calibrationError}); using a fixed fallback budget.
          </p>
        )}
      </header>

      <form className="smoke-page__form" onSubmit={handleSubmit}>
        <div className="smoke-page__field">
          <label htmlFor="position">Position (column digits 1-7, e.g. 4453)</label>
          <input
            id="position"
            name="position"
            type="text"
            inputMode="numeric"
            pattern="[1-7]*"
            value={position}
            onChange={(event) => setPosition(event.target.value)}
            placeholder="leave empty for the opening position"
          />
        </div>
        <button className="smoke-page__button" type="submit" disabled={isAnalysing}>
          {isAnalysing ? 'Analysing…' : 'Analyse'}
        </button>
      </form>

      {error && (
        <p className="smoke-page__error" role="alert">
          {error}
        </p>
      )}

      {stillThinking && (
        <p className="smoke-page__status" aria-live="polite">
          <span className="smoke-page__status-dot" aria-hidden="true" />
          Still thinking{lastUpdate ? ` — spent ${lastUpdate.result.nodes.toLocaleString()} nodes so far (budget ${lastUpdate.budget.toLocaleString()})` : '…'}
        </p>
      )}

      {result && <AnalysisView result={result} />}
    </main>
  );
}

function AnalysisView({ result }: { result: AnalysisResult }) {
  return (
    <section className="smoke-page__result" aria-label="Analysis result">
      <dl className="smoke-page__summary">
        <dt>Side to move</dt>
        <dd>{result.sideToMove}</dd>

        <dt>Best column</dt>
        <dd>{result.best === null ? 'not yet determined' : `column ${result.best + 1}`}</dd>

        <dt>Complete</dt>
        <dd>{result.complete ? 'yes — every column solved' : 'no — still thinking on some columns'}</dd>

        <dt>Nodes spent this call</dt>
        <dd>{result.nodes.toLocaleString()}</dd>
      </dl>

      <ul className="smoke-page__columns">
        {result.columns.map((column, index) => (
          <li
            key={index}
            className={
              'smoke-page__column' + (result.best === index ? ' smoke-page__column--best' : '')
            }
          >
            <span className="smoke-page__column-label">column {index + 1}</span>
            <span className={`smoke-page__column-kind smoke-page__column-kind--${column.kind}`}>
              {columnKindLabel(column)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="smoke-page__threats">
        <dt>Threat squares (current mover)</dt>
        <dd>{result.threats.current.length > 0 ? result.threats.current.join(', ') : 'none'}</dd>
        <dt>Threat squares (opponent)</dt>
        <dd>{result.threats.opponent.length > 0 ? result.threats.opponent.join(', ') : 'none'}</dd>
      </dl>
    </section>
  );
}

export default App;
