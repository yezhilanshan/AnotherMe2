import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
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
import { colors } from '../lib/theme';

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

  // ── 将 teachingDecisions 转为 Map 做 O(1) 查找 ──
  const teachingDecisionMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of teachingDecisions) {
      const kpId = (d.knowledge_point_id || d.knowledgePointId) as string;
      const suggestion = (d.teaching_action || d.teachingAction || d.reason) as string;
      if (kpId && suggestion) {
        map.set(kpId, suggestion);
      }
    }
    return map;
  }, [teachingDecisions]);

  const getTeachingSuggestion = (kpId: string): string | undefined => {
    return teachingDecisionMap.get(kpId);
  };

  const renderStats = () => (
    <View style={styles.statsRow}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{stats.total}</Text>
        <Text style={styles.statLabel}>总题数</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: colors.success }]}>{stats.correct}</Text>
        <Text style={styles.statLabel}>正确</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={[styles.statValue, { color: colors.error }]}>{stats.wrong}</Text>
        <Text style={styles.statLabel}>错误</Text>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.textInverse} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>诊断测评</Text>
        <TouchableOpacity onPress={() => router.push('/knowledge')} style={styles.headerRight}>
          <Ionicons name="stats-chart" size={22} color={colors.textInverse} />
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
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
          {renderStats()}
          <TouchableOpacity
            style={[styles.generateButton, generating && styles.generateDisabled]}
            onPress={generateProbe}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Ionicons name="bulb" size={20} color={colors.textInverse} />
            )}
            <Text style={styles.generateText}>
              {generating ? '正在生成...' : '生成新题目'}
            </Text>
          </TouchableOpacity>
          {probe && <DiagnosticProbe probe={probe} onSubmit={handleSubmitAnswer} />}
        </ScrollView>
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
                <Ionicons name="refresh" size={18} color={colors.primary} />
                <Text style={styles.refreshText}>刷新</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push('/knowledge')} style={styles.detailLink}>
                <Text style={styles.detailLinkText}>查看完整追踪 →</Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
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
    backgroundColor: colors.bgPage,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
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
    color: colors.textInverse,
    textAlign: 'center',
  },
  headerRight: {
    padding: 4,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 15,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
    flex: 1,
  },
  errorDismiss: {
    color: colors.error,
    fontSize: 18,
    fontWeight: 'bold',
    paddingLeft: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    backgroundColor: colors.bgCard,
    marginBottom: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
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
    backgroundColor: colors.primary,
    borderRadius: 12,
  },
  generateDisabled: {
    backgroundColor: colors.primaryLight,
  },
  generateText: {
    color: colors.textInverse,
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
    color: colors.primary,
    fontSize: 14,
  },
  detailLink: {
    padding: 4,
  },
  detailLinkText: {
    color: colors.primary,
    fontSize: 14,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
  },
});
