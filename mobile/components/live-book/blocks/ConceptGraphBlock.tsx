import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../../lib/theme";
import { RenderDebugBoundary } from "../../RenderDebugBoundary";
import type { Block } from "../../../lib/types";
import { wrapMermaidHtml } from "./WebViewBlock";
import WebViewBlock from "./WebViewBlock";

interface ConceptNode {
  id: string;
  label: string;
  chapter_id?: string;
  description?: string;
  weight?: number;
}

interface ConceptEdge {
  src: string;
  dst: string;
  relation?: string;
  rationale?: string;
}

interface ConceptGraph {
  nodes: ConceptNode[];
  edges: ConceptEdge[];
}

interface ConceptGraphBlockProps {
  block: Block;
  bookId?: string;
  currentPageId?: string;
  language?: string;
  onNavigateToPage?: (pageId: string) => void;
}

interface ChapterIndexEntry {
  id: string;
  title: string;
  summary?: string;
  objectives?: string[];
  order?: number;
  content_type?: string;
  page_id?: string;
}

interface IndexPayload {
  chapters: ChapterIndexEntry[];
  node_to_chapter: Record<string, string>;
}

function asGraph(payload: unknown): ConceptGraph | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<ConceptGraph>;
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    return null;
  }
  return candidate as ConceptGraph;
}

function asIndex(payload: unknown): IndexPayload {
  if (!payload || typeof payload !== "object") {
    return { chapters: [], node_to_chapter: {} };
  }
  const candidate = payload as Partial<IndexPayload>;
  return {
    chapters: Array.isArray(candidate.chapters) ? candidate.chapters : [],
    node_to_chapter:
      candidate.node_to_chapter && typeof candidate.node_to_chapter === "object"
        ? candidate.node_to_chapter
        : {},
  };
}

const LABELS: Record<
  string,
  {
    chapterMap: (n: number, e: number) => string;
    conceptMap: (n: number, e: number) => string;
    chapterIndex: string;
    noChapters: string;
  }
> = {
  zh: {
    chapterMap: (n, e) => `章节图谱 · ${n} 章 · ${e} 条依赖`,
    conceptMap: (n, e) => `概念图 · ${n} 个概念 · ${e} 条关系`,
    chapterIndex: "章节索引",
    noChapters: "（暂无章节）",
  },
  en: {
    chapterMap: (n, e) => `Chapter map · ${n} chapters · ${e} dependencies`,
    conceptMap: (n, e) => `Concept map · ${n} concepts · ${e} relations`,
    chapterIndex: "Chapter Index",
    noChapters: "(No chapters yet)",
  },
};

function pickLabels(language?: string) {
  const code = (language || "en").toLowerCase().split("-")[0];
  return LABELS[code] ?? LABELS.en;
}

export default function ConceptGraphBlock({
  block,
  language,
  onNavigateToPage,
}: ConceptGraphBlockProps) {
  const labels = pickLabels(language);

  const code =
    (block.payload?.code as
      | { language?: string; content?: string }
      | undefined) || {};
  const mermaidSrc = String(code.content || "").trim();
  const graph = asGraph(block.payload?.graph);
  const index = asIndex(block.payload?.index);

  // Use graph data for precise counting when available
  const chapterNodes = graph?.nodes.filter((n) => n.chapter_id) ?? [];
  const isChapterMap = chapterNodes.length > 0;
  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;

  const html = useMemo(() => {
    const content = mermaidSrc || 'graph TD\n  empty["(no concepts yet)"]';
    return wrapMermaidHtml(content);
  }, [mermaidSrc]);

  const headerText = isChapterMap
    ? labels.chapterMap(chapterNodes.length, edgeCount)
    : labels.conceptMap(nodeCount, edgeCount);

  return (
    <RenderDebugBoundary
      name="ConceptGraphBlock"
      meta={{ nodeCount, edgeCount, chapterCount: index.chapters.length }}
      fallback={
        <View style={styles.container}>
          <View style={[styles.graphBox, { justifyContent: "center", alignItems: "center", height: 120 }]}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              概念图加载失败
            </Text>
          </View>
          <View style={styles.indexBox}>
            <Text style={styles.indexTitle}>{labels.chapterIndex}</Text>
            {index.chapters.length === 0 ? (
              <Text style={styles.emptyText}>{labels.noChapters}</Text>
            ) : (
              index.chapters.map((chapter, idx) => {
                const label = (
                  <View style={styles.chapterRow}>
                    <Text style={styles.chapterNum}>
                      {String(idx + 1).padStart(2, "0")}
                    </Text>
                    <Text style={styles.chapterTitle} numberOfLines={2}>
                      {chapter.title}
                    </Text>
                  </View>
                );
                if (onNavigateToPage && chapter.page_id) {
                  return (
                    <TouchableOpacity
                      key={chapter.id}
                      style={styles.chapterBtn}
                      onPress={() => onNavigateToPage(chapter.page_id || "")}
                    >
                      {label}
                    </TouchableOpacity>
                  );
                }
                return (
                  <View key={chapter.id} style={styles.chapterItem}>
                    {label}
                  </View>
                );
              })
            )}
          </View>
        </View>
      }
    >
      <View style={styles.container}>
        {/* Mermaid diagram */}
        <View style={styles.graphBox}>
          <View style={styles.graphHeader}>
            <Ionicons name="compass-outline" size={14} color={colors.textMuted} />
            <Text style={styles.graphHeaderText}>{headerText}</Text>
          </View>
          <WebViewBlock html={html} height={280} />
        </View>

        {/* Chapter index */}
        <View style={styles.indexBox}>
          <Text style={styles.indexTitle}>{labels.chapterIndex}</Text>
          {index.chapters.length === 0 ? (
            <Text style={styles.emptyText}>{labels.noChapters}</Text>
          ) : (
            index.chapters.map((chapter, idx) => {
              const label = (
                <View style={styles.chapterRow}>
                  <Text style={styles.chapterNum}>
                    {String(idx + 1).padStart(2, "0")}
                  </Text>
                  <Text style={styles.chapterTitle} numberOfLines={2}>
                    {chapter.title}
                  </Text>
                </View>
              );
              if (onNavigateToPage && chapter.page_id) {
                return (
                  <TouchableOpacity
                    key={chapter.id}
                    style={styles.chapterBtn}
                    onPress={() => onNavigateToPage(chapter.page_id || "")}
                  >
                    {label}
                  </TouchableOpacity>
                );
              }
              return (
                <View key={chapter.id} style={styles.chapterItem}>
                  {label}
                </View>
              );
            })
          )}
        </View>
      </View>
    </RenderDebugBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  graphBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    overflow: "hidden",
  },
  graphHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  graphHeaderText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  indexBox: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard + "99",
    padding: 10,
  },
  indexTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  chapterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  chapterItem: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  chapterRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  chapterNum: {
    fontSize: 10,
    fontFamily: "monospace",
    color: colors.textMuted,
  },
  chapterTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    color: colors.textPrimary,
    lineHeight: 18,
  },
});
