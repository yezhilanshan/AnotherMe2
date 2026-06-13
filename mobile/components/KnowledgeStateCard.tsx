import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { KnowledgeState } from '../lib/types';

interface KnowledgeStateCardProps {
  state: KnowledgeState;
  teachingSuggestion?: string;
}

function getMasteryColor(mastery: number): string {
  if (mastery < 0.35) return '#FF3B30';
  if (mastery < 0.65) return '#FF9500';
  return '#4CAF50';
}

function getMasteryLabel(mastery: number): string {
  if (mastery < 0.35) return '薄弱';
  if (mastery < 0.65) return '一般';
  if (mastery < 0.85) return '良好';
  return '优秀';
}

export function KnowledgeStateCard({ state, teachingSuggestion }: KnowledgeStateCardProps) {
  const color = getMasteryColor(state.mastery);
  const label = getMasteryLabel(state.mastery);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>{state.name}</Text>
        <View style={[styles.badge, { backgroundColor: color + '20' }]}>
          <Text style={[styles.badgeText, { color }]}>{label}</Text>
        </View>
      </View>

      {state.subject && (
        <Text style={styles.subject}>{state.subject}</Text>
      )}

      <View style={styles.progressRow}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${state.mastery * 100}%`, backgroundColor: color }]} />
        </View>
        <Text style={[styles.progressText, { color }]}>{Math.round(state.mastery * 100)}%</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.meta}>练习 {state.attempts} 次</Text>
        {state.last_practiced_at && (
          <Text style={styles.meta}>
            上次: {new Date(state.last_practiced_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </Text>
        )}
      </View>

      {teachingSuggestion && (
        <View style={styles.suggestionBox}>
          <Text style={styles.suggestionLabel}>教学建议</Text>
          <Text style={styles.suggestionText}>{teachingSuggestion}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginVertical: 6,
    marginHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  subject: {
    fontSize: 12,
    color: '#999',
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  progressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#E5E5E5',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
    minWidth: 36,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meta: {
    fontSize: 12,
    color: '#999',
  },
  suggestionBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9500',
  },
  suggestionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E65100',
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
});
