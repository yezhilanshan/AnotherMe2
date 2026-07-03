import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  getGatewayHost,
  getGatewayPort,
  getWebPort,
  getGatewayUrl,
  getWebUrl,
  updateGatewayConfig,
  resetGatewayConfig,
} from "../lib/runtime-gateway-config";
import { testGatewayConnection, testWebBffConnection } from "../lib/config";
import { colors } from "../lib/theme";

export default function GatewaySettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [host, setHost] = useState(getGatewayHost());
  const [gatewayPort, setGatewayPort] = useState(getGatewayPort());
  const [webPort, setWebPort] = useState(getWebPort());
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<"gateway" | "web" | null>(null);
  const [testResult, setTestResult] = useState<{
    type: "gateway" | "web";
    ok: boolean;
    message: string;
  } | null>(null);

  // Refresh displayed values in case they changed externally
  useEffect(() => {
    setHost(getGatewayHost());
    setGatewayPort(getGatewayPort());
    setWebPort(getWebPort());
  }, []);

  const handleSave = async () => {
    const trimmedHost = host.trim();
    const trimmedGp = gatewayPort.trim();
    const trimmedWp = webPort.trim();

    if (!trimmedHost) {
      Alert.alert("错误", "请输入电脑 IP 地址");
      return;
    }
    if (!trimmedGp || isNaN(Number(trimmedGp))) {
      Alert.alert("错误", "Gateway 端口必须是数字");
      return;
    }
    if (!trimmedWp || isNaN(Number(trimmedWp))) {
      Alert.alert("错误", "Web 端口必须是数字");
      return;
    }

    setSaving(true);
    try {
      await updateGatewayConfig({
        host: trimmedHost,
        gatewayPort: trimmedGp,
        webPort: trimmedWp,
      });
      setTestResult(null);
      Alert.alert("已保存", `Gateway: ${getGatewayUrl()}\nWeb: ${getWebUrl()}`);
    } catch (e) {
      Alert.alert("保存失败", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleTestGateway = async () => {
    // Save first if changed
    if (host !== getGatewayHost() || gatewayPort !== getGatewayPort()) {
      await handleSave();
    }
    setTesting("gateway");
    setTestResult(null);
    const result = await testGatewayConnection();
    setTestResult({ type: "gateway", ...result });
    setTesting(null);
  };

  const handleTestWeb = async () => {
    if (host !== getGatewayHost() || webPort !== getWebPort()) {
      await handleSave();
    }
    setTesting("web");
    setTestResult(null);
    const result = await testWebBffConnection();
    setTestResult({ type: "web", ...result });
    setTesting(null);
  };

  const handleReset = () => {
    Alert.alert("重置配置", "确定要恢复到默认配置吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "确定",
        style: "destructive",
        onPress: async () => {
          await resetGatewayConfig();
          setHost(getGatewayHost());
          setGatewayPort(getGatewayPort());
          setWebPort(getWebPort());
          setTestResult(null);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Gateway 设置</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hint */}
        <View style={styles.hintCard}>
          <Ionicons
            name="information-circle"
            size={20}
            color={colors.primary}
          />
          <Text style={styles.hintText}>
            修改后即时生效，无需重新 build App。{"\n"}
            在电脑 cmd 中运行 <Text style={styles.codeText}>ipconfig</Text> 查看
            IPv4 地址。
          </Text>
        </View>

        {/* Form */}
        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>电脑 IP 地址</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="例如 192.168.1.100"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="decimal-pad"
          />

          <Text style={styles.sectionTitle}>Gateway 端口</Text>
          <TextInput
            style={styles.input}
            value={gatewayPort}
            onChangeText={setGatewayPort}
            placeholder="8083"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />

          <Text style={styles.sectionTitle}>Web 端口（Next.js）</Text>
          <TextInput
            style={styles.input}
            value={webPort}
            onChangeText={setWebPort}
            placeholder="3000"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
          />
        </View>

        {/* Preview */}
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>当前 Gateway 地址</Text>
          <Text style={styles.previewUrl}>{getGatewayUrl()}</Text>
          <Text style={styles.previewLabel}>当前 Web 地址</Text>
          <Text style={styles.previewUrl}>{getWebUrl()}</Text>
        </View>

        {/* Actions */}
        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="save" size={20} color="#fff" />
          )}
          <Text style={styles.primaryBtnText}>
            {saving ? "保存中..." : "保存配置"}
          </Text>
        </TouchableOpacity>

        <View style={styles.testRow}>
          <TouchableOpacity
            style={styles.testBtn}
            onPress={handleTestGateway}
            disabled={testing !== null}
          >
            {testing === "gateway" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="pulse" size={18} color={colors.primary} />
            )}
            <Text style={styles.testBtnText}>测试 Gateway</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.testBtn}
            onPress={handleTestWeb}
            disabled={testing !== null}
          >
            {testing === "web" ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons name="globe" size={18} color={colors.primary} />
            )}
            <Text style={styles.testBtnText}>测试 Web</Text>
          </TouchableOpacity>
        </View>

        {/* Test Result */}
        {testResult && (
          <View
            style={[
              styles.resultCard,
              {
                borderLeftColor: testResult.ok ? colors.success : colors.error,
              },
            ]}
          >
            <Ionicons
              name={testResult.ok ? "checkmark-circle" : "close-circle"}
              size={20}
              color={testResult.ok ? colors.success : colors.error}
            />
            <Text style={styles.resultText}>{testResult.message}</Text>
          </View>
        )}

        {/* Reset */}
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Ionicons name="refresh" size={16} color={colors.textMuted} />
          <Text style={styles.resetText}>恢复默认配置</Text>
        </TouchableOpacity>

        {/* Current config display */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>当前连接信息</Text>
          <InfoRow label="Host" value={getGatewayHost()} />
          <InfoRow label="Gateway" value={getGatewayUrl()} />
          <InfoRow label="Web/BFF" value={getWebUrl()} />
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPage },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textPrimary },
  hintCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.primary + "10",
    margin: 16,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  hintText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  codeText: {
    fontFamily: "monospace",
    backgroundColor: colors.bgPage,
    color: colors.primary,
    fontSize: 12,
  },
  formCard: {
    backgroundColor: colors.bgCard,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.bgPage,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  previewCard: {
    backgroundColor: colors.bgCard,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 16,
  },
  previewLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
    marginTop: 8,
  },
  previewUrl: {
    fontSize: 15,
    color: colors.textPrimary,
    fontFamily: "monospace",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  testRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 10,
    gap: 10,
  },
  testBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgCard,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  testBtnText: { fontSize: 14, color: colors.primary, fontWeight: "500" },
  resultCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.bgCard,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    gap: 8,
    borderLeftWidth: 4,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    padding: 12,
    gap: 6,
  },
  resetText: { fontSize: 14, color: colors.textMuted },
  infoCard: {
    backgroundColor: colors.bgCard,
    margin: 16,
    borderRadius: 12,
    padding: 16,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  infoLabel: { fontSize: 13, color: colors.textMuted },
  infoValue: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: "monospace",
  },
});
