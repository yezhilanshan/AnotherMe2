import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors } from '../lib/theme';

interface WebPreviewProps {
  visible: boolean;
  url: string;
  onClose: () => void;
}

export const WebPreview = React.memo(function WebPreview({ visible, url: initialUrl, onClose }: WebPreviewProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const webViewRef = useRef<WebView>(null);

  // 当 initialUrl 变化时同步状态
  useEffect(() => {
    setCurrentUrl(initialUrl);
    setInputUrl(initialUrl);
  }, [initialUrl]);

  const handleNavigate = useCallback(() => {
    let navigateUrl = inputUrl.trim();
    if (navigateUrl && !navigateUrl.startsWith('http')) {
      navigateUrl = 'https://' + navigateUrl;
    }
    if (navigateUrl) {
      setCurrentUrl(navigateUrl);
    }
  }, [inputUrl]);

  const handleRefresh = useCallback(() => {
    webViewRef.current?.reload();
  }, []);

  const handleLoadStart = useCallback(() => setLoading(true), []);
  const handleLoadEnd = useCallback(() => setLoading(false), []);
  const handleNavChange = useCallback((navState: { canGoBack: boolean; canGoForward: boolean; url: string }) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setInputUrl(navState.url);
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* 顶部导航栏 */}
        <View style={styles.navBar}>
          <TouchableOpacity onPress={onClose} style={styles.navBtn}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={styles.urlBar}>
            <Ionicons name="globe-outline" size={14} color={colors.textMuted} style={styles.urlIcon} />
            <TextInput
              style={styles.urlInput}
              value={inputUrl}
              onChangeText={setInputUrl}
              onSubmitEditing={handleNavigate}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              selectTextOnFocus
            />
          </View>

          <TouchableOpacity onPress={handleRefresh} style={styles.navBtn}>
            <Ionicons name="refresh" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* WebView 内容 */}
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={styles.webview}
          onLoadStart={handleLoadStart}
          onLoadEnd={handleLoadEnd}
          onNavigationStateChange={handleNavChange}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadingText}>加载中...</Text>
            </View>
          )}
        />

        {/* 底部工具栏 */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            onPress={() => webViewRef.current?.goBack()}
            disabled={!canGoBack}
            style={styles.toolBtn}
          >
            <Ionicons name="arrow-back" size={20} color={canGoBack ? colors.textPrimary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => webViewRef.current?.goForward()}
            disabled={!canGoForward}
            style={styles.toolBtn}
          >
            <Ionicons name="arrow-forward" size={20} color={canGoForward ? colors.textPrimary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={styles.toolBtn}>
            <Ionicons name="refresh" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
});

/**
 * 网页预览触发按钮 — 在消息气泡中显示
 */
export const WebPreviewButton = React.memo(function WebPreviewButton({ url, onPress }: { url: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={buttonStyles.container} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name="globe-outline" size={16} color={colors.primary} />
      <Text style={buttonStyles.text} numberOfLines={1}>
        {url}
      </Text>
      <Ionicons name="open-outline" size={14} color={colors.primary} />
    </TouchableOpacity>
  );
});

const buttonStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.infoLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    maxWidth: '100%',
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.primary,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCard,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: colors.quoteBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  navBtn: {
    padding: 6,
  },
  urlBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    height: 36,
  },
  urlIcon: {
    marginRight: 6,
  },
  urlInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textSecondary,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 8,
    backgroundColor: colors.quoteBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  toolBtn: {
    padding: 8,
  },
});
