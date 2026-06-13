import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../lib/api';
import { USER_ID } from '../lib/config';
import { KnowledgeStateCard } from '../components/KnowledgeStateCard';
import type { KnowledgeState } from '../lib/types';

export default function KnowledgeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weakPoints, setWeakPoints] = useState<KnowledgeState[]>([]);
  const [strongPoints, setStrongPoints] = useState<KnowledgeState[]>([]);
  const [weakest, setWeakest] = useState<KnowledgeState | null>(null);
  const [teachingSuggestion, setTeachingSuggestion] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [states, tracing] = await Promise.all([
        api.knowledge.getStates(USER_ID, { limit: 100 }),
        api.knowledge.getTracingSummary(USER_ID).catch(() => null),
      ]);

      const allStates = (states as unknown as KnowledgeState[]) || [];
      setWeakPoints(allStates.filter(s => s.mastery < 0.5));
      setStrongPoints(allStates.filter(s => s.mastery >= 0.8));

      // Find weakest
      if (allStates.length > 0) {
        const sorted = [...allStates].sort((a, b) => a.mastery - b.mastery);
        setWeakest(sorted[0]);

        // Try to get teaching suggestion for weakest
        try {
          const decision = await api.knowledge.getTeachingDecision(USER_ID, sorted[0].knowledge_point_id);
          setTeachingSuggestion(
            ((decision as Record<string, unknown>)?.teaching_action ||
              (decision as Record<string, unknown>)?.teachingAction ||
              (decision as Record<string, unknown>)?.reason) as string || null
          );
        } catch {
          setTeachingSuggestion(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>加载知识追踪数据...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>知识追踪概览</Text>
        <TouchableOpacity onPress={loadData} style={styles.headerRight}>
          <Ionicons name="refresh" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.errorDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={[]}
        renderItem={null}
        ListHeaderComponent={
          <>
            {/* Summary cards */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryCard, { backgroundColor: '#FFEBEE' }]}>
                <Text style={[styles.summaryValue, { color: '#C62828' }]}>{weakPoints.length}</Text>
                <Text style={styles.summaryLabel}>薄弱知识点</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#E8F5E9' }]}>
                <Text style={[styles.summaryValue, { color: '#2E7D32' }]}>{strongPoints.length}</Text>
                <Text style={styles.summaryLabel}>优秀知识点</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: '#E3F2FD' }]}>
                <Text style={[styles.summaryValue, { color: '#1565C0' }]}>{weakPoints.length + strongPoints.length}</Text>
                <Text style={styles.summaryLabel}>已追踪总数</Text>
              </View>
            </View>

            {/* Weakest point detail */}
            {weakest && (
              <View style={styles.weakestSection}>
                <Text style={styles.sectionTitle}>最薄弱知识点</Text>
                <KnowledgeStateCard
                  state={weakest}
                  teachingSuggestion={teachingSuggestion || undefined}
                />
              </View>
            )}

            {/* Weak points list */}
            {weakPoints.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>薄弱知识点 ({weakPoints.length})</Text>
                {weakPoints.map(wp => (
                  <KnowledgeStateCard key={wp.knowledge_point_id} state={wp} />
                ))}
              </View>
            )}

            {/* Strong points list */}
            {strongPoints.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>优秀知识点 ({strongPoints.length})</Text>
                {strongPoints.map(sp => (
                  <KnowledgeStateCard key={sp.knowledge_point_id} state={sp} />
                ))}
              </View>
            )}

            {/* Empty state */}
            {weakPoints.length === 0 && strongPoints.length === 0 && (
              <View style={styles.empty}>
                <Ionicons name="analytics-outline" size={48} color="#CCC" />
                <Text style={styles.emptyText}>暂无知识追踪数据</Text>
                <Text style={styles.emptyHint}>完成诊断测评后会自动记录</Text>
              </View>
            )}
          </>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#999',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  headerRight: {
    padding: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
    flex: 1,
  },
  errorDismiss: {
    color: '#FF3B30',
    fontSize: 18,
    fontWeight: 'bold',
    paddingLeft: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 12,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  weakestSection: {
    marginTop: 16,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: '#BBB',
    marginTop: 4,
  },
});
