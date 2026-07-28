// Mounts exactly one `EngineClient` for the lifetime of the app. Mirrors
// the Wave 3 smoke page's StrictMode-safe pattern (`App.tsx`'s old
// comment): the client is created in an effect, not at render time, so a
// dev-mode double-invoke can never race a client that's about to be torn
// down.
//
// This hook itself never calibrates. Calibration is warmed at prompt mount
// instead (`SeatPrompt.tsx`'s own effect, fired as soon as a client exists,
// well before Start is pressed) -- by the time a real game exists to
// analyse, the client handed back here is already calibrated (or, on a
// stored-seat load that skips the prompt, the first real analysis
// calibrates on demand via `EngineClient#calibrate`'s own per-client
// memoisation, which costs nothing extra to call again).

import { useEffect, useRef, useState } from 'react';
import { createEngineClient, type EngineClient } from '../engine/client.js';

export function useEngineClient(): EngineClient | null {
  const [client, setClient] = useState<EngineClient | null>(null);
  const clientRef = useRef<EngineClient | null>(null);

  useEffect(() => {
    const created = createEngineClient();
    clientRef.current = created;
    setClient(created);
    return () => {
      created.terminate();
      if (clientRef.current === created) clientRef.current = null;
    };
  }, []);

  return client;
}
