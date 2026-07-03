import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { colors } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

interface Subsection {
  heading?: string;
  role?: string;
  focus?: string;
  body?: string;
  target_words?: number;
}

export interface SectionBlockProps {
  block: Block;
}

export default function SectionBlock({ block }: SectionBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const intro = typeof payload.intro === 'string' ? payload.intro.trim() : '';
  const keyTakeaway =
    typeof payload.key_takeaway === 'string' ? payload.key_takeaway.trim() : '';
  const focus = typeof payload.focus === 'string' ? payload.focus.trim() : '';
  const rawSubs = Array.isArray(payload.subsections) ? payload.subsections : [];
  const subsections = rawSubs as Subsection[];

  return (
    <View style={styles.container}>
      {intro ? (
        <View style={styles.intro}>
          <MarkdownRenderer content={intro} color={colors.textPrimary} />
        </View>
      ) : null}

      {focus ? (
        <Text style={styles.focus}>Section focus · {focus}</Text>
      ) : null}

      {subsections.map((sub, idx) => {
        const body = (sub.body || '').trim();
        if (!body) return null;
        return (
          <View key={idx} style={styles.subsection}>
            {sub.heading ? (
              <Text style={styles.subsectionHeading}>{sub.heading}</Text>
            ) : null}
            <MarkdownRenderer content={body} color={colors.textPrimary} />
          </View>
        );
      })}

      {keyTakeaway ? (
        <View style={styles.takeaway}>
          <Ionicons
            name="sparkles"
            size={16}
            color={colors.textSecondary}
            style={styles.takeawayIcon}
          />
          <View style={styles.takeawayContent}>
            <Text style={styles.takeawayLabel}>Key takeaway: </Text>
            <Text style={styles.takeawayText}>{keyTakeaway}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  intro: {
    marginBottom: 16,
  },
  focus: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  subsection: {
    marginBottom: 16,
  },
  subsectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  takeaway: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    gap: 8,
  },
  takeawayIcon: {
    marginTop: 2,
  },
  takeawayContent: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  takeawayLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  takeawayText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 21,
  },
});
