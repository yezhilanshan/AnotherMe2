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
import { useChatStore } from '../lib/store';
import { DiagnosticProbe } from '../components/DiagnosticProbe';
import { KnowledgeStateCard } from '../components/KnowledgeStateCard';
import type { DiagnosticProbe as ProbeType, KnowledgeState } from '../lib/types';

type Tab = 'probes' | 'states';

export default function DiagnosticScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('probes');
  const [probe, setProbe] = useState<ProbeType | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stats, setStats] = useState({ total: 0, correct: 0, wrong: 0 });
  const [knowledgeStates, setKnowledgeStates] = useState<KnowledgeState[]>([]);
  const [teachingDecisions, setTeachingDecisions] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refreshLearningContext = useChatStore(s => s.refreshLearningContext);

  useEffect(() => {
    loadKnowledgeStates();
  }, []);

  const loadKnowledgeStates = async () => {
    setLoading(true);
    try {
      const [states, decisions] = await Promise.all([
        api.knowledge.getStates(USER_ID, { limit: 50 }),
        api.knowledge.getTeachingDecisions(USER_ID).catch(() => []),
      ]);
      setKnowledgeStates((states as unknown as KnowledgeState[]) || []);
      setTeachingDecisions((decisions as unknown as Record<string, unknown>[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载知识状态失败');
    } finally {
      setLoading(false);
    }
  };

  const generateProbe = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.knowledge.generateDiagnosticProbe(USER_ID);
      const raw = result as Record<string, unknown>;
      const parsed: ProbeType = {
        question: (raw.question as string) || '题目加载失败',
        options: raw.options as string[] | undefined,
        correctAnswer: (raw.correct_answer ?? raw.correctAnswer ?? '') as string | string[],
        explanation: (raw.explanation as string) || '暂无解析',
        hints: raw.hints as string[] | undefined,
        probeType: ((raw.probe_type || raw.probeType || 'choice') as string) as ProbeType['probeType'],
        difficulty: (raw.difficulty as number) || 1,
        knowledgePointId: (raw.knowledge_point_id || raw.knowledgePointId) as string | undefined,
        teachingAction: (raw.teaching_action || raw.teachingAction) as string | undefined,
        reason: raw.reason as string | undefined,
      };
      setProbe(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成题目失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmitAnswer = async (correct: boolean) => {
    setStats(prev => ({
      total: prev.total + 1,
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
    }));

    // Record quiz answer
    if (probe) {
      try {
        await api.knowledge.processQuizAnswer(USER_ID, {
          question_id: `probe-${Date.now()}`,
          is_correct: correct,
          knowledge_point_ids: probe.knowledgePointId ? [probe.knowledgePointId] : undefined,
        });
        await Promise.all([
          loadKnowledgeStates(),
          refreshLearningContext(),
        ]);
      } catch {}
    }
  };

  const getTeachingSuggestion = (kpId: string): string | undefined => {
    const decision = teachingDecisions.find(d => d.knowledge_point_id === kpId || d.knowledgePointId === kpId);
    return (decision?.teaching_action || decision?.teachingAction || decision?.reason) as string | undefined;
  };

  const renderStats = () => (
    <View style={styles.statsRow}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{stats.total}</Text>
        <Text style={styles.statLabel}>总题数</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: '#4CAF50' }]}>{stats.correct}</Text>
        <Text style={styles.statLabel}>正确</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: '#FF3B30' }]}>{stats.wrong}</Text>
        <Text style={styles.statLabel}>错误</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>诊断测评</Text>
        <TouchableOpacity onPress={() => router.push('/knowledge')} style={styles.headerRight}>
          <Ionicons name="stats-chart" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'probes' && styles.tabActive]}
          onPress={() => setActiveTab('probes')}
        >
          <Text style={[styles.tabText, activeTab === 'probes' && styles.tabTextActive]}>题目练习</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'states' && styles.tabActive]}
          onPress={() => setActiveTab('states')}
        >
          <Text style={[styles.tabText, activeTab === 'states' && styles.tabTextActive]}>知识状态</Text>
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

      {activeTab === 'probes' ? (
        <FlatList
          data={[]}
          renderItem={null}
          ListHeaderComponent={
            <>
              {renderStats()}
              <TouchableOpacity
                style={[styles.generateButton, generating && styles.generateDisabled]}
                onPress={generateProbe}
                disabled={generating}
              >
                {generating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="bulb" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.generateText}>
                  {generating ? '正在生成...' : '生成新题目'}
                </Text>
              </TouchableOpacity>
              {probe && <DiagnosticProbe probe={probe} onSubmit={handleSubmitAnswer} />}
            </>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      ) : (
        <FlatList
          data={knowledgeStates}
          keyExtractor={item => item.knowledge_point_id}
          renderItem={({ item }) => (
            <KnowledgeStateCard
              state={item}
              teachingSuggestion={getTeachingSuggestion(item.knowledge_point_id)}
            />
          )}
          ListHeaderComponent={
            <View style={styles.statesHeader}>
              <TouchableOpacity onPress={loadKnowledgeStates} style={styles.refreshButton}>
                <Ionicons name="refresh" size={18} color="#007AFF" />
                <Text style={styles.refreshText}>刷新</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/knowledge')} style={styles.detailLink}>
                <Text style={styles.detailLinkText}>查看完整追踪 →</Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>暂无知识状态数据</Text>
                <Text style={styles.emptyHint}>完成题目练习后会自动记录</Text>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 15,
    color: '#999',
  },
  tabTextActive: {
    color: '#007AFF',
    fontWeight: '600',
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
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 14,
    backgroundColor: '#007AFF',
    borderRadius: 12,
  },
  generateDisabled: {
    backgroundColor: '#99C5FF',
  },
  generateText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  statesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshText: {
    color: '#007AFF',
    fontSize: 14,
  },
  detailLink: {
    padding: 4,
  },
  detailLinkText: {
    color: '#007AFF',
    fontSize: 14,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
  emptyHint: {
    fontSize: 13,
    color: '#BBB',
    marginTop: 4,
  },
});
