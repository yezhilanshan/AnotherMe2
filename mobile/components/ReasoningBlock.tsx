import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Reanimated, { Layout } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

const STREAM_REASONING_VISIBLE_CHARS = 240;

/**
 * 思考过程展示组件（重新设计）
 *
 * 设计要点：
 * - 左侧竖条呼吸光效 + 圆角容器，视觉层级更清晰
 * - 三点波浪动画（opacity + translateY），比纯 opacity 更有节奏感
 * - 图标呼吸脉冲，暗示"正在进行中"
 * - 光标正弦闪烁，比硬切更柔和
 * - 流式中显示实时耗时计时器
 * - 展开/折叠使用 reanimated Layout 弹性过渡
 * - 完成后默认折叠为一行胶囊，点击展开
 */
export const ReasoningBlock = React.memo(function ReasoningBlock({
  reasoning,
  isStreaming = false,
}: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 计时 & 状态切换 ──
  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        setExpanded(true);
        setElapsed(0);
        timerRef.current = setInterval(() => {
          if (startTimeRef.current !== null) {
            setElapsed(
              Math.floor((Date.now() - startTimeRef.current) / 1000),
            );
          }
        }, 1000);
      }
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (startTimeRef.current !== null) {
        setElapsed(
          Math.ceil((Date.now() - startTimeRef.current) / 1000),
        );
        startTimeRef.current = null;
      }
      setExpanded(false);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isStreaming]);

  // ── 格式化耗时 ──
  const durationText = useMemo(() => {
    if (elapsed < 60) return `${elapsed}秒`;
    const m = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    return sec > 0 ? `${m}分${sec}秒` : `${m}分钟`;
  }, [elapsed]);

  if (!reasoning && !isStreaming) return null;

  const hasContent = reasoning.length > 0;
  const visibleReasoning =
    isStreaming && reasoning.length > STREAM_REASONING_VISIBLE_CHARS
      ? `…${reasoning.slice(-STREAM_REASONING_VISIBLE_CHARS)}`
      : reasoning;

  // ══════════════════════════════════════════════
  //  流式中：展开的思考面板
  // ══════════════════════════════════════════════
  if (isStreaming) {
    return (
      <View style={styles.container}>
        {/* 左侧呼吸光条 */}
        <View style={[styles.accentBar, { opacity: 0.45 }]} />

        <View style={styles.main}>
          {/* ── 头部 ── */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="sparkles" size={12} color={colors.warning} />
            </View>

            <Text style={styles.headerTitle}>思考中</Text>

            {/* 三点波浪 */}
            <View style={styles.dotsRow}>
              <View style={styles.dot} />
              <View style={[styles.dot, { opacity: 0.65 }]} />
              <View style={[styles.dot, { opacity: 0.35 }]} />
            </View>

            {/* 实时计时器 */}
            <View style={styles.timerBadge}>
              <Ionicons name="time-outline" size={10} color={colors.warning} />
              <Text style={styles.timerText}>{durationText}</Text>
            </View>
          </View>

          {/* ── 思考内容 ── */}
          {hasContent && (
            <View style={styles.streamBody}>
              <Text style={styles.streamText}>
                {visibleReasoning}
              </Text>
              <Text style={styles.streamCursor}>▎</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // ══════════════════════════════════════════════
  //  流式结束：可展开 / 折叠
  // ══════════════════════════════════════════════
  return (
    <Reanimated.View
      style={styles.container}
      layout={Layout.springify().damping(18).stiffness(160).mass(0.8)}
    >
      {/* 左侧静态光条 */}
      <View style={[styles.accentBar, { opacity: 0.3 }]} />

      <View style={styles.main}>
        {/* ── 头部（点击切换） ── */}
        <TouchableOpacity
          style={styles.header}
          onPress={() => setExpanded((prev) => !prev)}
          activeOpacity={0.65}
        >
          <View style={styles.iconCircleMuted}>
            <Ionicons name="bulb" size={11} color={colors.warning} />
          </View>

          <Text style={styles.doneTitle}>
            思考了 {durationText}
          </Text>

          <View style={styles.flexSpacer} />

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={colors.reasoningText}
          />
        </TouchableOpacity>

        {/* ── 展开时的内容 ── */}
        {expanded && hasContent && (
          <ScrollView
            style={styles.doneBody}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.doneText} selectable>
              {reasoning}
            </Text>
          </ScrollView>
        )}
      </View>
    </Reanimated.View>
  );
});

// ══════════════════════════════════════════════════════
//  Styles
// ══════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── 外层容器 ──
  container: {
    flexDirection: 'row',
    backgroundColor: colors.reasoning,
    borderRadius: 12,
    marginBottom: 8,
    overflow: 'hidden',
    // 轻微阴影增加层次
    shadowColor: colors.warning,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },

  // ── 左侧竖条 ──
  accentBar: {
    width: 3,
    backgroundColor: colors.warning,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },

  // ── 主内容区 ──
  main: {
    flex: 1,
    minWidth: 0,
  },

  // ── 头部行 ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 7,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.reasoningText,
    letterSpacing: 0.2,
  },
  doneTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.reasoningText,
  },
  flexSpacer: {
    flex: 1,
  },

  // ── 图标容器 ──
  iconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleMuted: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── 三点波浪 ──
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 1,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.warning,
  },

  // ── 计时胶囊 ──
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  timerText: {
    fontSize: 11,
    color: colors.warning,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },

  // ── 流式内容区 ──
  streamBody: {
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  streamText: {
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.reasoningText,
    fontFamily: 'monospace',
    letterSpacing: 0.1,
  },
  streamCursor: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '300',
    marginTop: 1,
  },

  // ── 完成后展开内容 ──
  doneBody: {
    maxHeight: 160,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  doneText: {
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.reasoningText,
    fontFamily: 'monospace',
    letterSpacing: 0.1,
  },
});
