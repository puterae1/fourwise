// Mounts exactly one `EngineClient` for the lifetime of the app. Mirrors
// the Wave 3 smoke page's StrictMode-safe pattern (`App.tsx`'s old
// comment): the client is created in an effect, not at render time, and
// calibration is triggered lazily on first real use rather than at mount,
// so a dev-mode double-invoke can never race a calibration probe against a
// client that's about to be torn down.

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
