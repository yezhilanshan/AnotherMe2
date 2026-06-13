import React, { useState, useCallback } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  onFocusChange?: (focused: boolean) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  onFocusChange,
}: ChatInputProps) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setText('');
    }
  }, [text, disabled, onSend]);

  const handleFocus = useCallback(() => onFocusChange?.(true), [onFocusChange]);
  const handleBlur = useCallback(() => onFocusChange?.(false), [onFocusChange]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      <View style={styles.container}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="输入消息..."
          placeholderTextColor="#999"
          multiline
          maxLength={2000}
          editable={!disabled}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          onFocus={handleFocus}
          onBlur={handleBlur}
        />

        {isStreaming ? (
          <TouchableOpacity style={[styles.button, styles.stopButton]} onPress={onStop}>
            <Ionicons name="stop" size={16} color="#fff" />
            <Text style={styles.stopButtonText}>停止</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.button, (!text.trim() || disabled) && styles.buttonDisabled]}
            onPress={handleSend}
            disabled={!text.trim() || disabled}
          >
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: '#F5F5F5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#333',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#007AFF',
  },
  buttonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  stopButton: {
    backgroundColor: '#FF3B30',
  },
  stopButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
