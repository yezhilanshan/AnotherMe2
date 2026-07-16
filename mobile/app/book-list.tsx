import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { liveBookApi, formatLiveBookError } from '../lib/api';
import { GATEWAY_URL, testGatewayConnection } from '../lib/config';
import { colors } from '../lib/theme';
import type { Book } from '../lib/types';

export default function BookListScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBookTopic, setNewBookTopic] = useState('');
  const [creating, setCreating] = useState(false);

  const LIST_REQUEST_TIMEOUT_MS = 20000;

  const loadBooks = useCallback(async (options?: { showInitialSpinner?: boolean }) => {
    const showInitialSpinner = options?.showInitialSpinner ?? false;
    if (showInitialSpinner) {
      setInitialLoading(true);
    }

    try {
      setError(null);

      const gateway = await testGatewayConnection();
      if (!gateway.ok) {
        throw new Error([
          `无法连接 Gateway：${GATEWAY_URL}`,
          gateway.message,
          '请确认 Python Gateway 已启动，手机和电脑在同一 WiFi，并在 mobile/.env 中设置正确的 EXPO_PUBLIC_DEV_SERVER_HOST。',
        ].join('\n'));
      }

      const result = await Promise.race([
        liveBookApi.listBooks(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Request timed out')), LIST_REQUEST_TIMEOUT_MS);
        }),
      ]);
      const bookList = (result?.books || []) as unknown as Book[];
      setBooks(Array.isArray(bookList) ? bookList : []);
    } catch (err) {
      const msg = formatLiveBookError(err, '加载书籍列表失败');
      setError(msg);
      console.warn('[book-list] loadBooks error:', err);
      setBooks([]);
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBooks({ showInitialSpinner: true });
  }, [loadBooks]);

  useFocusEffect(
    useCallback(() => {
      if (!initialLoading) {
        loadBooks();
      }
    }, [initialLoading, loadBooks]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadBooks();
    setRefreshing(false);
  }, [loadBooks]);

  const handleOpenBook = (bookId: string) => {
    router.push({
      pathname: '/book-reader',
      params: { bookId },
    });
  };

  const handleCreateBook = () => {
    setNewBookTopic('');
    setShowCreateModal(true);
  };

  const handleConfirmCreate = async () => {
    if (!newBookTopic.trim()) return;

    setCreating(true);
    try {
      const result = await liveBookApi.createBook({
        topic: newBookTopic.trim(),
        language: 'zh',
      });
      setShowCreateModal(false);
      setNewBookTopic('');
      await loadBooks();
      // 创建成功后跳转到书籍阅读器
      if (result.book?.id) {
        handleOpenBook(result.book.id as string);
      }
    } catch (err) {
      const msg = formatLiveBookError(err, '创建活书失败');
      setError(msg);
      console.warn('[book-list] createBook error:', err);
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateStr: unknown) => {
    try {
      if (!dateStr) return '';
      const d = new Date(dateStr as string | number);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return '草稿';
      case 'spine_ready': return '目录就绪';
      case 'ready': return '可阅读';
      default: return status || '未知';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return colors.warning;
      case 'spine_ready': return colors.primary;
      case 'ready': return colors.success;
      default: return colors.textMuted;
    }
  };

  const renderBook = ({ item }: { item: Book }) => {
    try {
      return (
        <TouchableOpacity
          style={styles.bookCard}
          onPress={() => handleOpenBook(item.id)}
          activeOpacity={0.86}
        >
          <View style={styles.bookIcon}>
            <Ionicons name="book" size={24} color={colors.primary} />
          </View>
          <View style={styles.bookInfo}>
            <Text style={styles.bookTitle} numberOfLines={1}>{item.title || '未命名书籍'}</Text>
            <View style={styles.bookMeta}>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status || '') + '20' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status || '') }]}>
                  {getStatusLabel(item.status || '')}
                </Text>
              </View>
              <Text style={styles.bookDate}>{formatDate(item.created_at)}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      );
    } catch {
      return null;
    }
  };

  const renderEmpty = () => (
    <View style={styles.empty}>
      <Ionicons name="book-outline" size={64} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>还没有活书</Text>
      <Text style={styles.emptyText}>
        活书是 AI 为你生成的互动式学习内容，包含文本、图表、测验等多种形式。
      </Text>
      <TouchableOpacity style={styles.createButton} onPress={handleCreateBook} activeOpacity={0.86}>
        <Ionicons name="add" size={18} color={colors.textInverse} />
        <Text style={styles.createButtonText}>创建第一本活书</Text>
      </TouchableOpacity>
    </View>
  );

  if (initialLoading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>我的活书</Text>
        <TouchableOpacity onPress={handleCreateBook} style={styles.addButton}>
          <Ionicons name="add-circle" size={28} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Error Banner */}
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={() => loadBooks()}>
          <Ionicons name="warning" size={16} color="#FFF" />
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorRetry}>点击重试</Text>
        </TouchableOpacity>
      )}

      {/* Book List */}
      <FlatList
        data={books}
        renderItem={renderBook}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 20 },
          books.length === 0 && styles.listEmpty,
        ]}
      />

      {/* Create Book Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>创建活书</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>你想学习什么主题？</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="例如：Python 基础、线性代数、世界历史..."
              placeholderTextColor={colors.textMuted}
              value={newBookTopic}
              onChangeText={setNewBookTopic}
              autoFocus
              maxLength={100}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalCreateButton,
                  (!newBookTopic.trim() || creating) && styles.modalCreateButtonDisabled,
                ]}
                onPress={handleConfirmCreate}
                disabled={!newBookTopic.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.modalCreateText}>创建</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  center: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  addButton: {
    padding: 4,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#FFF',
    fontSize: 13,
  },
  errorRetry: {
    color: '#FFF',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  listContent: {
    padding: 16,
  },
  listEmpty: {
    flexGrow: 1,
  },
  bookCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  bookIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  bookInfo: {
    flex: 1,
    minWidth: 0,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  bookMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  bookDate: {
    fontSize: 12,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textInverse,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.bgCard,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalLabel: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: {
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  modalCreateButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  modalCreateButtonDisabled: {
    opacity: 0.5,
  },
  modalCreateText: {
    fontSize: 15,
    color: colors.textInverse,
    fontWeight: '600',
  },
});
