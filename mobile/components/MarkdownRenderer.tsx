import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
} from 'react-native';

// ============================================================
// 语法高亮（扩展版）
// ============================================================

interface Token {
  text: string;
  color: string;
}

const KEYWORDS: Record<string, string> = {
  const: '#c678dd', let: '#c678dd', var: '#c678dd', function: '#c678dd',
  return: '#c678dd', if: '#c678dd', else: '#c678dd', for: '#c678dd',
  while: '#c678dd', import: '#c678dd', from: '#c678dd', export: '#c678dd',
  default: '#c678dd', class: '#c678dd', extends: '#c678dd', new: '#c678dd',
  this: '#c678dd', super: '#c678dd', async: '#c678dd', await: '#c678dd',
  try: '#c678dd', catch: '#c678dd', throw: '#c678dd', typeof: '#c678dd',
  instanceof: '#c678dd', in: '#c678dd', of: '#c678dd', switch: '#c678dd',
  case: '#c678dd', break: '#c678dd', continue: '#c678dd', do: '#c678dd',
  yield: '#c678dd', delete: '#c678dd', void: '#c678dd', with: '#c678dd',
  finally: '#c678dd', def: '#c678dd', elif: '#c678dd', pass: '#c678dd',
  lambda: '#c678dd', global: '#c678dd', nonlocal: '#c678dd', assert: '#c678dd',
  raise: '#c678dd', as: '#c678dd', True: '#d19a66', False: '#d19a66',
  None: '#d19a66', print: '#61afef', console: '#61afef', log: '#61afef',
  len: '#61afef', range: '#61afef', type: '#61afef', int: '#61afef',
  str: '#61afef', float: '#61afef', list: '#61afef', dict: '#61afef',
  set: '#61afef', tuple: '#61afef', bool: '#61afef', map: '#61afef',
  filter: '#61afef', reduce: '#61afef', null: '#d19a66', undefined: '#d19a66',
  true: '#d19a66', false: '#d19a66', NaN: '#d19a66', Infinity: '#d19a66',
};

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const regex = /(#.*$|\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|\b[a-zA-Z_]\w*\b|[^\s\w]|[\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0];
    if (text.startsWith('#') || text.startsWith('//')) {
      tokens.push({ text, color: '#5c6370' });
    } else if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
      tokens.push({ text, color: '#98c379' });
    } else if (/^\d/.test(text)) {
      tokens.push({ text, color: '#d19a66' });
    } else if (/^[a-zA-Z_]/.test(text)) {
      tokens.push({ text, color: KEYWORDS[text] || '#abb2bf' });
    } else {
      tokens.push({ text, color: '#abb2bf' });
    }
  }
  return tokens;
}

// ============================================================
// 代码块组件
// ============================================================

