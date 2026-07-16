import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const PURPLE = '#6B5CE7';
const PURPLE_LIGHT = '#EDE9FF';
const GLASS_BG = 'rgba(255, 252, 249, 0.88)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.6)';
const CARD_SHADOW = {
  shadowColor: '#5A3E36',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 4,
};

interface ClassroomCardProps {
  title: string;
  scenesCount: number;
  createdAt: string;
  index: number;
  onPress: () => void;
  onLongPress: () => void;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function ClassroomCard({
  title,
  scenesCount,
  createdAt,
  index,
  onPress,
  onLongPress,
}: ClassroomCardProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay: index * 60,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay: index * 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      <TouchableOpacity
        style={styles.card}
        onPress={onPress}
        onLongPress={onLongPress}
        activeOpacity={0.65}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="play-circle" size={28} color={PURPLE} />
        </View>
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="layers-outline" size={13} color={colors.textMuted} />
              <Text style={styles.metaText}>{scenesCount} 场景</Text>
            </View>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.metaText}>{formatDate(createdAt)}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.borderLight} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: GLASS_BG,
    borderRadius: 18,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...CARD_SHADOW,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: PURPLE_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  dot: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
