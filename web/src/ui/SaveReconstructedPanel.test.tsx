// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SaveReconstructedPanel } from './SaveReconstructedPanel.js';

afterEach(cleanup);

const noop = () => {};

function baseProps() {
  return {
    placing: 'red' as const,
    onPlacingChange: noop,
    onUndo: noop,
    onClear: noop,
    onCancel: noop,
    onSave: noop,
    canUndo: true,
    canSave: true,
    defaultOpponent: '',
  };
}

describe('SaveReconstructedPanel (design §16.4)', () => {
  it('states the reconstructed/counts-half fact BEFORE the save', () => {
    render(<SaveReconstructedPanel {...baseProps()} />);
    expect(screen.getByText(/saved as reconstructed/i)).toBeInTheDocument();
    expect(screen.getByText(/counts half/i)).toBeInTheDocument();
  });

  it('reuses the same PLACING colour toggle as SetupPanel -- required to actually build a position', () => {
    render(<SaveReconstructedPanel {...baseProps()} />);
    expect(screen.getByRole('radiogroup', { name: 'Colour to place' })).toBeInTheDocument();
  });

  it('changing the placing colour calls onPlacingChange', () => {
    const onPlacingChange = vi.fn();
    render(<SaveReconstructedPanel {...baseProps()} onPlacingChange={onPlacingChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Colour to place' });
    fireEvent.click(within(group).getByRole('radio', { name: /yellow/i }));
    expect(onPlacingChange).toHaveBeenCalledWith('yellow');
  });

  it('Save game is disabled while canSave is false', () => {
    render(<SaveReconstructedPanel {...baseProps()} canUndo={false} canSave={false} />);
    expect(screen.getByRole('button', { name: 'Save game' })).toBeDisabled();
  });

  it('Save game calls onSave with the opponent label once enabled', () => {
    const onSave = vi.fn();
    render(<SaveReconstructedPanel {...baseProps()} onSave={onSave} defaultOpponent="Anna" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    expect(onSave).toHaveBeenCalledWith('Anna');
  });

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<SaveReconstructedPanel {...baseProps()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Undo/Clear are disabled when canUndo is false', () => {
    render(<SaveReconstructedPanel {...baseProps()} canUndo={false} canSave={false} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