const CodeBlock = React.memo(function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(code);
    } catch {
      try {
        const Clipboard = require('@react-native-clipboard/clipboard').default;
        Clipboard.setString(code);
      } catch {
        Alert.alert('复制', '请长按代码手动复制');
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');
  return (
    <View style={codeStyles.container}>
      <View style={codeStyles.header}>
        <Text style={codeStyles.langLabel}>{language || 'code'}</Text>
        <TouchableOpacity onPress={handleCopy} style={codeStyles.copyBtn}>
          <Text style={codeStyles.copyText}>{copied ? '✓ 已复制' : '复制'}</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={codeStyles.scrollArea}>
        <View style={codeStyles.codeArea}>
          {lines.map((line, i) => (
            <View key={i} style={codeStyles.lineRow}>
              <Text style={codeStyles.lineNumber}>{i + 1}</Text>
              <Text style={codeStyles.codeText}>
                {tokenizeLine(line).map((token, j) => (
                  <Text key={j} style={{ color: token.color }}>{token.text}</Text>
                ))}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
});

const codeStyles = StyleSheet.create({
  container: { backgroundColor: '#282c34', borderRadius: 8, marginVertical: 6, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#21252b', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#3e4451' },
  langLabel: { color: '#5c6370', fontSize: 12, fontFamily: 'monospace' },
  copyBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: '#3e4451' },
  copyText: { color: '#abb2bf', fontSize: 12 },
  scrollArea: { maxHeight: 300 },
  codeArea: { padding: 12 },
  lineRow: { flexDirection: 'row' },
  lineNumber: { color: '#4b5263', fontSize: 13, fontFamily: 'monospace', width: 28, textAlign: 'right', marginRight: 12 },
  codeText: { color: '#abb2bf', fontSize: 13, fontFamily: 'monospace', flexShrink: 1 },
});

// ============================================================
// 表格组件
// ============================================================

const TableBlock = React.memo(function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tableStyles.scroll}>
      <View style={tableStyles.table}>
        {/* 表头 */}
        <View style={tableStyles.row}>
          {headers.map((h, i) => (
            <View key={i} style={[tableStyles.cell, tableStyles.headerCell]}>
              <Text style={tableStyles.headerText}>{h.trim()}</Text>
            </View>
          ))}
        </View>
        {/* 数据行 */}
        {rows.map((row, ri) => (
          <View key={ri} style={[tableStyles.row, ri % 2 === 1 && tableStyles.stripedRow]}>
            {row.map((cell, ci) => (
              <View key={ci} style={tableStyles.cell}>
                <Text style={tableStyles.cellText}>{renderInline(cell.trim())}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
});

const tableStyles = StyleSheet.create({
  scroll: { marginVertical: 6 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  stripedRow: { backgroundColor: '#f8f9fa' },
  cell: { paddingHorizontal: 10, paddingVertical: 7, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: '#eee', minWidth: 80 },
  headerCell: { backgroundColor: '#f0f0f0' },
  headerText: { fontWeight: '600', fontSize: 13, color: '#333' },
  cellText: { fontSize: 13, color: '#444' },
});

// ============================================================
// 行内渲染
// ============================================================

function renderInline(text: string): React.ReactNode {
  if (!text) return null;
  const nodes: React.ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Text key={key++} style={inlineStyles.normal}>{text.slice(lastIndex, match.index)}</Text>);
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<Text key={key++} style={inlineStyles.inlineCode}>{token.slice(1, -1)}</Text>);
    } else if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<Text key={key++} style={inlineStyles.bold}>{token.slice(2, -2)}</Text>);
    } else if (token.startsWith('*') && token.endsWith('*') && token.length > 2) {
      nodes.push(<Text key={key++} style={inlineStyles.italic}>{token.slice(1, -1)}</Text>);
    } else if (token.startsWith('[')) {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        nodes.push(
          <Text key={key++} style={inlineStyles.link} onPress={() => Linking.openURL(m[2])}>
            {m[1]}
          </Text>,
        );
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Text key={key++} style={inlineStyles.normal}>{text.slice(lastIndex)}</Text>);
  }
  return nodes.length > 0 ? nodes : text;
}

const inlineStyles = StyleSheet.create({
  normal: { fontSize: 15, lineHeight: 22, color: '#333' },
  inlineCode: { backgroundColor: '#f0f0f0', color: '#e45649', fontFamily: 'monospace', fontSize: 14, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 },
  bold: { fontWeight: '700', fontSize: 15, lineHeight: 22, color: '#333' },
  italic: { fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: '#333' },
  link: { color: '#007AFF', textDecorationLine: 'underline', fontSize: 15, lineHeight: 22 },
});

// ============================================================
// Markdown 解析
// ============================================================

interface MarkdownBlock {
  type: 'heading' | 'code' | 'list' | 'ordered_list' | 'paragraph' | 'empty' | 'blockquote' | 'hr' | 'table';
  content: string;
  level?: number;
  language?: string;
  rows?: string[][];
  headers?: string[];
}

function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === '') {
      blocks.push({ type: 'empty', content: '' });
      i++;
      continue;
    }

    // 分隔线 --- / *** / ___
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // 代码块 ```
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n'), language });
      i++;
      continue;
    }

    // 表格（连续以 | 开头的行）
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) => row.split('|').slice(1, -1);
        const headers = parseRow(tableLines[0]);
        // 跳过分隔行（第二行通常是 |---|---|）
        const dataRows = tableLines.slice(2).map(parseRow);
        blocks.push({ type: 'table', content: '', headers, rows: dataRows });
      }
      continue;
    }

    // 引用块 >
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    // 标题 # ## ###
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', content: headingMatch[2], level: headingMatch[1].length });
      i++;
      continue;
    }

    // 无序列表 - / *
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (listMatch) {
      const indent = listMatch[1].length;
      blocks.push({ type: 'list', content: listMatch[2], level: Math.floor(indent / 2) });
      i++;
      continue;
    }

    // 有序列表 1. 2. etc
    const orderedMatch = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (orderedMatch) {
      const indent = orderedMatch[1].length;
      blocks.push({ type: 'ordered_list', content: orderedMatch[2], level: Math.floor(indent / 2) });
      i++;
      continue;
    }

    // 普通段落
    let paragraph = line;
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('```') && !lines[i].match(/^#{1,6}\s/) && !lines[i].match(/^\s*[-*]\s/) && !lines[i].match(/^\s*\d+\.\s/) && !lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('|') && !/^[-*_]{3,}\s*$/.test(lines[i].trim())) {
      paragraph += ' ' + lines[i];
      i++;
    }
    blocks.push({ type: 'paragraph', content: paragraph });
  }

  return blocks;
}

