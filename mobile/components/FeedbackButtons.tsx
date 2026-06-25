import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

interface FeedbackButtonsProps {
  messageId: string;
  currentFeedback?: 'like' | 'dislike';
  onFeedback: (messageId: string, rating: 'like' | 'dislike') => void;
}

export const FeedbackButtons = React.memo(function FeedbackButtons({ messageId, currentFeedback, onFeedback }: FeedbackButtonsProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => onFeedback(messageId, 'like')}
        style={[styles.button, currentFeedback === 'like' && styles.activeLike]}
      >
        <Ionicons
          name={currentFeedback === 'like' ? 'thumbs-up' : 'thumbs-up-outline'}
          size={16}
          color={currentFeedback === 'like' ? colors.success : colors.textSecondary}
        />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onFeedback(messageId, 'dislike')}
        style={[styles.button, currentFeedback === 'dislike' && styles.activeDislike]}
      >
        <Ionicons
          name={currentFeedback === 'dislike' ? 'thumbs-down' : 'thumbs-down-outline'}
          size={16}
          color={currentFeedback === 'dislike' ? colors.error : colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginTop: 4,
    marginLeft: 4,
  },
  button: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
    backgroundColor: colors.bgInput,
  },
  activeLike: {
    backgroundColor: colors.successLight,
  },
  activeDislike: {
    backgroundColor: colors.errorLight,
  },
});
