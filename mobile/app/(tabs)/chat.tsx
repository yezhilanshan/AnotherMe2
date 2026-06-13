import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from 'expo-router';
import { ChatBubble } from '../../components/ChatBubble';
import { ChatInput } from '../../components/ChatInput';
import { SessionList } from '../../components/SessionList';
import { CapabilityBar } from '../../components/CapabilitySelector';
import { useChatStore, type Message } from '../../lib/store';

const RenderItem = React.memo(({ item, onFeedback }: { item: Message; onFeedback?: (id: string, r: 'like' | 'dislike') => void }) => (
  <ChatBubble message={item} onFeedback={onFeedback} />
));

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="chatbubbles" size={48} color="#007AFF" />
      </View>
      <Text style={styles.emptyTitle}>AI 导师</Text>
      <Text style={styles.emptySubtitle}>输入消息开始对话</Text>
    </View>
  );
}
const MemoEmptyState = React.memo(EmptyState);

export default function ChatScreen() {
  const messages = useChatStore(s => s.messages);
  const isStreaming = useChatStore(s => s.isStreaming);
  const error = useChatStore(s => s.error);
  const currentAgent = useChatStore(s => s.currentAgent);
  const sessions = useChatStore(s => s.sessions);
  const activeSessionId = useChatStore(s => s.activeSessionId);
  const selectedCapability = useChatStore(s => s.selectedCapability);
  const sendMessage = useChatStore(s => s.sendMessage);
  const stopStreaming = useChatStore(s => s.stopStreaming);
  const clearError = useChatStore(s => s.clearError);
  const submitFeedback = useChatStore(s => s.submitFeedback);
  const loadSessions = useChatStore(s => s.loadSessions);
  const createSession = useChatStore(s => s.createSession);
  const switchSession = useChatStore(s => s.switchSession);
  const deleteSession = useChatStore(s => s.deleteSession);
  const refreshLearningContext = useChatStore(s => s.refreshLearningContext);
  const setSelectedCapability = useChatStore(s => s.setSelectedCapability);

  const flatListRef = useRef<FlatList<Message>>(null);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [sessionListVisible, setSessionListVisible] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => { loadSessions(); refreshLearningContext(); }, []);

  // 输入框聚焦时隐藏 tab bar，失焦时恢复
  const handleFocusChange = useCallback((focused: boolean) => {
    setInputFocused(focused);
    const parent = navigation.getParent();
    if (!parent) return;
    if (focused) {
      parent.setOptions({
        tabBarStyle: { display: 'none' as const },
      });
    } else {
      parent.setOptions({
        tabBarStyle: {
          borderTopColor: '#E5E5E5',
        },
      });
    }
  }, [navigation]);

  const handleSend = useCallback(async (text: string) => {
    if (!useChatStore.getState().activeSessionId) {
      await createSession('新对话');
    }
    await sendMessage(text);
    // 发送后恢复 tab bar
    handleFocusChange(false);
  }, [sendMessage, createSession, handleFocusChange]);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  const renderItem = useCallback(({ item }: { item: Message }) => (
    <RenderItem item={item} onFeedback={submitFeedback} />
  ), [submitFeedback]);

  const keyExtractor = useCallback((item: Message) => item.id, []);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header — 只保留左侧会话切换 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerLeft} onPress={() => setSessionListVisible(true)}>
          <Text style={styles.headerTitle} numberOfLines={1}>{activeSession?.title || 'AI 导师'}</Text>
          {currentAgent ? (
            <Text style={styles.headerAgent}>当前: {currentAgent}</Text>
          ) : sessions.length > 0 ? (
            <Text style={styles.headerAgent}>点击切换 · {sessions.length} 个会话</Text>
          ) : null}
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={clearError}><Text style={styles.errorDismiss}>✕</Text></TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[styles.messageList, { paddingBottom: insets.bottom + 60 }]}
        ListEmptyComponent={<MemoEmptyState />}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        removeClippedSubviews
        maxToRenderPerBatch={8}
        windowSize={10}
      />

      {isStreaming ? (
        <View style={styles.streamingIndicator}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.streamingText}>{currentAgent ? `${currentAgent} 处理中...` : 'AI 正在思考...'}</Text>
        </View>
      ) : null}

      <CapabilityBar selectedCapability={selectedCapability} onSelect={setSelectedCapability} visible={!isStreaming && !inputFocused} />
      <ChatInput onSend={handleSend} onStop={stopStreaming} isStreaming={isStreaming} disabled={false} onFocusChange={handleFocusChange} />

      <SessionList visible={sessionListVisible} sessions={sessions} activeSessionId={activeSessionId} onClose={() => setSessionListVisible(false)} onCreateSession={createSession} onSwitchSession={switchSession} onDeleteSession={deleteSession} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#007AFF' },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  headerAgent: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  errorContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFE5E5', paddingHorizontal: 16, paddingVertical: 10 },
  errorText: { color: '#FF3B30', fontSize: 14, flex: 1 },
  errorDismiss: { color: '#FF3B30', fontSize: 18, fontWeight: 'bold', paddingLeft: 12 },
  messageList: { paddingVertical: 12, flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 40, paddingHorizontal: 20 },
  emptyIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#f0f7ff', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: '700', color: '#1a1a1a', marginBottom: 6 },
  emptySubtitle: { fontSize: 14, color: '#999' },
  streamingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: '#F0F8FF' },
  streamingText: { marginLeft: 8, color: '#007AFF', fontSize: 14 },
});
