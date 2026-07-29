// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SaveLiveGameControl } from './SaveLiveGameControl.js';

afterEach(cleanup);

describe('SaveLiveGameControl (DoD item 3, "record from live play")', () => {
  it('defaults the opponent field from the most recently logged label', () => {
    render(<SaveLiveGameControl defaultOpponent="Anna" onSave={() => {}} />);
    expect(screen.getByDisplayValue('Anna')).toBeInTheDocument();
  });

  it('an empty log defaults to an empty field', () => {
    render(<SaveLiveGameControl defaultOpponent="" onSave={() => {}} />);
    const input = screen.getByPlaceholderText('Unlabelled') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('Save calls onSave with the (possibly edited) opponent label', () => {
    const onSave = vi.fn();
    render(<SaveLiveGameControl defaultOpponent="Anna" onSave={onSave} />);
    const input = screen.getByDisplayValue('Anna');
    fireEvent.change(input, { target: { value: 'Beth' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this game' }));
    expect(onSave).toHaveBeenCalledWith('Beth');
  });

  it('after saving, shows a confirmation instead of the form', () => {
    render(<SaveLiveGameControl defaultOpponent="Anna" onSave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save this game' }));
    expect(screen.getByText('Saved to your games.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save this game' })).not.toBeInTheDocument();
  });
});
