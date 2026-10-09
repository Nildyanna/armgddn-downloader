import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

// A button that works with a TV remote, a controller or a keyboard: it can take focus, and shows a bright ring while it has it.
// Same props as TouchableOpacity (style, onPress, disabled, children), plus testID and hasTVPreferredFocus.
export function FocusButton({ style, onPress, disabled, children, testID, hasTVPreferredFocus, accessibilityLabel }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [style, disabled && styles.disabled, pressed && styles.pressed, focused && styles.focused]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  focused: {
    borderColor: '#38bdf8',
    borderWidth: 3,
    transform: [{ scale: 1.03 }],
  },
});
