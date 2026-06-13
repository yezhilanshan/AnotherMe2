import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Source {
  title: string;
  url?: string;
}

interface SourcesBlockProps {
  sources: Source[];
}

export const SourcesBlock = React.memo(function SourcesBlock({ sources }: SourcesBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!sources || sources.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          <Ionicons name="book-outline" size={14} color="#007AFF" />
          <Text style={styles.headerText}>引用了 {sources.length} 个来源</Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="#007AFF" />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {sources.map((source, i) => (
            <TouchableOpacity
              key={i}
              style={styles.sourceItem}
              onPress={() => source.url && Linking.openURL(source.url)}
              activeOpacity={source.url ? 0.6 : 1}
              disabled={!source.url}
            >
              <Ionicons name="link-outline" size={12} color="#007AFF" />
              <Text style={[styles.sourceTitle, source.url && styles.sourceLink]} numberOfLines={1}>
                {source.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f0f7ff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d0e3ff',
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
  },
  headerText: {
    fontSize: 13,
    color: '#007AFF',
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 6,
  },
  sourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceTitle: {
    fontSize: 13,
    color: '#555',
    flex: 1,
  },
  sourceLink: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
});
