import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useChatStore } from "../../lib/store";
import { api } from "../../lib/api";
import { USER_ID, GATEWAY_URL, testGatewayConnection } from "../../lib/config";
import { colors } from "../../lib/theme";
import { BackgroundImage } from "../../components/ui/BackgroundImage";
import type { LearningEventStats, ReviewPlanItem } from "../../lib/types";

interface ClassroomSummary {
  id: string;
  title: string;
  created_at: string;
  scenes_count: number;
  scene_types?: string[];
}

// 参考图片风格：桃色背景 + 紫/橙强调色
const PEACH_OVERLAY = "rgba(255, 245, 240, 0.78)";
const PURPLE = "#6B5CE7";
const PURPLE_LIGHT = "#EDE9FF";
const ORANGE = "#FF8C61";
const ORANGE_LIGHT = "#FFE8E0";
const GLASS_BG = "rgba(255, 252, 249, 0.88)";
const GLASS_BORDER = "rgba(255, 255, 255, 0.6)";
const CARD_SHADOW = {
  shadowColor: "#5A3E36",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.08,
  shadowRadius: 14,
  elevation: 4,
};

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

function shortDate(value?: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("zh-CN", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function textField(profile: Record<string, unknown> | null, keys: string[]): string {
  if (!profile) return "";
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length) return value.map(String).join("、");
  }
  return "";
}

function estimateMinutes(classroom: ClassroomSummary): number {
  return Math.max(15, Math.round((classroom.scenes_count || 1) * 18));
}

