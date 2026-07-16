// 键盘隐藏时自动失焦 TextInput
// 来源：ChatterUI lib/hooks/UnfocusTextInput.tsx

import { useEffect, useRef } from "react";
import { Keyboard, TextInput } from "react-native";

export function useUnfocusTextInput() {
  const ref = useRef<TextInput>(null);

  useEffect(() => {
    const subscription = Keyboard.addListener("keyboardDidHide", () => {
      if (ref.current?.isFocused()) {
        ref.current.blur();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [ref]);

  return ref;
}
