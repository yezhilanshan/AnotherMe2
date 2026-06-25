import React, { useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

interface WebViewScreenProps {
  url: string;
  title?: string;
}

export function WebViewScreen({ url, title }: WebViewScreenProps) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(title || '');

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    if (navState.title) {
      setCurrentTitle(navState.title);
    }
  };

  const handleGoBack = () => {
    webViewRef.current?.goBack();
  };

  const handleReload = () => {
    setError(null);
    webViewRef.current?.reload();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Navigation bar */}
      <View style={styles.navBar}>
        {canGoBack && (
          <TouchableOpacity onPress={handleGoBack} style={styles.navButton}>
            <Ionicons name="arrow-back" size={22} color="#333" />
          </TouchableOpacity>
        )}
        <Text style={styles.navTitle} numberOfLines={1}>
          {currentTitle || '镜我'}
        </Text>
        <TouchableOpacity onPress={handleReload} style={styles.navButton}>
          <Ionicons name="refresh" size={22} color="#333" />
        </TouchableOpacity>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          setError(nativeEvent.description || '加载失败');
          setLoading(false);
        }}
        onNavigationStateChange={handleNavigationStateChange}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        startInLoadingState
        scalesPageToFit
        allowsBackForwardNavigationGestures
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
          </View>
        )}
        renderError={(errorDomain, errorCode, errorDesc) => (
          <View style={styles.errorContainer}>
            <Ionicons name="cloud-offline-outline" size={48} color="#CCC" />
            <Text style={styles.errorTitle}>无法连接</Text>
            <Text style={styles.errorDesc}>{errorDesc}</Text>
            <Text style={styles.errorHint}>
              请确认 Web 端已启动：{'\n'}{url}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleReload}>
              <Text style={styles.retryText}>重试</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCard,
  },
  navBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: colors.quoteBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  navButton: {
    padding: 8,
  },
  navTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginHorizontal: 8,
  },
  webview: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: colors.bgPage,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 16,
  },
  errorDesc: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
    textAlign: 'center',
  },
  errorHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
});
