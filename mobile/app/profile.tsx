import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { api } from "../lib/api";
import {
  USER_ID,
  GATEWAY_URL,
  WEB_URL,
  testWebBffConnection,
} from "../lib/config";
import { getGatewayUrl, getWebUrl } from "../lib/runtime-gateway-config";
import { useChatStore } from "../lib/store";
import { colors } from "../lib/theme";
import { BackgroundImage } from "../components/ui/BackgroundImage";
import type { LearningEventStats } from "../lib/types";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { sessions } = useChatStore();
  const [stats, setStats] = useState<LearningEventStats | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [profileData, statsData] = await Promise.all([
        api.students.getProfile(USER_ID).catch(() => null),
        api.learningEvents.getStats(USER_ID).catch(() => null),
      ]);
      setProfile(profileData as Record<string, unknown> | null);
      setStats(statsData as unknown as LearningEventStats | null);
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      await api.core.healthCheck();
      Alert.alert("连接成功", `Gateway 运行正常\n${GATEWAY_URL}`);
    } catch (e) {
      Alert.alert(
        "连接失败",
        `无法连接到 Gateway\n${GATEWAY_URL}\n\n${e instanceof Error ? e.message : ""}`,
      );
    }
  };

  const handleTestWebBffConnection = async () => {
    const result = await testWebBffConnection();
    Alert.alert(result.ok ? "连接成功" : "连接失败", result.message);
  };

  const StatCard = ({
    label,
    value,
    icon,
    color,
  }: {
    label: string;
    value: string | number;
    icon: string;
    color: string;
  }) => (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: color + "20" }]}>
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={20}
          color={color}
        />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );

  const SettingRow = ({
    label,
    value,
    icon,
    onPress,
  }: {
    label: string;
    value?: string;
    icon: string;
    onPress?: () => void;
  }) => (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingLeft}>
        <Ionicons
          name={icon as keyof typeof Ionicons.glyphMap}
          size={20}
          color={colors.textSecondary}
        />
        <Text style={styles.settingLabel}>{label}</Text>
      </View>
      <View style={styles.settingRight}>
        {value && <Text style={styles.settingValue}>{value}</Text>}
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View
        style={[styles.container, styles.center, { paddingTop: insets.top }]}
      >
        <BackgroundImage source={require("../assets/backgrounds/home_bg.png")} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackgroundImage source={require("../assets/backgrounds/home_bg.png")} />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>个人与设置</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile header card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {USER_ID.slice(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{USER_ID}</Text>
            <Text style={styles.userRole}>学生</Text>
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard
            label="对话数"
            value={sessions.length}
            icon="chatbubble"
            color={colors.primary}
          />
          <StatCard
            label="学习事件"
            value={stats?.total_events || 0}
            icon="school"
            color={colors.success}
          />
          <StatCard
            label="事件类型"
            value={Object.keys(stats?.event_types || {}).length}
            icon="layers"
            color={colors.warning}
          />
        </View>

        {/* Profile Info */}
        {profile &&
          (() => {
            const p = profile as Record<string, unknown>;
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>学习档案</Text>
                <View style={styles.settingsCard}>
                  {p.weak_subjects ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>薄弱科目</Text>
                      <Text style={styles.infoValue}>
                        {String(p.weak_subjects)}
                      </Text>
                    </View>
                  ) : null}
                  {p.total_sessions !== undefined ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>总会话数</Text>
                      <Text style={styles.infoValue}>
                        {String(p.total_sessions)}
                      </Text>
                    </View>
                  ) : null}
                  {p.total_messages !== undefined ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>总消息数</Text>
                      <Text style={styles.infoValue}>
                        {String(p.total_messages)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })()}

        {/* Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>设置</Text>
          <View style={styles.settingsCard}>
            <SettingRow
              label="Gateway 地址"
              value={getGatewayUrl()}
              icon="server"
              onPress={() => router.push("/settings")}
            />
            <SettingRow
              label="Web/BFF 地址"
              value={getWebUrl()}
              icon="globe"
              onPress={handleTestWebBffConnection}
            />
            <SettingRow label="用户 ID" value={USER_ID} icon="person" />
            <SettingRow
              label="诊断测试"
              icon="medkit"
              onPress={() => router.push("/diagnostic")}
            />
            <SettingRow
              label="知识追踪"
              icon="stats-chart"
              onPress={() => router.push("/knowledge")}
            />
            <SettingRow
              label="API 连接测试"
              icon="pulse"
              onPress={() => router.push("/explore")}
            />
            <SettingRow
              label="Gateway 连接测试"
              icon="wifi"
              onPress={handleTestConnection}
            />
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关于</Text>
          <View style={styles.settingsCard}>
            <SettingRow label="版本" value="1.0.0" icon="information-circle" />
            <SettingRow
              label="技术栈"
              value="React Native + Expo"
              icon="code-slash"
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0)" },
  center: { justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(255, 252, 249, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.textInverse, fontSize: 24, fontWeight: "700" },
  userName: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  userRole: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 18,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255, 252, 249, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  statCard: { alignItems: "center", gap: 4 },
  statIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textMuted },
  section: { marginTop: 16, paddingHorizontal: 16 },
  sectionTitle: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: "700",
    marginBottom: 8,
    marginLeft: 4,
  },
  settingsCard: {
    borderRadius: 20,
    backgroundColor: "rgba(255, 252, 249, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  infoLabel: { fontSize: 15, color: colors.textPrimary },
  infoValue: { fontSize: 15, color: colors.textSecondary, maxWidth: 160 },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: { fontSize: 15, color: colors.textPrimary },
  settingRight: { flexDirection: "row", alignItems: "center", gap: 4 },
  settingValue: { fontSize: 13, color: colors.textMuted, maxWidth: 180 },
});
