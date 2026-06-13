import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ReasoningBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

/**
 * 思考框（在消息气泡内部）
 * - 流式中：实时显示思考内容，自动滚动
 * - 结束后：折叠为一行卡片，点击展开
 */
export const ReasoningBlock = React.memo(function ReasoningBlock({
  reasoning,
  isStreaming = false,
}: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  // 跟踪耗时
  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
        setExpanded(true);
      }
    } else if (startTimeRef.current !== null) {
      setDuration(Math.ceil((Date.now() - startTimeRef.current) / 1000));
      startTimeRef.current = null;
      setExpanded(false);
    }
  }, [isStreaming]);

  // 流式时自动滚动
  useEffect(() => {
    if (isStreaming && expanded) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }, [reasoning, isStreaming, expanded]);

  // 动画点
  useEffect(() => {
    if (!isStreaming) return;
    const p = (v: Animated.Value, d: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 400, delay: d, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      );
    const a1 = p(dot1, 0);
    const a2 = p(dot2, 200);
    const a3 = p(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [isStreaming]);

  if (!reasoning && !isStreaming) return null;

  // ── 流式中：展开的思考框 ──
  if (isStreaming) {
    return (
      <View style={s.box}>
        <View style={s.boxHeader}>
          <Ionicons name="sparkles" size={13} color="#F59E0B" />
          <Text style={s.boxHeaderText}>思考中</Text>
          <View style={s.dots}>
            <Animated.View style={[s.dot, { opacity: dot1 }]} />
            <Animated.View style={[s.dot, { opacity: dot2 }]} />
            <Animated.View style={[s.dot, { opacity: dot3 }]} />
          </View>
        </View>
        <ScrollView ref={scrollRef} style={s.boxBody} nestedScrollEnabled>
          <Text style={s.boxText} selectable>{reasoning}</Text>
          <Text style={s.cursor}>▊</Text>
        </ScrollView>
      </View>
    );
  }

  // ── 流式结束：折叠卡片 或 展开框 ──
  if (expanded) {
    return (
      <View style={s.box}>
        <TouchableOpacity
          style={s.boxHeader}
          onPress={() => setExpanded(false)}
          activeOpacity={0.7}
        >
          <View style={s.boxHeaderLeft}>
            <Ionicons name="bulb-outline" size={13} color="#92400e" />
            <Text style={s.boxHeaderText}>思考了 {duration ?? 0} 秒</Text>
          </View>
          <Ionicons name="chevron-up" size={14} color="#92400e" />
        </TouchableOpacity>
        <ScrollView style={s.boxBody} nestedScrollEnabled>
          <Text style={s.boxText} selectable>{reasoning}</Text>
        </ScrollView>
      </View>
    );
  }

  // 折叠态：一行卡片
  return (
    <TouchableOpacity style={s.card} onPress={() => setExpanded(true)} activeOpacity={0.7}>
      <Ionicons name="bulb-outline" size={13} color="#92400e" />
      <Text style={s.cardText}>思考了 {duration ?? 0} 秒</Text>
      <Ionicons name="chevron-down" size={12} color="#92400e" />
    </TouchableOpacity>
  );
});

const s = StyleSheet.create({
  // ── 思考框 ──
  box: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    marginBottom: 6,
    overflow: 'hidden',
  },
  boxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#FDE68A',
    gap: 5,
  },
  boxHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  boxHeaderText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    gap: 3,
    marginLeft: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#F59E0B',
  },
  boxBody: {
    maxHeight: 120,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  boxText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#78350F',
    fontFamily: 'monospace',
  },
  cursor: {
    color: '#F59E0B',
    fontSize: 12,
    marginTop: 2,
  },

  // ── 折叠卡片 ──
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
    alignSelf: 'flex-start',
  },
  cardText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
  },
});
