import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../../lib/theme';
import type { Block } from '../../../lib/types';

// ── Syntax highlighting (same tokenizer as MarkdownRenderer) ──
const KEYWORDS: Record<string, string> = {
  const: '#c678dd', let: '#c678dd', var: '#c678dd',
  function: '#c678dd', return: '#c678dd', if: '#c678dd',
  else: '#c678dd', for: '#c678dd', while: '#c678dd',
  import: '#c678dd', from: '#c678dd', export: '#c678dd',
  default: '#c678dd', class: '#c678dd', extends: '#c678dd',
  new: '#c678dd', this: '#c678dd', super: '#c678dd',
  async: '#c678dd', await: '#c678dd', try: '#c678dd',
  catch: '#c678dd', throw: '#c678dd', typeof: '#c678dd',
  instanceof: '#c678dd', in: '#c678dd', of: '#c678dd',
  switch: '#c678dd', case: '#c678dd', break: '#c678dd',
  continue: '#c678dd', do: '#c678dd', yield: '#c678dd',
  delete: '#c678dd', void: '#c678dd', with: '#c678dd',
  finally: '#c678dd', def: '#c678dd', elif: '#c678dd',
  pass: '#c678dd', lambda: '#c678dd', global: '#c678dd',
  nonlocal: '#c678dd', assert: '#c678dd', raise: '#c678dd',
  as: '#c678dd',
  True: '#d19a66', False: '#d19a66', None: '#d19a66',
  print: '#61afef', console: '#61afef', log: '#61afef',
  len: '#61afef', range: '#61afef', type: '#61afef',
  int: '#61afef', str: '#61afef', float: '#61afef',
  list: '#61afef', dict: '#61afef', set: '#61afef',
  tuple: '#61afef', bool: '#61afef', map: '#61afef',
  filter: '#61afef', reduce: '#61afef',
  null: '#d19a66', undefined: '#d19a66',
  true: '#d19a66', false: '#d19a66',
  NaN: '#d19a66', Infinity: '#d19a66',
};

interface Token {
  text: string;
  color: string;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const regex =
    /(#.*$|\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|\b[a-zA-Z_]\w*\b|[^\s\w]|[\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0];
    if (text.startsWith('#') || text.startsWith('//')) {
      tokens.push({ text, color: '#5c6370' });
    } else if (
      text.startsWith('"') ||
      text.startsWith("'") ||
      text.startsWith('`')
    ) {
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

export interface CodeBlockProps {
  block: Block;
}

export default function CodeBlock({ block }: CodeBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const language =
    typeof payload.language === 'string' ? payload.language : 'python';
  const code = typeof payload.code === 'string' ? payload.code : '';
  const explanation =
    typeof payload.explanation === 'string' ? payload.explanation : '';
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const Clipboard = require('expo-clipboard');
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  };

  const lines = code.split('\n');

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.langLabel}>{language}</Text>
        <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
          <Ionicons
            name={copied ? 'checkmark-circle' : 'copy-outline'}
            size={14}
            color={copied ? colors.success : '#abb2bf'}
          />
        </TouchableOpacity>
      </View>

      {/* Code */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.codeScroll}
      >
        <View style={styles.codeArea}>
          {lines.map((line, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.lineNumber}>{i + 1}</Text>
              <Text style={styles.codeText}>
                {tokenizeLine(line).map((token, j) => (
                  <Text key={j} style={{ color: token.color }}>
                    {token.text}
                  </Text>
                ))}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Explanation */}
      {explanation ? (
        <Text style={styles.explanation}>{explanation}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#282c34',
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#21252b',
  },
  langLabel: {
    color: '#5c6370',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  copyBtn: {
    padding: 4,
  },
  codeScroll: {
    maxHeight: 300,
  },
  codeArea: {
    padding: 12,
  },
  lineRow: {
    flexDirection: 'row',
  },
  lineNumber: {
    color: '#4b5263',
    fontSize: 13,
    fontFamily: 'monospace',
    width: 28,
    textAlign: 'right',
    marginRight: 12,
  },
  codeText: {
    color: '#abb2bf',
    fontSize: 13,
    fontFamily: 'monospace',
    flexShrink: 1,
  },
  explanation: {
    fontSize: 12,
    color: '#8B949E',
    paddingHorizontal: 12,
    paddingBottom: 10,
    lineHeight: 18,
  },
});
