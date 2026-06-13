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
import { useRouter } from 'expo-router';
import { useChatStore } from '../../lib/store';
import { api } from '../../lib/api';
import { USER_ID, GATEWAY_URL, testGatewayConnection } from '../../lib/config';
import type { Session, LearningEventStats } from '../../lib/types';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessions, loadSessions, createSession, switchSession, sessionsLoaded } = useChatStore();
  const [stats, setStats] = useState<LearningEventStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'ok' | 'fail' | null>(null);

  useEffect(() => {
    loadSessions();
    loadStats();
    checkConnection();
  }, []);

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
    await Promise.all([loadSessions(), loadStats(), checkConnection()]);
    setRefreshing(false);
  }, []);

  const handleNewChat = async () => {
    const id = await createSession('新对话');
    switchSession(id);
    router.push('/chat');
  };

  const handleOpenSession = async (sessionId: string) => {
    await switchSession(sessionId);
    router.push('/chat');
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
        <Ionicons name="chatbubble" size={20} color="#007AFF" />
      </View>
      <View style={styles.sessionInfo}>
        <Text style={styles.sessionTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.sessionMeta}>
          {item.subject ? `${item.subject} · ` : ''}{formatDate(item.updated_at)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#CCC" />
    </TouchableOpacity>
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
          <View style={[styles.actionIcon, { backgroundColor: '#007AFF' }]}>
            <Ionicons name="add" size={24} color="#FFF" />
          </View>
          <Text style={styles.actionLabel}>新对话</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/diagnostic')}>
          <View style={[styles.actionIcon, { backgroundColor: '#FF9500' }]}>
            <Ionicons name="medkit" size={24} color="#FFF" />
          </View>
          <Text style={styles.actionLabel}>诊断练习</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/knowledge')}>
          <View style={[styles.actionIcon, { backgroundColor: '#34C759' }]}>
            <Ionicons name="stats-chart" size={24} color="#FFF" />
          </View>
          <Text style={styles.actionLabel}>知识追踪</Text>
        </TouchableOpacity>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#007AFF" />
        }
        ListEmptyComponent={
          !sessionsLoaded ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={48} color="#CCC" />
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
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
  },
  greeting: { fontSize: 24, fontWeight: '700', color: '#333' },
  subtitle: { fontSize: 13, color: '#999', marginTop: 2 },
  connectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF3B30',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  connectionText: { color: '#FFF', fontSize: 12, flex: 1 },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
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
  actionLabel: { fontSize: 12, color: '#666', fontWeight: '500' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#E5E5E5' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  seeAll: { fontSize: 14, color: '#007AFF' },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 1,
    padding: 14,
    borderRadius: 10,
  },
  sessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0F8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sessionInfo: { flex: 1 },
  sessionTitle: { fontSize: 15, fontWeight: '500', color: '#333' },
  sessionMeta: { fontSize: 12, color: '#999', marginTop: 2 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginTop: 12 },
  emptyHint: { fontSize: 13, color: '#BBB', marginTop: 4 },
});