function buildWeekStudyBuckets(classrooms: ClassroomSummary[]) {
  const buckets = WEEK_LABELS.map((name) => ({ name, minutes: 0 }));
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  classrooms.forEach((classroom) => {
    const created = new Date(classroom.created_at).getTime();
    if (!Number.isFinite(created) || now - created > sevenDays) return;
    const day = new Date(created).getDay();
    const index = day === 0 ? 6 : day - 1;
    buckets[index].minutes += estimateMinutes(classroom);
  });
  return buckets;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reviewPlan = useChatStore((s) => s.learningContext.reviewPlan || []);
  const refreshLearningContext = useChatStore((s) => s.refreshLearningContext);
  const [stats, setStats] = useState<LearningEventStats | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<
    "checking" | "ok" | "fail" | null
  >(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [statsData, profileData, classroomData] = await Promise.all([
        api.learningEvents.getStats(USER_ID).catch(() => null),
        api.students.getProfile(USER_ID).catch(() => null),
        api.classroom.list(80).catch(() => ({ classrooms: [] })),
      ]);
      setStats(statsData as unknown as LearningEventStats | null);
      setProfile(profileData as Record<string, unknown> | null);
      setClassrooms(
        ((classroomData as { classrooms?: ClassroomSummary[] }).classrooms || [])
          .slice()
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const checkConnection = useCallback(async () => {
    setConnectionStatus("checking");
    const result = await testGatewayConnection();
    setConnectionStatus(result.ok ? "ok" : "fail");
    if (!result.ok) {
      console.warn("[home] Gateway 连接失败:", result.message);
    }
  }, []);

  useEffect(() => {
    refreshLearningContext();
    loadDashboard();
    checkConnection();
  }, [checkConnection, loadDashboard, refreshLearningContext]);

  useFocusEffect(
    useCallback(() => {
      refreshLearningContext();
      loadDashboard();
    }, [loadDashboard, refreshLearningContext]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refreshLearningContext(),
      loadDashboard(),
      checkConnection(),
    ]);
    setRefreshing(false);
  }, [checkConnection, loadDashboard, refreshLearningContext]);

  const handleOpenReview = useCallback(
    (item: ReviewPlanItem) => {
      router.push({
        pathname: "/chat",
        params: {
          reviewKnowledgePointId: item.knowledgePointId,
          reviewTitle: item.name,
          reviewMastery: String(item.mastery),
          reviewReason: item.reason,
          reviewMaterial: item.material,
          reviewCheckQuestion: item.checkQuestion,
          reviewIntervalDays: String(item.intervalDays),
          reviewNextReviewAt: item.nextReviewAt,
        },
      });
    },
    [router],
  );

  const profileTitle = textField(profile, ["nickname", "name", "display_name"]) || USER_ID;
  const profileBio =
    textField(profile, ["bio", "learning_goal", "goal"]) ||
    "把课堂、拍题和 AI 对话沉淀成可复习的学习节奏。";
  const weakSubjects = textField(profile, ["weak_subjects", "weakSubjects"]);
  const weekBuckets = useMemo(() => buildWeekStudyBuckets(classrooms), [classrooms]);
  const maxWeekMinutes = Math.max(30, ...weekBuckets.map((item) => item.minutes));
  const dueReviews = reviewPlan.filter((item) => item.dueToday).length;
  const avgMastery =
    reviewPlan.length > 0
      ? Math.round(
          (reviewPlan.reduce((sum, item) => sum + (item.mastery || 0), 0) /
            reviewPlan.length) *
            100,
        )
      : 0;
  const totalStudyMinutes = classrooms
    .slice(0, 12)
    .reduce((sum, classroom) => sum + estimateMinutes(classroom), 0);
  const primaryClassroom = classrooms[0];
  const eventTypeCount = Object.keys(stats?.event_types || {}).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <BackgroundImage
        source={require("../../assets/backgrounds/home_bg.png")}
        overlayColor={PEACH_OVERLAY}
      />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Hi, {profileTitle}</Text>
            <Text style={styles.greetingSub}>今天想学点什么？</Text>
          </View>
          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => router.push("/profile")}
            activeOpacity={0.85}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profileTitle.slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View
              style={[
                styles.statusDot,
                connectionStatus === "fail" && styles.statusDotFail,
                connectionStatus === "checking" && styles.statusDotChecking,
              ]}
            />
          </TouchableOpacity>
        </View>

        {connectionStatus === "fail" && (
          <TouchableOpacity style={styles.connectionBanner} onPress={checkConnection}>
            <Ionicons name="warning" size={16} color={colors.textInverse} />
            <Text style={styles.connectionText} numberOfLines={2}>
              无法连接 Gateway ({GATEWAY_URL})，点击重试。
            </Text>
          </TouchableOpacity>
        )}

        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>继续今日学习节奏</Text>
            <Text style={styles.heroSub} numberOfLines={2}>
              {profileBio}
            </Text>
            <TouchableOpacity
              style={styles.heroButton}
              onPress={() => router.push("/chat")}
              activeOpacity={0.85}
            >
              <Text style={styles.heroButtonText}>开始 AI 对话</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
          <Image
            source={require("../../assets/illustrations/home_hero.png")}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </View>

        {/* Stats grid */}
        <View style={styles.metricGrid}>
          <MetricTile
            label="今日待复习"
            value={dueReviews}
            icon="alarm-outline"
            color={colors.warning}
          />
          <MetricTile
            label="平均掌握"
            value={`${avgMastery}%`}
            icon="pulse-outline"
            color={colors.primary}
          />
          <MetricTile
            label="课堂资料"
            value={classrooms.length}
            icon="library-outline"
            color={colors.success}
          />
          <MetricTile
            label="学习事件"
            value={stats?.total_events || 0}
            icon="layers-outline"
            color={colors.lavender}
          />
        </View>

        {/* Study rhythm */}
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>学习节奏</Text>
              <Text style={styles.panelSub}>
                近 7 天约 {totalStudyMinutes} 分钟 · {eventTypeCount} 类事件
              </Text>
            </View>
            {loading && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
          <View style={styles.weekBars}>
            {weekBuckets.map((item) => (
              <View key={item.name} style={styles.weekBarItem}>
                <View style={styles.weekBarTrack}>
                  <View
                    style={[
                      styles.weekBarFill,
                      {
                        height: `${Math.max(
                          item.minutes ? 16 : 5,
                          (item.minutes / maxWeekMinutes) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.weekBarLabel}>{item.name}</Text>
              </View>
            ))}
          </View>
          {weakSubjects ? (
            <View style={styles.focusStrip}>
              <Ionicons name="compass-outline" size={16} color={colors.warning} />
              <Text style={styles.focusStripText} numberOfLines={2}>
                当前更需要关注：{weakSubjects}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Today's suggestions */}
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>今日建议</Text>
              <Text style={styles.panelSub}>优先处理掌握度较低的内容</Text>
            </View>
          </View>
          {reviewPlan.length > 0 ? (
            reviewPlan.slice(0, 3).map((item) => (
              <TouchableOpacity
                key={item.knowledgePointId}
                style={styles.reviewRow}
                onPress={() => handleOpenReview(item)}
                activeOpacity={0.84}
              >
                <View style={styles.reviewMain}>
                  <Text style={styles.reviewTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.reviewSub} numberOfLines={2}>
                    {item.reason || item.material}
                  </Text>
                  <View style={styles.masteryTrack}>
                    <View
                      style={[
                        styles.masteryFill,
                        { width: `${Math.round((item.mastery || 0) * 100)}%` },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.reviewSide}>
                  <Text style={styles.reviewPercent}>
                    {Math.round((item.mastery || 0) * 100)}%
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.textMuted}
                  />
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyInline}>
              <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
              <Text style={styles.emptyInlineText}>
                暂无待复习建议，完成课堂或拍题后会自动更新。
              </Text>
            </View>
          )}
        </View>

        {/* Classroom updates */}
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelTitle}>课堂动态</Text>
              <Text style={styles.panelSub}>继续最近生成的学习内容</Text>
            </View>
          </View>
          {primaryClassroom ? (
            <TouchableOpacity
              style={styles.classroomRow}
              onPress={() =>
                router.push({
                  pathname: "/course/[id]",
                  params: { id: primaryClassroom.id },
                })
              }
              activeOpacity={0.84}
            >
              <View style={styles.classroomIcon}>
                <Ionicons name="school-outline" size={22} color={colors.success} />
              </View>
              <View style={styles.classroomBody}>
                <Text style={styles.classroomTitle} numberOfLines={2}>
                  {primaryClassroom.title}
                </Text>
                <Text style={styles.classroomMeta}>
                  {primaryClassroom.scenes_count} 个场景 · {shortDate(primaryClassroom.created_at)}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>
          ) : (
            <View style={styles.emptyInline}>
              <Ionicons name="library-outline" size={22} color={colors.success} />
              <Text style={styles.emptyInlineText}>
                课堂列表为空，可从底部“课堂”开始创建。
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function MetricTile({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={styles.metricTile}>
      <View style={[styles.metricIcon, { backgroundColor: `${color}20` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0)" },
  scrollContent: { padding: 16, gap: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
    paddingBottom: 2,
  },
  greeting: { fontSize: 24, fontWeight: "800", color: colors.textPrimary },
  greetingSub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  avatarBtn: { position: "relative", padding: 4 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.8)",
  },
  avatarText: { color: colors.textInverse, fontSize: 16, fontWeight: "800" },
  statusDot: {
    position: "absolute",
    right: 2,
    bottom: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: "#fff",
  },
  statusDotFail: { backgroundColor: colors.error },
  statusDotChecking: { backgroundColor: colors.warning },
  connectionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.error,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectionText: { flex: 1, color: colors.textInverse, fontSize: 12, lineHeight: 17 },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 20,
    borderRadius: 28,
    backgroundColor: PURPLE,
    ...CARD_SHADOW,
  },
  heroBody: { flex: 1, minWidth: 0 },
  heroTitle: { fontSize: 19, fontWeight: "800", color: "#FFF" },
  heroSub: {
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.78)",
    marginTop: 6,
  },
  heroButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#FFF",
  },
  heroButtonText: { color: PURPLE, fontSize: 13, fontWeight: "800" },
  heroImage: { width: 110, height: 110, marginLeft: 12 },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  metricTile: {
    width: "48%",
    minHeight: 96,
    borderRadius: 22,
    padding: 14,
    backgroundColor: GLASS_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...CARD_SHADOW,
  },
  metricIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  metricValue: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: 10,
  },
  metricLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  panel: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: GLASS_BG,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    ...CARD_SHADOW,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  panelTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  panelSub: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  weekBars: {
    height: 118,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingTop: 18,
  },
  weekBarItem: { flex: 1, alignItems: "center", gap: 7 },
  weekBarTrack: {
    width: 20,
    height: 82,
    borderRadius: 10,
    justifyContent: "flex-end",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  weekBarFill: {
    width: "100%",
    borderRadius: 10,
    backgroundColor: PURPLE,
  },
  weekBarLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  focusStrip: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 12,
    padding: 10,
    backgroundColor: ORANGE_LIGHT,
  },
  focusStripText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: ORANGE,
  },
  reviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  reviewMain: { flex: 1, minWidth: 0 },
  reviewTitle: { fontSize: 15, fontWeight: "800", color: colors.textPrimary },
  reviewSub: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 4,
  },
  masteryTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 9,
    backgroundColor: colors.bgInput,
  },
  masteryFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: ORANGE,
  },
  reviewSide: {
    minWidth: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  reviewPercent: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.warning,
  },
  classroomRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  classroomIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E2F0E7",
  },
  classroomBody: { flex: 1, minWidth: 0 },
  classroomTitle: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
    color: colors.textPrimary,
  },
  classroomMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  emptyInline: {
    minHeight: 72,
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  emptyInlineText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
});
