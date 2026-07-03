import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../lib/theme";
import type { Block } from "../../lib/types";
import { MarkdownRenderer } from "../MarkdownRenderer";

import TextBlock from "./blocks/TextBlock";
import CalloutBlock from "./blocks/CalloutBlock";
import SectionBlock from "./blocks/SectionBlock";
import TimelineBlock from "./blocks/TimelineBlock";
import FlashCardsBlock from "./blocks/FlashCardsBlock";
import UserNoteBlock from "./blocks/UserNoteBlock";
import CodeBlock from "./blocks/CodeBlock";
import QuizBlock from "./blocks/QuizBlock";
import type { QuizAttemptArgs } from "./blocks/QuizBlock";
import FigureBlock from "./blocks/FigureBlock";
import InteractiveBlock from "./blocks/InteractiveBlock";
import AnimationBlock from "./blocks/AnimationBlock";
import DeepDiveBlock from "./blocks/DeepDiveBlock";
import ConceptGraphBlock from "./blocks/ConceptGraphBlock";
import {
  HeavyBlockShell,
  type HeavyBlockBudget,
} from "./blocks/HeavyBlockShell";

export interface BlockRendererProps {
  block: Block;
  bookId?: string;
  currentPageId?: string;
  bookLanguage?: string;
  onQuizAttempt?: (block: Block, args: QuizAttemptArgs) => void;
  onDeepDive?: (topic: string, blockId: string) => Promise<void> | void;
  onNavigateToPage?: (pageId: string) => void;
  onRegenerate?: (block: Block) => void;
  onDelete?: (block: Block) => void;
  onMove?: (block: Block, direction: "up" | "down") => void;
  onChangeType?: (block: Block, newType: string) => void;
  heavyBlockBudget?: HeavyBlockBudget;
}

/**
 * Unified block renderer for mobile live-book.
 * Dispatches to the appropriate block component based on block.type.
 */
