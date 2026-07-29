// @vitest-environment jsdom

// SPEC §3.1's amended "Level-label honesty": a move made from anything less
// than the level's own defining computation must be qualified AT THE
// LEVEL'S OWN SURFACE, not just the move list's `partial` badge. The Wave
// 5a lesson (verifier audit, carried into this task's constraints): the
// qualification must be VISIBLY RENDERED text a sighted user can read, not
// merely a DOM attribute or a colour-only signal.

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayPanel } from './PlayPanel.js';
import type { LevelQualifier } from './types.js';

afterEach(cleanup);

const noop = () => {};

function baseProps() {
  return {
    userColour: 'red' as const,
    opponentColour: 'yellow' as const,
    controls: { red: 'human' as const, yellow: 'engine' as const },
    onControlChange: noop,
    levels: { red: 'strong' as const, yellow: 'strong' as const },
    onLevelChange: noop,
    onUndo: noop,
    onRedo: noop,
    canUndo: false,
    canRedo: false,
    onOpenGames: noop,
  };
}

function levelSelectContainer(): HTMLElement {
  return screen.getByText('Level').closest('.player-row')!;
}

describe('PlayPanel — level-label honesty (SPEC §3.1 amendment)', () => {
  it('renders no qualifier at all when the qualifier is null (the level\'s last move, if any, was complete)', () => {
    render(<PlayPanel {...baseProps()} levelQualifiers={{ red: null, yellow: null }} />);
    expect(screen.queryByText(/quick check/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fallback/i)).not.toBeInTheDocument();
  });

  it('renders a visible, plain-language qualifier text (not just a DOM attribute) for a "tactical" origin', () => {
    render(<PlayPanel {...baseProps()} levelQualifiers={{ red: null, yellow: 'tactical' }} />);
    const note = screen.getByText(/quick check, not full depth/i);
    expect(note).toBeVisible();
    // Genuinely rendered text content, not merely an attribute a sighted
    // user could never perceive (the Wave 5a lesson).
    expect(note.textContent).toMatch(/quick check/i);
  });

  it('renders a DISTINCT qualifier text for a "centre-fallback" origin', () => {
    render(<PlayPanel {...baseProps()} levelQualifiers={{ red: null, yellow: 'centre-fallback' }} />);
    expect(screen.getByText(/fallback, not evaluated/i)).toBeVisible();
    expect(screen.queryByText(/quick check/i)).not.toBeInTheDocument();
  });

  it('qualifies each colour independently -- a qualifier for one side never leaks onto the other', () => {
    render(
      <PlayPanel
        {...baseProps()}
        controls={{ red: 'engine', yellow: 'engine' }}
        levelQualifiers={{ red: 'tactical', yellow: 'centre-fallback' }}
      />,
    );
    expect(screen.getByText(/quick check, not full depth/i)).toBeInTheDocument();
    expect(screen.getByText(/fallback, not evaluated/i)).toBeInTheDocument();
  });

  it('shows no qualifier at all for a HUMAN-controlled side, even if levelQualifiers happens to carry one for it', () => {
    // Defensive case: a human-controlled colour never shows the "Level"
    // control in the first place (control !== 'engine'), so a stray
    // qualifier value for it must never surface.
    render(
      <PlayPanel
        {...baseProps()}
        controls={{ red: 'human', yellow: 'engine' }}
        levelQualifiers={{ red: 'tactical', yellow: null }}
      />,
    );
    expect(screen.queryByText(/quick check/i)).not.toBeInTheDocument();
  });

  it('every non-null LevelQualifier value has its own distinct visible text', () => {
    const values: Exclude<LevelQualifier, null>[] = ['tactical', 'centre-fallback'];
    const seen = new Set<string>();
    for (const value of values) {
      const { unmount } = render(
        <PlayPanel {...baseProps()} controls={{ red: 'engine', yellow: 'engine' }} levelQualifiers={{ red: value, yellow: null }} />,
      );
      const notes = screen.getAllByRole('status');
      expect(notes).toHaveLength(1);
      seen.add(notes[0]!.textContent ?? '');
      unmount();
    }
    expect(seen.size).toBe(values.length); // no two origins share the same wording
  });

  it('the level select itself still shows the unqualified level name -- the qualifier is additive, not a replacement', () => {
    render(<PlayPanel {...baseProps()} levelQualifiers={{ red: null, yellow: 'tactical' }} />);
    const container = levelSelectContainer();
    expect(container).toHaveTextContent('Level');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('strong');
  });

  it('changing the level still calls onLevelChange with the right colour and value (qualifier rendering does not interfere)', () => {
    const onLevelChange = vi.fn();
    render(<PlayPanel {...baseProps()} onLevelChange={onLevelChange} levelQualifiers={{ red: null, yellow: 'tactical' }} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    select.value = 'perfect';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onLevelChange).toHaveBeenCalledWith('yellow', 'perfect');
  });
});

describe('PlayPanel — the "Games ▸" door (Wave 12, design §15.2)', () => {
  it('renders a Games door alongside Undo/Redo and calls onOpenGames when pressed', () => {
    const onOpenGames = vi.fn();
    render(<PlayPanel {...baseProps()} levelQualifiers={{ red: null, yellow: null }} onOpenGames={onOpenGames} />);
    fireEvent.click(screen.getByRole('button', { name: 'Games ▸' }));
    expect(onOpenGames).toHaveBeenCalled();
  });
});
