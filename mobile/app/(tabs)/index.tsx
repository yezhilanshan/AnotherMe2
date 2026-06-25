import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useChatStore } from '../../lib/store';
import { api } from '../../lib/api';
import { USER_ID, GATEWAY_URL, testGatewayConnection } from '../../lib/config';
import { colors } from '../../lib/theme';
import type { ReviewPlanItem, Session, LearningEventStats } from '../../lib/types';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessions, loadSessions, createSession, switchSession, sessionsLoaded } = useChatStore();
  const reviewPlan = useChatStore(s => s.learningContext.reviewPlan || []);
  const refreshLearningContext = useChatStore(s => s.refreshLearningContext);
  const [stats, setStats] = useState<LearningEventStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'ok' | 'fail' | null>(null);

  useEffect(() => {
    loadSessions();
    loadStats();
    refreshLearningContext();
    checkConnection();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshLearningContext();
      loadStats();
    }, [refreshLearningContext]),
  );

  const checkConnection = async () => {
    setConnectionStatus('checking');
    const result = await testGatewayConnection();
    setConnectionStatus(result.ok ? 'ok' : 'fail');
    if (!result.ok) {
      console.warn('[home] Gateway 连接失败:', result.message);
    }
  };

  const loadStats = async () => {
    try {
      const result = await api.learningEvents.getStats(USER_ID);
      setStats(result as unknown as LearningEventStats);
    } catch {}
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadSessions(), loadStats(), refreshLearningContext(), checkConnection()]);
    setRefreshing(false);
  }, [loadSessions, refreshLearningContext]);

  const handleNewChat = async () => {
    const id = await createSession('新对话');
    switchSession(id);
    router.push('/chat');
  };

  const handleOpenSession = async (sessionId: string) => {
    await switchSession(sessionId);
    router.push('/chat');
  };

  const handleOpenReview = (item: ReviewPlanItem) => {
    router.push({
      pathname: '/chat',
      params: {
        reviewKnowledgePointId: item.knowledgePointId,
        reviewTitle: item.name,
        reviewMastery: String(item.mastery),
        reviewReason: item.reason,
        reviewMaterial: item.material,
        reviewCheckQuestion: item.checkQuestion,
        reviewIntervalDays: String(item.intervalDays),
        reviewNextReviewAt: item.nextReviewAt,
      },
    });
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  const renderSession = ({ item }: { item: Session }) => (
    <TouchableOpacity style={styles.sessionCard} onPress={() => handleOpenSession(item.id)}>
      <View style={styles.sessionIcon}>
        <Ionicons name="chatbubble" size={20} color={colors.primary} />
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.sessionMeta}>
          {item.subject ? `${item.subject} · ` : ''}{formatDate(item.updated_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );

  const renderReviewCard = (item: ReviewPlanItem) => (
    <TouchableOpacity
      key={item.knowledgePointId}
      style={styles.reviewCard}
      onPress={() => handleOpenReview(item)}
      activeOpacity={0.86}
    >
      <View style={styles.reviewTopRow}>
        <View style={styles.reviewIcon}>
          <Ionicons name="alarm" size={18} color={colors.warning} />
        </View>
        <View style={styles.reviewTitleWrap}>
          <Text style={styles.reviewName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.reviewReason} numberOfLines={1}>{item.reason}</Text>
        </View>
        <Text style={styles.reviewMastery}>{Math.round(item.mastery * 100)}%</Text>
      </View>
      <Text style={styles.reviewMaterial} numberOfLines={2}>{item.material}</Text>
      <View style={styles.reviewQuestionRow}>
        <Ionicons name="help-circle-outline" size={15} color={colors.primary} />
        <Text style={styles.reviewQuestion} numberOfLines={2}>{item.checkQuestion}</Text>
      </View>
      <View style={styles.reviewActionRow}>
        <Text style={styles.reviewDue}>
          {item.dueToday ? '今日应复习' : `下次 ${new Date(item.nextReviewAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`}
        </Text>
        <View style={styles.reviewAction}>
          <Text style={styles.reviewActionText}>问 AI 导师</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.textInverse} />
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderReviewEmpty = () => (
    <View style={styles.reviewEmptyCard}>
      <View style={styles.reviewEmptyIcon}>
        <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.reviewEmptyBody}>
        <Text style={styles.reviewEmptyTitle}>还没有可复习的知识点</Text>
        <Text style={styles.reviewEmptyText}>
          先拍一道题或完成一次练习，系统会按掌握度生成复习卡。
        </Text>
        <View style={styles.reviewEmptyActions}>
          <TouchableOpacity
            style={styles.reviewEmptyPrimary}
            onPress={() => router.push('/camera')}
            activeOpacity={0.86}
          >
            <Ionicons name="camera" size={14} color={colors.textInverse} />
            <Text style={styles.reviewEmptyPrimaryText}>去拍题</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.reviewEmptySecondary}
            onPress={refreshLearningContext}
            activeOpacity={0.86}
          >
            <Ionicons name="refresh" size={14} color={colors.primary} />
            <Text style={styles.reviewEmptySecondaryText}>刷新</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>镜我</Text>
          <Text style={styles.subtitle}>AI 教育平台</Text>
        </View>
      </View>

      {/* Connection status */}
      {connectionStatus === 'fail' && (
        <TouchableOpacity style={styles.connectionBanner} onPress={checkConnection}>
          <Ionicons name="warning" size={16} color="#FFF" />
          <Text style={styles.connectionText}>
            无法连接 Gateway ({GATEWAY_URL}){'\n'}
            点击重试 · 确保手机和电脑在同一 WiFi
          </Text>
        </TouchableOpacity>
      )}

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionCard} onPress={handleNewChat}>
          <View style={[styles.actionIcon, { backgroundColor: colors.primary }]}>
            <Ionicons name="add" size={24} color={colors.textInverse} />
          </View>
          <Text style={styles.actionLabel}>新对话</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/diagnostic')}>
          <View style={[styles.actionIcon, { backgroundColor: colors.warning }]}>
            <Ionicons name="medkit" size={24} color={colors.textInverse} />
          </View>
          <Text style={styles.actionLabel}>诊断练习</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/knowledge')}>
          <View style={[styles.actionIcon, { backgroundColor: colors.success }]}>
            <Ionicons name="stats-chart" size={24} color={colors.textInverse} />
          </View>
          <Text style={styles.actionLabel}>知识追踪</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/notes')}>
          <View style={[styles.actionIcon, { backgroundColor: colors.lavender }]}>
            <Ionicons name="document-text" size={24} color={colors.textInverse} />
          </View>
          <Text style={styles.actionLabel}>笔记整理</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.reviewSection}>
        <View style={styles.reviewHeader}>
          <View>
            <Text style={styles.sectionTitle}>今日复习</Text>
            <Text style={styles.reviewSubtitle}>按遗忘曲线和掌握度生成</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/knowledge')}>
            <Text style={styles.seeAll}>知识追踪</Text>
          </TouchableOpacity>
        </View>
        {reviewPlan.length > 0 ? reviewPlan.slice(0, 3).map(renderReviewCard) : renderReviewEmpty()}
      </View>

      {/* Stats */}
      {stats && (
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.total_events || 0}</Text>
            <Text style={styles.statLabel}>学习事件</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Object.keys(stats.event_types || {}).length}</Text>
            <Text style={styles.statLabel}>事件类型</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{sessions.length}</Text>
            <Text style={styles.statLabel}>对话数</Text>
          </View>
        </View>
      )}

      {/* Recent Sessions */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>最近对话</Text>
        <TouchableOpacity onPress={handleNewChat}>
          <Text style={styles.seeAll}>新建</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={sessions.slice(0, 20)}
        renderItem={renderSession}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !sessionsLoaded ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>暂无对话</Text>
              <Text style={styles.emptyHint}>点击「新对话」开始</Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPage },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: colors.bgCard,
  },
  greeting: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  connectionText: { color: colors.textInverse, fontSize: 12, flex: 1 },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: colors.bgCard,
    marginBottom: 8,
  },
  actionCard: { alignItems: 'center', gap: 6 },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  reviewSection: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    marginBottom: 8,
  },
  reviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  reviewSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  reviewCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  reviewTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  reviewIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reviewTitleWrap: { flex: 1, minWidth: 0 },
  reviewName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  reviewReason: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  reviewMastery: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.warning,
    marginLeft: 8,
  },
  reviewMaterial: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 10,
  },
  reviewQuestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  reviewQuestion: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  reviewActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  reviewDue: {
    fontSize: 12,
    color: colors.textMuted,
  },
  reviewAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  reviewActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textInverse,
  },
  reviewEmptyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    borderRadius: 8,
    padding: 12,
  },
  reviewEmptyIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reviewEmptyBody: {
    flex: 1,
    minWidth: 0,
  },
  reviewEmptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  reviewEmptyText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 4,
  },
  reviewEmptyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  reviewEmptyPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
  },
  reviewEmptyPrimaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textInverse,
  },
  reviewEmptySecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 6,
  },
  reviewEmptySecondaryText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    backgroundColor: colors.bgCard,
    marginBottom: 8,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: colors.divider },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  seeAll: { fontSize: 14, color: colors.primary },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    marginHorizontal: 16,
    marginBottom: 1,
    padding: 14,
    borderRadius: 10,
  },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sessionInfo: { flex: 1 },
  sessionTitle: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
  sessionMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, color: colors.textMuted, marginTop: 12 },
  emptyHint: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
});
