import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

import { connectedGamepads, pollGamepads } from './gamepad.ts';
import { idleIntent, mergeIntents } from './intent.ts';
import { createKeyboardMouse } from './keyboard-mouse.ts';

// Must be used inside the R3F canvas; call the returned reader once per frame.
export const useInput = () => {
  const element = useThree((state) => state.gl.domElement);
  const keyboardMouse = useRef<ReturnType<typeof createKeyboardMouse>>(null);

  useEffect(() => {
    const source = createKeyboardMouse(element);
    keyboardMouse.current = source;
    return () => {
      source.dispose();
      keyboardMouse.current = null;
    };
  }, [element]);

  return (dt: number) =>
    mergeIntents(
      keyboardMouse.current?.read() ?? idleIntent,
      pollGamepads(connectedGamepads(), dt),
    );
};
