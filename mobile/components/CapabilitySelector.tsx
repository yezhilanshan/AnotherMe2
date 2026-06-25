import React, { useEffect, useRef } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CHAT_CAPABILITIES } from '../lib/config';
import { colors } from '../lib/theme';

interface CapabilityBarProps {
  selectedCapability: string;
  onSelect: (capabilityId: string) => void;
  /** 是否可见（输入框聚焦时隐藏） */
  visible?: boolean;
}

/**
 * 横向滑动功能选择栏 — 固定在输入框上方
 * pill 固定尺寸，visible 控制显隐，带动画
 */
export const CapabilityBar = React.memo(function CapabilityBar({ selectedCapability, onSelect, visible = true }: CapabilityBarProps) {
  const anim = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [visible]);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          opacity: anim,
          transform: [{
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            }),
          }],
          // 隐藏时不可点击
          height: visible ? undefined : 0,
          overflow: 'hidden',
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {CHAT_CAPABILITIES.map(cap => {
          const isSelected = cap.id === selectedCapability;
          return (
            <TouchableOpacity
              key={cap.id || 'chat'}
              style={[styles.pill, isSelected && styles.pillSelected]}
              onPress={() => onSelect(cap.id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={cap.icon as any}
                size={14}
                color={isSelected ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.pillText, isSelected && styles.pillTextSelected]} numberOfLines={1}>
                {cap.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bgCard,
  },
  container: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.bgInput,
    height: 32,
  },
  pillSelected: {
    backgroundColor: colors.primary,
  },
  pillText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  pillTextSelected: {
    color: colors.textInverse,
    fontWeight: '600',
  },
});
