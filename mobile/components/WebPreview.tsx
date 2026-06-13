import React, { useState } from 'react';
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

interface WebPreviewProps {
  visible: boolean;
  url: string;
  onClose: () => void;
}

export function WebPreview({ visible, url: initialUrl, onClose }: WebPreviewProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  let webViewRef: WebView | null = null;

  const handleNavigate = () => {
    let navigateUrl = inputUrl.trim();
    if (navigateUrl && !navigateUrl.startsWith('http')) {
      navigateUrl = 'https://' + navigateUrl;
    }
    if (navigateUrl) {
      setCurrentUrl(navigateUrl);
    }
  };

  const handleRefresh = () => {
    webViewRef?.reload();
  };

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
            <Ionicons name="close" size={22} color="#333" />
          </TouchableOpacity>

          <View style={styles.urlBar}>
            <Ionicons name="globe-outline" size={14} color="#999" style={styles.urlIcon} />
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
            <Ionicons name="refresh" size={20} color="#333" />
          </TouchableOpacity>
        </View>

        {/* WebView 内容 */}
        <WebView
          ref={ref => { webViewRef = ref; }}
          source={{ uri: currentUrl }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={navState => {
            setCanGoBack(navState.canGoBack);
            setCanGoForward(navState.canGoForward);
            setInputUrl(navState.url);
          }}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>加载中...</Text>
            </View>
          )}
        />

        {/* 底部工具栏 */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            onPress={() => webViewRef?.goBack()}
            disabled={!canGoBack}
            style={styles.toolBtn}
          >
            <Ionicons name="arrow-back" size={20} color={canGoBack ? '#333' : '#ccc'} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => webViewRef?.goForward()}
            disabled={!canGoForward}
            style={styles.toolBtn}
          >
            <Ionicons name="arrow-forward" size={20} color={canGoForward ? '#333' : '#ccc'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefresh} style={styles.toolBtn}>
            <Ionicons name="refresh" size={20} color="#333" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/**
 * 网页预览触发按钮 — 在消息气泡中显示
 */
export function WebPreviewButton({ url, onPress }: { url: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={buttonStyles.container} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name="globe-outline" size={16} color="#007AFF" />
      <Text style={buttonStyles.text} numberOfLines={1}>
        {url}
      </Text>
      <Ionicons name="open-outline" size={14} color="#007AFF" />
    </TouchableOpacity>
  );
}

const buttonStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0f7ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#d0e3ff',
    maxWidth: '100%',
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: '#007AFF',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
    gap: 8,
  },
  navBtn: {
    padding: 6,
  },
  urlBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    paddingHorizontal: 8,
    height: 36,
  },
  urlIcon: {
    marginRight: 6,
  },
  urlInput: {
    flex: 1,
    fontSize: 14,
    color: '#333',
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
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#666',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    paddingVertical: 8,
    backgroundColor: '#f8f9fa',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e0e0e0',
  },
  toolBtn: {
    padding: 8,
  },
});
