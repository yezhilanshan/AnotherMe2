import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  Alert,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '../lib/types';
import { colors } from '../lib/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = SCREEN_WIDTH * 0.82;

interface SessionListProps {
  visible: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

interface GroupedSessions {
  title: string;
  data: Session[];
}

export function SessionList({
  visible,
  sessions,
  activeSessionId,
  onClose,
  onSwitchSession,
  onDeleteSession,
}: SessionListProps) {
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const grouped = useMemo(() => groupSessions(filteredSessions), [filteredSessions]);

  useEffect(() => {
    if (visible) {
      setQuery('');
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleDelete = (session: Session) => {
    Alert.alert('删除会话', `确定删除「${session.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => onDeleteSession(session.id),
      },
    ]);
  };

  const handleSwitch = (sessionId: string) => {
    onSwitchSession(sessionId);
    onClose();
  };

  const renderItem = ({ item }: { item: Session }) => (
    <TouchableOpacity
      style={[styles.sessionItem, item.id === activeSessionId && styles.activeSession]}
      onPress={() => handleSwitch(item.id)}
      onLongPress={() => handleDelete(item)}
      activeOpacity={0.7}
    >
      <Text style={styles.sessionTitle} numberOfLines={1}>
        {item.title}
      </Text>
      {item.id === activeSessionId && (
        <View style={styles.activeDot} />
      )}
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ title }: { title: string }) => (
    <Text style={styles.sectionTitle}>{title}</Text>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <Animated.View
            style={[styles.backdrop, { opacity: fadeAnim }]}
            pointerEvents={visible ? 'auto' : 'none'}
          />
        </TouchableOpacity>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.content}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            {/* 搜索栏 */}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrap}>
                <Ionicons name="search-outline" size={18} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="搜索对话内容..."
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* 会话列表 */}
            <FlatList
              data={grouped}
              keyExtractor={(item) => item.title}
              renderItem={({ item }) => (
                <View>
                  {renderSectionHeader({ title: item.title })}
                  {item.data.map((session) => (
                    <View key={session.id}>
                      {renderItem({ item: session })}
                    </View>
                  ))}
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Ionicons name="chatbubble-ellipses-outline" size={40} color={colors.textMuted} />
                  <Text style={styles.emptyText}>
                    {query.trim() ? '未找到匹配的会话' : '暂无会话'}
                  </Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />

            {/* 底部用户信息占位 */}
            <View style={styles.footer}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={18} color={colors.textInverse} />
              </View>
              <Text style={styles.footerName} numberOfLines={1}>
                夜之阑珊
              </Text>
              <TouchableOpacity style={styles.footerIcon}>
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function groupSessions(sessions: Session[]): GroupedSessions[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const groups: Record<string, Session[]> = {};

  for (const session of sessions) {
    const d = new Date(session.updated_at || session.created_at);
    let key: string;

    if (d >= today) {
      key = '今天';
    } else if (d >= yesterday) {
      key = '昨天';
    } else if (d >= weekAgo) {
      key = '7 天内';
    } else if (d >= monthAgo) {
      key = '30 天内';
    } else {
      key = d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(session);
  }

  const order = ['今天', '昨天', '7 天内', '30 天内'];
  const result: GroupedSessions[] = [];

  for (const key of order) {
    if (groups[key]) {
      result.push({ title: key, data: groups[key] });
      delete groups[key];
    }
  }

  const remaining = Object.keys(groups).sort((a, b) => {
    const da = groups[a][0] ? new Date(groups[a][0].updated_at || groups[a][0].created_at) : new Date(0);
    const db = groups[b][0] ? new Date(groups[b][0].updated_at || groups[b][0].created_at) : new Date(0);
    return db.getTime() - da.getTime();
  });

  for (const key of remaining) {
    result.push({ title: key, data: groups[key] });
  }

  return result;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  drawer: {
    height: '100%',
    backgroundColor: colors.bgPage,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 10,
  },
  content: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgPage,
    borderRadius: 18,
    paddingHorizontal: 10,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    marginLeft: 6,
    paddingVertical: 0,
  },
  closeButton: {
    padding: 6,
    marginLeft: 8,
  },
  listContent: {
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 16,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginHorizontal: 12,
    borderRadius: 8,
  },
  activeSession: {
    backgroundColor: colors.primaryLight,
  },
  sessionTitle: {
    flex: 1,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginLeft: 8,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.bgCard,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginLeft: 10,
  },
  footerIcon: {
    padding: 4,
  },
});