export default function BlockRenderer({
  block,
  bookId,
  currentPageId,
  bookLanguage,
  onQuizAttempt,
  onDeepDive,
  onNavigateToPage,
  onRegenerate,
  onDelete,
  onMove,
  onChangeType,
  heavyBlockBudget,
}: BlockRendererProps) {
  // Hooks must run before any status-based early return. Some live-book blocks
  // transition from pending/error to ready in-place, and skipping hooks during
  // those states changes the hook order for the same component instance.
  const [showActions, setShowActions] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);

  // ── Status checks ──
  if (block.status === "pending" || block.status === "generating") {
    return (
      <View style={statusStyles.placeholder}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={statusStyles.placeholderText}>
          正在生成 {block.title || block.type}...
        </Text>
      </View>
    );
  }

  if (block.status === "error") {
    return (
      <View style={statusStyles.error}>
        <Ionicons name="warning-outline" size={18} color={colors.error} />
        <View style={{ flex: 1 }}>
          <Text style={statusStyles.errorTitle}>{block.type} block failed</Text>
          <Text style={statusStyles.errorText}>
            {block.error || "Unknown error"}
          </Text>
          {onRegenerate && (
            <TouchableOpacity
              style={statusStyles.retryBtn}
              onPress={() => onRegenerate(block)}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={14} color={colors.error} />
              <Text style={statusStyles.retryText}>Retry</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── Edit actions state ──
  const hasActions = !!onRegenerate || !!onDelete || !!onMove || !!onChangeType;

  const CHANGEABLE_TYPES = [
    "text", "section", "callout", "quiz", "code",
    "timeline", "flash_cards", "figure", "interactive",
    "animation", "deep_dive",
  ];

  // ── Bridge text ──
  const bridgeText = String(
    (block.payload as Record<string, unknown> | undefined)?.bridge_text ?? block.bridge_text ?? "",
  ).trim();
  const withBridge = (node: React.ReactNode) => (
    <View key={block.id}>
      {bridgeText ? (
        <Text style={statusStyles.bridgeText}>{bridgeText}</Text>
      ) : null}
      {hasActions && (
        <View style={statusStyles.actionBar}>
          {onMove && (
            <>
              <TouchableOpacity
                style={statusStyles.actionBtn}
                onPress={() => onMove(block, "up")}
                activeOpacity={0.6}
              >
                <Ionicons name="chevron-up" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={statusStyles.actionBtn}
                onPress={() => onMove(block, "down")}
                activeOpacity={0.6}
              >
                <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </>
          )}
          {onChangeType && (
            <TouchableOpacity
              style={statusStyles.actionBtn}
              onPress={() => setShowTypeMenu((v) => !v)}
              activeOpacity={0.6}
            >
              <Ionicons name="swap-horizontal" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {onRegenerate && (
            <TouchableOpacity
              style={statusStyles.actionBtn}
              onPress={() => onRegenerate(block)}
              activeOpacity={0.6}
            >
              <Ionicons name="refresh" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {onDelete && (
            <TouchableOpacity
              style={statusStyles.actionBtn}
              onPress={() => onDelete(block)}
              activeOpacity={0.6}
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
      )}
      {showTypeMenu && onChangeType && (
        <ScrollView
          style={statusStyles.typeMenu}
          nestedScrollEnabled
        >
          {CHANGEABLE_TYPES.filter((t) => t !== block.type).map((t) => (
            <TouchableOpacity
              key={t}
              style={statusStyles.typeMenuItem}
              onPress={() => {
                setShowTypeMenu(false);
                onChangeType(block, t);
              }}
              activeOpacity={0.6}
            >
              <Text style={statusStyles.typeMenuText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {node}
    </View>
  );

  // ── Dispatch ──
  switch (block.type) {
    case "text":
      return withBridge(<TextBlock block={block} />);

    case "section":
      return withBridge(<SectionBlock block={block} />);

    case "callout":
      return withBridge(<CalloutBlock block={block} />);

    case "code":
      return withBridge(<CodeBlock block={block} />);

    case "timeline":
      return withBridge(<TimelineBlock block={block} />);

    case "flash_cards":
      return withBridge(<FlashCardsBlock block={block} />);

    case "user_note":
      return withBridge(<UserNoteBlock block={block} />);

    case "quiz":
      return withBridge(
        <QuizBlock
          block={block}
          onAttempt={onQuizAttempt}
        />,
      );

    case "figure":
      return withBridge(
        <HeavyBlockShell
          title={block.title || "图表 / 图形"}
          icon="image-outline"
          budget={heavyBlockBudget}
        >
          <FigureBlock block={block} />
        </HeavyBlockShell>,
      );

    case "interactive":
      return withBridge(
        <HeavyBlockShell
          title={block.title || "交互组件"}
          icon="hand-left-outline"
          budget={heavyBlockBudget}
        >
          <InteractiveBlock block={block} />
        </HeavyBlockShell>,
      );

    case "animation":
      return withBridge(
        <HeavyBlockShell
          title={block.title || "动画演示"}
          icon="play-circle-outline"
          budget={heavyBlockBudget}
        >
          <AnimationBlock block={block} />
        </HeavyBlockShell>,
      );

    case "deep_dive":
      return withBridge(
        <HeavyBlockShell
          title={block.title || "深度拓展"}
          icon="layers-outline"
          budget={heavyBlockBudget}
        >
          <DeepDiveBlock
            block={block}
            onDeepDive={onDeepDive}
            onNavigateToPage={onNavigateToPage}
          />
        </HeavyBlockShell>,
      );

    case "concept_graph":
      return withBridge(
        <HeavyBlockShell
          title={block.title || "概念图"}
          icon="compass-outline"
          budget={heavyBlockBudget}
        >
          <ConceptGraphBlock
            block={block}
            bookId={bookId}
            currentPageId={currentPageId}
            language={bookLanguage}
            onNavigateToPage={onNavigateToPage}
          />
        </HeavyBlockShell>,
      );

    default:
      return withBridge(
        <View style={statusStyles.placeholder}>
          <Ionicons
            name="document-outline"
            size={16}
            color={colors.textMuted}
          />
          <View style={statusStyles.placeholderBody}>
            {block.content ? (
              <MarkdownRenderer
                content={block.content}
                color={colors.textSecondary}
              />
            ) : (
              <Text style={statusStyles.placeholderText}>
                [{block.type}] block
              </Text>
            )}
          </View>
        </View>,
      );
  }
}

const statusStyles = StyleSheet.create({
  placeholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 12,
    backgroundColor: colors.bgInput,
    borderRadius: 8,
    marginBottom: 12,
  },
  placeholderText: {
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
  },
  placeholderBody: {
    flex: 1,
    minWidth: 0,
  },
  error: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.errorLight,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 14,
    color: colors.error,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
    marginTop: 2,
    lineHeight: 18,
  },
  bridgeText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
    marginBottom: 10,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.error + "60",
    backgroundColor: colors.errorLight + "40",
    alignSelf: "flex-start",
  },
  retryText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.error,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
    alignSelf: "flex-end",
  },
  actionBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: colors.bgInput,
  },
  typeMenu: {
    maxHeight: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    marginBottom: 8,
  },
  typeMenuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  typeMenuText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
});
