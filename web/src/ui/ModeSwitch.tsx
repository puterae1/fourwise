// Mode switch — docs/DESIGN-DIRECTION.md §10 ("Mode switch"). Full-width
// pill, three equal segments, pinned to the bottom of the page in thumb
// reach. Deliberately a different shape from every other segmented control
// so it is never mistaken for a seat control.

import type { Mode } from '../game/gameState.js';
import './ModeSwitch.css';

const MODES: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'play', label: 'Play' },
  { value: 'analyse', label: 'Analyse' },
  { value: 'setup', label: 'Setup' },
];

export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="mode-switch" role="tablist" aria-label="Mode">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="tab"
          aria-selected={mode === m.value}
          className="mode-switch__segment"
          data-active={mode === m.value}
          onClick={() => onChange(m.value)}
        >
          {m.label.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
