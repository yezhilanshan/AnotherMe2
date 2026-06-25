import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { healthCheck, getCapabilities } from '../lib/api';
import { DEFAULT_MODEL, GATEWAY_PORT, GATEWAY_URL, TUNNEL_HEADERS } from '../lib/config';
import { colors } from '../lib/theme';

interface TestResult {
  name: string;
  status: 'pending' | 'success' | 'error';
  message: string;
  duration?: number;
}

export default function ApiTestScreen() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [testing, setTesting] = useState(false);
  const insets = useSafeAreaInsets();

  const runTests = async () => {
    setTesting(true);
    setResults([]);

    const tests = [
      {
        name: '连接测试',
        fn: async () => {
          const response = await fetch(GATEWAY_URL, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
            headers: TUNNEL_HEADERS,
          });
          return { status: response.status, ok: response.ok };
        },
      },
      {
        name: 'Health Check',
        fn: healthCheck,
      },
      {
        name: 'Get Capabilities',
        fn: getCapabilities,
      },
      {
        name: 'AI 对话测试',
        fn: async () => {
          const response = await fetch(`${GATEWAY_URL}/v1/ai/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream', ...TUNNEL_HEADERS },
            body: JSON.stringify({
              messages: [{ role: 'user', content: '你好' }],
              model: DEFAULT_MODEL,
              api_key: '',
              capability: 'chat',
              user_id: 'mobile-test',
              request_id: `test-${Date.now()}`,
              streaming: true,
            }),
            signal: AbortSignal.timeout(15000),
          });
          const text = await response.text();
          return { status: response.status, body: text.substring(0, 300) };
        },
      },
    ];

    for (const test of tests) {
      const startTime = Date.now();

      setResults((prev) => [
        ...prev,
        { name: test.name, status: 'pending', message: '测试中...' },
      ]);

      try {
        const result = await test.fn();
        const duration = Date.now() - startTime;

        setResults((prev) =>
          prev.map((r) =>
            r.name === test.name
              ? {
                  ...r,
                  status: 'success',
                  message: JSON.stringify(result, null, 2).substring(0, 200),
                  duration,
                }
              : r
          )
        );
      } catch (error) {
        const duration = Date.now() - startTime;
        let errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('Network request failed')) {
          errorMessage = `网络连接失败！请检查：\n1. Gateway 是否已启动\n2. 手机和电脑是否在同一 WiFi\n3. 防火墙是否允许 ${GATEWAY_PORT} 端口`;
        } else if (errorMessage.includes('timeout')) {
          errorMessage = '连接超时！Gateway 可能未启动或网络不稳定';
        }

        setResults((prev) =>
          prev.map((r) =>
            r.name === test.name
              ? {
                  ...r,
                  status: 'error',
                  message: errorMessage,
                  duration,
                }
              : r
          )
        );
      }
    }

    setTesting(false);
  };

  const showNetworkHelp = () => {
    Alert.alert(
      '网络连接帮助',
      `当前 Gateway 地址：\n${GATEWAY_URL}\n\n如果连接失败，请检查：\n\n1. Python Gateway 是否已启动\n   运行：python run_gateway.py\n\n2. 手机和电脑是否在同一 WiFi 网络\n\n3. Windows 防火墙是否允许 ${GATEWAY_PORT} 端口\n   控制面板 → 防火墙 → 允许应用\n\n4. 如果端口被占用，可以修改端口：\n   设置环境变量 GATEWAY_PORT=${GATEWAY_PORT}`,
      [{ text: '知道了' }]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>API 连接测试</Text>
        <Text style={styles.gatewayUrl}>Gateway: {GATEWAY_URL}</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.testButton, testing && styles.testButtonDisabled]}
            onPress={runTests}
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.testButtonText}>运行 API 测试</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.helpButton}
            onPress={showNetworkHelp}
          >
            <Text style={styles.helpButtonText}>?</Text>
          </TouchableOpacity>
        </View>

        {results.map((result, index) => (
          <View key={index} style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Text style={styles.resultName}>{result.name}</Text>
              <View
                style={[
                  styles.statusBadge,
                  result.status === 'success' && styles.statusSuccess,
                  result.status === 'error' && styles.statusError,
                  result.status === 'pending' && styles.statusPending,
                ]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons
                    name={
                      result.status === 'success'
                        ? 'checkmark-circle'
                        : result.status === 'error'
                        ? 'close-circle'
                        : 'hourglass'
                    }
                    size={14}
                    color={result.status === 'success' ? colors.success : result.status === 'error' ? colors.error : colors.warning}
                  />
                  <Text style={styles.statusText}>
                    {result.status === 'success'
                      ? '成功'
                      : result.status === 'error'
                      ? '失败'
                      : '测试中'}
                  </Text>
                </View>
              </View>
            </View>

            {result.duration && (
              <Text style={styles.duration}>耗时: {result.duration}ms</Text>
            )}

            <Text
              style={[
                styles.resultMessage,
                result.status === 'error' && styles.errorMessage,
              ]}
              numberOfLines={10}
            >
              {result.message}
            </Text>
          </View>
        ))}

        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>启动 Gateway 步骤</Text>
          <Text style={styles.instructionText}>
            1. 打开终端，进入目录：{'\n'}
            <Text style={styles.code}>cd D:\AnotherMe-main\AnotherMe\anotherme2_engine</Text>{'\n\n'}
            2. 运行 Gateway：{'\n'}
            <Text style={styles.code}>D:\AnotherMe-main\.venv\Scripts\python.exe run_gateway.py</Text>{'\n\n'}
            3. 看到 "Uvicorn running on http://0.0.0.0:{GATEWAY_PORT}" 表示启动成功{'\n\n'}
            4. 如果端口被占用，设置环境变量：{'\n'}
            <Text style={styles.code}>set GATEWAY_PORT=8082</Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textInverse,
  },
  gatewayUrl: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  testButton: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  testButtonDisabled: {
    backgroundColor: colors.primaryLight,
  },
  testButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  helpButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  helpButtonText: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  resultCard: {
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  statusSuccess: {
    backgroundColor: colors.successLight,
  },
  statusError: {
    backgroundColor: colors.errorLight,
  },
  statusPending: {
    backgroundColor: colors.warningLight,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  duration: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  resultMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  errorMessage: {
    color: colors.error,
  },
  instructions: {
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    padding: 16,
    marginTop: 8,
    marginBottom: 32,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: colors.bgInput,
    paddingHorizontal: 4,
  },
});
