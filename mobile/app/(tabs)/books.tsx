import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { formatLiveBookError, liveBookApi } from '../../lib/api';
import type { Book } from '../../lib/types';

const COVER_COLORS = ['#4A90D9', '#E85D75', '#50C878', '#FFB347', '#9B59B6', '#1ABC9C'];

function getCoverColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COVER_COLORS[Math.abs(hash) % COVER_COLORS.length];
}

async function prepareBookForReading(bookId: string, proposal?: Record<string, unknown>) {
  const proposalResult = await liveBookApi.confirmProposal({
    book_id: bookId,
    proposal,
  });
  const spine = (proposalResult as Record<string, unknown>)?.spine as Record<string, unknown> | undefined;
  const spineResult = await liveBookApi.confirmSpine({
    book_id: bookId,
    spine,
    auto_compile: false,
  });
  const firstPage = (((spineResult as Record<string, unknown>)?.pages as Record<string, unknown>[] | undefined) || [])[0];
  const firstPageId = firstPage?.id as string | undefined;
  if (firstPageId) {
    await liveBookApi.compilePage({
      book_id: bookId,
      page_id: firstPageId,
      force: false,
    });
  }
}

export default function BooksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topic, setTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    try {
      const result = await liveBookApi.listBooks();
      const raw = (result as Record<string, unknown>)?.books;
      const parsed: Book[] = ((raw as Record<string, unknown>[]) || []).map(b => ({
        id: (b.id as string) || '',
        title: (b.title as string) || 'Untitled',
        description: b.description as string | undefined,
        status: (b.status as string) || 'unknown',
        chapter_count: b.chapter_count as number | undefined,
        created_at: (b.created_at as string) || new Date().toISOString(),
      }));
      setBooks(parsed);
      setError(null);
    } catch (err) {
      setError(formatLiveBookError(err, '加载书库失败'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const onRefresh = () => {
    setRefreshing(true);
    loadBooks();
  };

  const handleCreateBook = async () => {
    const trimmedTopic = topic.trim();
    if (!trimmedTopic) {
      setError('请输入活书主题');
      return;
    }

    setCreating(true);
    setCreateStep('创建活书...');
    setError(null);
    try {
      const result = await liveBookApi.createBook({
        topic: trimmedTopic,
        language: 'zh-CN',
      });
      const rawBook = (result as Record<string, unknown>)?.book as Record<string, unknown> | undefined;
      const rawProposal = (result as Record<string, unknown>)?.proposal as Record<string, unknown> | undefined;
      const bookId = rawBook?.id as string | undefined;

      if (bookId) {
        setCreateStep('生成第一页...');
        await prepareBookForReading(bookId, rawProposal);
      }

      setTopic('');
      await loadBooks();

      Alert.alert('活书已创建', bookId ? '第一页已生成，可以开始阅读。' : '可以在书库中继续打开阅读。', [
        { text: '留在书库', style: 'cancel' },
        ...(bookId
          ? [{
              text: '打开',
              onPress: () => router.push({ pathname: '/book-reader', params: { bookId } }),
            }]
          : []),
      ]);
    } catch (err) {
      setError(formatLiveBookError(err, '创建活书失败'));
    } finally {
      setCreating(false);
      setCreateStep('');
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'ready': return { text: '可阅读', color: '#4CAF50' };
      case 'compiling': return { text: '编译中', color: '#FF9500' };
      case 'draft': return { text: '草稿', color: '#999' };
      default: return { text: status, color: '#999' };
    }
  };

  const renderBook = ({ item }: { item: Book }) => {
    const statusInfo = getStatusLabel(item.status);
    const coverColor = getCoverColor(item.id);

    return (
      <TouchableOpacity
        style={styles.bookCard}
        onPress={() => router.push({ pathname: '/book-reader', params: { bookId: item.id } })}
        activeOpacity={0.7}
      >
        <View style={[styles.bookCover, { backgroundColor: coverColor }]}>
          <Ionicons name="book" size={28} color="rgba(255,255,255,0.8)" />
          <Text style={styles.coverTitle} numberOfLines={2}>{item.title}</Text>
        </View>
        <View style={styles.bookInfo}>
          <Text style={styles.bookTitle} numberOfLines={1}>{item.title}</Text>
          {item.description && (
            <Text style={styles.bookDesc} numberOfLines={2}>{item.description}</Text>
          )}
          <View style={styles.bookMeta}>
            <View style={[styles.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
              <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.text}</Text>
            </View>
            {item.chapter_count !== undefined && (
              <Text style={styles.chapterCount}>{item.chapter_count} 章</Text>
            )}
          </View>
          <Text style={styles.dateText}>
            {new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 60 }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>加载书库...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Live Book</Text>
        <Text style={styles.headerSub}>{books.length} 本书</Text>
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
        data={books}
        renderItem={renderBook}
        keyExtractor={item => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
        ListHeaderComponent={
          <View style={styles.createPanel}>
            <View style={styles.createTitleRow}>
              <Ionicons name="sparkles" size={18} color="#007AFF" />
              <Text style={styles.createTitle}>创建活书</Text>
            </View>
            <TextInput
              value={topic}
              onChangeText={setTopic}
              placeholder="输入主题，例如：三角函数入门"
              style={styles.topicInput}
              editable={!creating}
              returnKeyType="done"
              onSubmitEditing={handleCreateBook}
            />
            <TouchableOpacity
              style={[styles.createButton, creating && styles.createButtonDisabled]}
              onPress={handleCreateBook}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="add-circle" size={20} color="#FFF" />
              )}
              <Text style={styles.createButtonText}>{creating ? (createStep || '创建中...') : '生成活书'}</Text>
            </TouchableOpacity>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#007AFF" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="library-outline" size={48} color="#CCC" />
            <Text style={styles.emptyText}>书库为空</Text>
            <Text style={styles.emptyHint}>输入主题即可创建第一本活书</Text>
          </View>
        }
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
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
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
  list: {
    padding: 12,
  },
  row: {
    justifyContent: 'space-between',
  },
  createPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  createTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  createTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  topicInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#FAFAFA',
  },
  createButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 10,
  },
  createButtonDisabled: {
    opacity: 0.65,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  bookCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  bookCover: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  coverTitle: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  bookInfo: {
    padding: 10,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  bookDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
    lineHeight: 16,
  },
  bookMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  chapterCount: {
    fontSize: 11,
    color: '#999',
  },
  dateText: {
    fontSize: 11,
    color: '#BBB',
    marginTop: 4,
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
