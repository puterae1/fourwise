// Tracks `window.innerWidth`, re-rendering on resize. Used only to decide
// whether the parity ruler's honest label fits (`ParityRuler.tsx`,
// `canShowParityRuler`) — kept as its own hook so that decision is a pure
// function of a plain number and can be tested without touching `window` at
// all (see `ParityRuler.test.tsx`).

import { useEffect, useState } from 'react';

const FALLBACK_WIDTH = 1024;

function readWidth(): number {
  return typeof window === 'undefined' ? FALLBACK_WIDTH : window.innerWidth;
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState(readWidth);

  useEffect(() => {
    function onResize() {
      setWidth(readWidth());
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return width;
}
