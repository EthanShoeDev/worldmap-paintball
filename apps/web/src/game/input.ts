import '@tanstack/react-start/client-only';
import { useThree } from '@react-three/fiber';
import { Array as Arr } from 'effect';
import { useEffect, useRef } from 'react';

import { connectedGamepads, createKeyboardMouse } from './devices.ts';
import { pollGamepads, pressedButtons } from './gamepad.ts';
import { idleIntent, mergeIntents } from './intent.ts';

// Must be used inside the R3F canvas; call the returned reader once per frame.
export const useInput = () => {
  const element = useThree((state) => state.gl.domElement);
  const keyboardMouse = useRef<ReturnType<typeof createKeyboardMouse>>(null);
  const padButtons = useRef<ReadonlyArray<ReadonlyArray<boolean>>>([]);

  useEffect(() => {
    const source = createKeyboardMouse(element);
    keyboardMouse.current = source;
    return () => {
      source.dispose();
      keyboardMouse.current = null;
    };
  }, [element]);

  return (dt: number) => {
    const pads = connectedGamepads();
    const intent = mergeIntents(
      keyboardMouse.current?.read() ?? idleIntent,
      pollGamepads(pads, dt, padButtons.current),
    );
    padButtons.current = Arr.map(pads, pressedButtons);
    return intent;
  };
};
