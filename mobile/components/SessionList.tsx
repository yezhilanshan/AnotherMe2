import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '../lib/types';
import { colors } from '../lib/theme';

interface SessionListProps {
  visible: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onCreateSession: (title: string) => Promise<string>;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function SessionList({
  visible,
  sessions,
  activeSessionId,
  onClose,
  onCreateSession,
  onSwitchSession,
  onDeleteSession,
}: SessionListProps) {
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const insets = useSafeAreaInsets();

  const handleCreate = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await onCreateSession(title);
      setNewTitle('');
      onClose();
    } catch {
      Alert.alert('错误', '创建会话失败');
    } finally {
      setCreating(false);
    }
  };

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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.title}>会话管理</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>完成</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.createRow}>
          <TextInput
            style={styles.createInput}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="新建会话标题..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
          <TouchableOpacity
            style={[styles.createButton, (!newTitle.trim() || creating) && styles.createButtonDisabled]}
            onPress={handleCreate}
            disabled={!newTitle.trim() || creating}
          >
            <Text style={styles.createButtonText}>新建</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={sessions}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.sessionItem, item.id === activeSessionId && styles.activeSession]}
              onPress={() => handleSwitch(item.id)}
              onLongPress={() => handleDelete(item)}
            >
              <View style={styles.sessionInfo}>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.sessionMeta}>
                  {item.subject ? `${item.subject} · ` : ''}
                  {formatDate(item.created_at)}
                </Text>
              </View>
              {item.id === activeSessionId && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>当前</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>暂无会话，创建一个开始吧</Text>
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: colors.bgCard,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.primary,
    borderRadius: 14,
  },
  closeButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  createRow: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: colors.bgCard,
    marginBottom: 8,
  },
  createInput: {
    flex: 1,
    height: 40,
    backgroundColor: colors.bgPage,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    marginRight: 8,
  },
  createButton: {
    paddingHorizontal: 16,
    height: 40,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonDisabled: {
    backgroundColor: colors.primaryLight,
  },
  createButtonText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 1,
    borderRadius: 8,
    marginTop: 8,
  },
  activeSession: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sessionMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.primary,
    borderRadius: 10,
    marginLeft: 8,
  },
  activeBadgeText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
