import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { colors } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

export interface TextBlockProps {
  block: Block;
}

export default function TextBlock({ block }: TextBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const body =
    (typeof payload.body === 'string' && payload.body) ||
    (typeof payload.content === 'string' && payload.content) ||
    block.content ||
    '';

  if (!body.trim()) {
    return null;
  }

  return (
    <View style={styles.container}>
      {block.title ? <Text style={styles.title}>{block.title}</Text> : null}
      <MarkdownRenderer content={body} color={colors.textPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
});
