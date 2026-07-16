import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

interface Card {
  front?: string;
  back?: string;
  hint?: string;
}

export interface FlashCardsBlockProps {
  block: Block;
}

export default function FlashCardsBlock({ block }: FlashCardsBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const cards = (Array.isArray(payload.cards) ? payload.cards : []) as Card[];
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  if (cards.length === 0) return null;

  const card = cards[Math.min(idx, cards.length - 1)] || {};

  const flipCard = () => {
    const nextShowBack = !showBack;
    Animated.timing(flipAnim, {
      toValue: nextShowBack ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setShowBack(nextShowBack);
    });
    // Optimistic update for snappy feel
    setShowBack(nextShowBack);
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const goPrev = () => {
    setShowBack(false);
    flipAnim.setValue(0);
    setIdx((i) => Math.max(0, i - 1));
  };
  const goNext = () => {
    setShowBack(false);
    flipAnim.setValue(0);
    setIdx((i) => Math.min(cards.length - 1, i + 1));
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>Flash Cards</Text>
        <Text style={styles.headerCount}>
          {idx + 1} / {cards.length}
        </Text>
      </View>

      {/* Card */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={flipCard}
        style={styles.cardTouchable}
      >
        <View style={styles.card}>
          <Text style={styles.sideLabel}>
            {showBack ? 'Answer' : 'Question'}
          </Text>
          <Animated.View
            style={[
              styles.cardFace,
              {
                transform: [
                  { rotateY: showBack ? backInterpolate : frontInterpolate },
                ],
              },
            ]}
          >
            <Text style={styles.cardText}>
              {showBack ? card.back || '' : card.front || ''}
            </Text>
          </Animated.View>
          {!showBack && card.hint ? (
            <Text style={styles.hint}>Hint: {card.hint}</Text>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* Navigation */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navBtn, idx === 0 && styles.navBtnDisabled]}
          onPress={goPrev}
          disabled={idx === 0}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={idx === 0 ? colors.textMuted : colors.primary}
          />
          <Text
            style={[
              styles.navText,
              idx === 0 && styles.navTextDisabled,
            ]}
          >
            Prev
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.flipBtn} onPress={flipCard}>
          <Ionicons name="refresh" size={16} color={colors.primary} />
          <Text style={styles.flipText}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navBtn,
            idx >= cards.length - 1 && styles.navBtnDisabled,
          ]}
          onPress={goNext}
          disabled={idx >= cards.length - 1}
        >
          <Text
            style={[
              styles.navText,
              idx >= cards.length - 1 && styles.navTextDisabled,
            ]}
          >
            Next
          </Text>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={
              idx >= cards.length - 1 ? colors.textMuted : colors.primary
            }
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: colors.primary,
  },
  headerCount: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  cardTouchable: {
    marginBottom: 10,
  },
  card: {
    minHeight: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPage,
    paddingHorizontal: 16,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.textMuted,
    marginBottom: 8,
  },
  cardFace: {
    alignItems: 'center',
  },
  cardText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 24,
  },
  hint: {
    fontSize: 12,
    fontStyle: 'italic',
    color: colors.textSecondary,
    marginTop: 10,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
  navTextDisabled: {
    color: colors.textMuted,
  },
  flipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  flipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.primary,
  },
});
