import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line } from 'react-native-svg';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { useTheme } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

/** 虚线竖条 — SVG 实现，真正的 dash 效果 */
function DashedLine({ color, height }: {
  color: string;
  height: number;
}) {
  if (height <= 0) return null;
  return (
    <Svg
      width={4}
      height={height}
      style={styles.dashedLine}
    >
      <Line
        x1={2}
        y1={0}
        x2={2}
        y2={height}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="5 4"
      />
    </Svg>
  );
}

export interface UserNoteBlockProps {
  block: Block;
}

export default function UserNoteBlock({ block }: UserNoteBlockProps) {
  const theme = useTheme();
  const payload = (block.payload || {}) as Record<string, unknown>;
  const body = typeof payload.body === 'string' ? payload.body : '';
  const [containerHeight, setContainerHeight] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerHeight(e.nativeEvent.layout.height);
  }, []);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.infoLight }]}
      onLayout={onLayout}
    >
      {/* SVG 虚线 */}
      <DashedLine color={theme.primary} height={containerHeight - 12} />

      {/* 内容区 */}
      <Ionicons
        name="document-text-outline"
        size={16}
        color={theme.primary}
        style={styles.icon}
      />
      <View style={styles.content}>
        <Text style={[styles.label, { color: theme.primary }]}>Your note</Text>
        {body ? (
          <MarkdownRenderer content={body} color={theme.textPrimary} />
        ) : (
          <Text style={[styles.placeholder, { color: theme.textSecondary }]}>
            Empty note – start writing your own annotation.
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 6,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
    marginBottom: 12,
    gap: 8,
  },
  dashedLine: {
    position: 'absolute',
    left: 5,
    top: 6,
  },
  icon: {
    marginTop: 1,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  placeholder: {
    fontSize: 13,
    fontStyle: 'italic',
  },
});
