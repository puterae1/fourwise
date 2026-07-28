// A generic two-or-more-way segmented control, backed by native radio
// inputs so keyboard navigation (arrow keys within the group, Tab in/out)
// and screen-reader semantics come for free. Used for the two independent
// seat controls, per-side human/engine controls, and Setup's placing
// colour toggle — never for the mode switch, which is visually a different
// shape (design §10: "deliberately a different shape... so it can never be
// mistaken for which colour I am").

import type { ReactNode } from 'react';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  name: string;
  legend: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ name, legend, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={legend}>
      {options.map((opt) => (
        <label key={opt.value} className="segmented__option" data-checked={opt.value === value}>
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={opt.value === value}
            onChange={() => onChange(opt.value)}
            className="segmented__input"
          />
          <span className="segmented__label">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
