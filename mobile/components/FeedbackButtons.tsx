import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface FeedbackButtonsProps {
  messageId: string;
  currentFeedback?: 'like' | 'dislike';
  onFeedback: (messageId: string, rating: 'like' | 'dislike') => void;
}

export function FeedbackButtons({ messageId, currentFeedback, onFeedback }: FeedbackButtonsProps) {
  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => onFeedback(messageId, 'like')}
        style={[styles.button, currentFeedback === 'like' && styles.activeLike]}
      >
        <Text style={styles.icon}>👍</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => onFeedback(messageId, 'dislike')}
        style={[styles.button, currentFeedback === 'dislike' && styles.activeDislike]}
      >
        <Text style={styles.icon}>👎</Text>
      </TouchableOpacity>
    </View>
  );
}

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
    backgroundColor: '#F0F0F0',
  },
  activeLike: {
    backgroundColor: '#E8F5E9',
  },
  activeDislike: {
    backgroundColor: '#FFE5E5',
  },
  icon: {
    fontSize: 14,
  },
});