// ============================================================
// 主组件
// ============================================================

// 有序列表计数器
let orderedCounter = 0;

interface MarkdownRendererProps {
  content: string;
  color?: string;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, color = '#333' }: MarkdownRendererProps) {
  const blocks = React.useMemo(() => parseMarkdown(content), [content]);
  orderedCounter = 0;

  return (
    <View>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'empty':
            return <View key={index} style={{ height: 6 }} />;

          case 'hr':
            return <View key={index} style={styles.hr} />;

          case 'heading': {
            const sizes = [0, 22, 20, 18, 16, 15, 14];
            const fontSize = sizes[block.level || 3] || 16;
            return (
              <Text key={index} style={{ fontSize, fontWeight: '700', color, marginTop: 10, marginBottom: 4 }}>
                {renderInline(block.content)}
              </Text>
            );
          }

          case 'code':
            return <CodeBlock key={index} code={block.content} language={block.language} />;

          case 'table':
            return <TableBlock key={index} headers={block.headers || []} rows={block.rows || []} />;

          case 'blockquote':
            return (
              <View key={index} style={styles.blockquote}>
                <Text style={styles.blockquoteText}>
                  {renderInline(block.content)}
                </Text>
              </View>
            );

          case 'list':
            return (
              <View key={index} style={{ flexDirection: 'row', paddingLeft: (block.level || 0) * 16 + 4 }}>
                <Text style={{ color, fontSize: 15, marginRight: 6, lineHeight: 22 }}>•</Text>
                <Text style={{ color, fontSize: 15, lineHeight: 22, flex: 1 }}>
                  {renderInline(block.content)}
                </Text>
              </View>
            );

          case 'ordered_list': {
            orderedCounter++;
            return (
              <View key={index} style={{ flexDirection: 'row', paddingLeft: (block.level || 0) * 16 + 4 }}>
                <Text style={{ color, fontSize: 15, marginRight: 6, lineHeight: 22, minWidth: 20 }}>
                  {orderedCounter}.
                </Text>
                <Text style={{ color, fontSize: 15, lineHeight: 22, flex: 1 }}>
                  {renderInline(block.content)}
                </Text>
              </View>
            );
          }

          case 'paragraph':
          default:
            return (
              <Text key={index} style={{ color, fontSize: 15, lineHeight: 22, marginBottom: 4 }}>
                {renderInline(block.content)}
              </Text>
            );
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
    marginVertical: 10,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 6,
    backgroundColor: '#f8f9fa',
    borderRadius: 4,
  },
  blockquoteText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#555',
    fontStyle: 'italic',
  },
});
