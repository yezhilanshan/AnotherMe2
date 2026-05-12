'use client';

import { createContext, useContext, useEffect, useState, useMemo } from 'react';

interface KeyboardContextValue {
  ctrlKeyState: boolean;
  shiftKeyState: boolean;
  spaceKeyState: boolean;
  ctrlOrShiftKeyActive: boolean;
}

const KeyboardContext = createContext<KeyboardContextValue>({
  ctrlKeyState: false,
  shiftKeyState: false,
  spaceKeyState: false,
  ctrlOrShiftKeyActive: false,
});

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const [ctrlKeyState, setCtrlKeyState] = useState(false);
  const [shiftKeyState, setShiftKeyState] = useState(false);
  const [spaceKeyState, setSpaceKeyState] = useState(false);

  const ctrlOrShiftKeyActive = ctrlKeyState || shiftKeyState;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlKeyState(true);
      if (e.key === 'Shift') setShiftKeyState(true);
      if (e.key === ' ' && !e.repeat) setSpaceKeyState(true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlKeyState(false);
      if (e.key === 'Shift') setShiftKeyState(false);
      if (e.key === ' ') setSpaceKeyState(false);
    };

    const onBlur = () => {
      setCtrlKeyState(false);
      setShiftKeyState(false);
      setSpaceKeyState(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const value = useMemo(
    () => ({ ctrlKeyState, shiftKeyState, spaceKeyState, ctrlOrShiftKeyActive }),
    [ctrlKeyState, shiftKeyState, spaceKeyState, ctrlOrShiftKeyActive],
  );

  return <KeyboardContext.Provider value={value}>{children}</KeyboardContext.Provider>;
}

export function useKeyboard(): KeyboardContextValue {
  return useContext(KeyboardContext);
}
