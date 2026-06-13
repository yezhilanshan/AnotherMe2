import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GATEWAY_URL } from '../lib/config';

interface Artifact {
  type: string;
  url: string;
  filename: string;
  label: string;
}

interface MathAnimatorPreviewProps {
  output_mode?: string;
  artifacts?: Artifact[];
  code?: { language: string; content: string };
}

/**
 * 数学动画预览 — 展示视频/图片结果，不展示代码
 */
export const MathAnimatorPreview = React.memo(function MathAnimatorPreview({
  artifacts,
}: MathAnimatorPreviewProps) {
  if (!artifacts?.length) return null;

  const resolveUrl = (url: string) => {
    if (url.startsWith('http')) return url;
    return `${GATEWAY_URL}${url}`;
  };

  const videos = artifacts.filter(a => a.type === 'video');
  const images = artifacts.filter(a => a.type === 'image');

  return (
    <View style={styles.container}>
      {videos.map((v, i) => (
        <TouchableOpacity
          key={`v-${i}`}
          style={styles.card}
          onPress={() => Linking.openURL(resolveUrl(v.url))}
          activeOpacity={0.8}
        >
          <Ionicons name="play-circle" size={40} color="#007AFF" />
          <Text style={styles.title}>▶ 播放动画</Text>
          <Text style={styles.subtitle}>{v.label || '数学动画视频'}</Text>
        </TouchableOpacity>
      ))}

      {images.map((img, i) => (
        <TouchableOpacity
          key={`i-${i}`}
          style={styles.card}
          onPress={() => Linking.openURL(resolveUrl(img.url))}
          activeOpacity={0.8}
        >
          <Ionicons name="image" size={40} color="#10B981" />
          <Text style={styles.title}>查看图片</Text>
          <Text style={styles.subtitle}>{img.label || img.filename}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginVertical: 4,
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d0e3ff',
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
  },
  subtitle: {
    fontSize: 12,
    color: '#999',
  },
});
