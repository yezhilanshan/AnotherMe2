import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ToolCallProps {
  toolName: string;
  state: 'running' | 'completed' | 'error';
  input?: string;
  output?: string;
  error?: string;
}

export const ToolCallBlock = React.memo(function ToolCallBlock({ toolName, state, input, output, error }: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);

  const stateConfig = {
    running: { icon: 'sync-outline' as const, color: '#F59E0B', label: '运行中' },
    completed: { icon: 'checkmark-circle-outline' as const, color: '#10B981', label: '完成' },
    error: { icon: 'close-circle-outline' as const, color: '#EF4444', label: '错误' },
  };

  const cfg = stateConfig[state];

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <Ionicons name="build-outline" size={14} color="#666" />
          <Text style={styles.toolName}>{toolName}</Text>
          <View style={[styles.badge, { backgroundColor: cfg.color + '20' }]}>
            <Ionicons name={cfg.icon} size={11} color={cfg.color} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#999" />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {input && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>参数</Text>
              <Text style={styles.codeText} numberOfLines={10}>{input}</Text>
            </View>
          )}
          {output && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>结果</Text>
              <Text style={styles.codeText} numberOfLines={10}>{output}</Text>
            </View>
          )}
          {error && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: '#EF4444' }]}>错误</Text>
              <Text style={[styles.codeText, { color: '#EF4444' }]}>{error}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  toolName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 8,
  },
  section: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  codeText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#555',
    backgroundColor: '#f0f0f0',
    padding: 8,
    borderRadius: 6,
  },
});
