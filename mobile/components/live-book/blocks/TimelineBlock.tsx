import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

interface TimelineEvent {
  date?: string;
  title?: string;
  description?: string;
}

export interface TimelineBlockProps {
  block: Block;
}

export default function TimelineBlock({ block }: TimelineBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const events = (Array.isArray(payload.events) ? payload.events : []) as TimelineEvent[];

  if (events.length === 0) return null;

  return (
    <View style={styles.container}>
      {events.map((ev, idx) => {
        const isLast = idx === events.length - 1;
        return (
          <View key={idx} style={styles.eventRow}>
            {/* Left rail: dot + line */}
            <View style={styles.rail}>
              <View style={styles.dot} />
              {!isLast && <View style={styles.line} />}
            </View>

            {/* Content */}
            <View style={styles.eventContent}>
              {ev.date ? <Text style={styles.date}>{ev.date}</Text> : null}
              {ev.title ? <Text style={styles.title}>{ev.title}</Text> : null}
              {ev.description ? (
                <Text style={styles.description}>{ev.description}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  eventRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rail: {
    alignItems: 'center',
    width: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  line: {
    flex: 1,
    width: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 16,
  },
  date: {
    fontSize: 11,
    fontFamily: 'monospace',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
