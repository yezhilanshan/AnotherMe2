import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { ChatBubble } from "../components/ChatBubble";
import { RenderDebugBoundary } from "../components/RenderDebugBoundary";
import { colors } from "../lib/theme";
import type { Message } from "../lib/types";

const finalMessage: Message = {
  id: "p5-final-markdown",
  role: "assistant",
  timestamp: Date.now(),
  content: [
    "### 解题步骤",
    "",
    "> **提示：** 先把已知条件转成等式，再观察几何关系。",
    "",
    "1. 设直角三角形两条直角边分别为 $a$ 和 $b$，斜边为 $c$。",
    "2. 根据面积拼接关系，可以得到下面的恒等式：",
    "",
    "$$",
    "\\frac{\\left(a+b\\right)^2-a^2-b^2}{2}=ab,\\qquad a^2+b^2=c^2,\\qquad \\sqrt{\\frac{(x_1-x_2)^2+(y_1-y_2)^2}{\\alpha^2+\\beta^2+\\gamma^2}}",
    "$$",
    "",
    "- 公式很长时应横向滚动，不应撑破气泡。",
    "- 列表 marker 固定宽度，正文区域应自动换行。",
    "- **$\\tan B = 2$：** 这意味着 $\\sin B = \\frac{2}{\\sqrt{5}}$，$\\cos B = \\frac{1}{\\sqrt{5}}$。",
    "- **$\\angle BEB' = 90^\\circ$：** 这是确定点 $E$ 位置的关键。",
    "",
    "~~~ts",
    "const answer = Math.sqrt(a * a + b * b);",
    "console.log(answer);",
    "~~~",
    "",
    "最终答案：$c=\\sqrt{a^2+b^2}$。",
  ].join("\n"),
};

const streamingMessage: Message = {
  id: "p5-streaming",
  role: "assistant",
  timestamp: Date.now(),
  isStreaming: true,
  content:
    "正在推导：先保留纯文本流式输出，遇到 $a^2+b^2=c^2$ 也不触发 MathJax，避免边输入边重排。",
};

const userMessage: Message = {
  id: "p5-user",
  role: "user",
  timestamp: Date.now(),
  content: "这道题怎么做？请把公式讲清楚。",
};

const messages = [userMessage, streamingMessage, finalMessage];

export default function RenderCheckScreen() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View testID="p5-render-check" style={styles.frame}>
        {messages.map((message) => (
          <RenderDebugBoundary
            key={message.id}
            name="ChatBubble"
            meta={{ id: message.id, role: message.role }}
          >
            <ChatBubble message={message} />
          </RenderDebugBoundary>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  content: {
    paddingVertical: 24,
  },
  frame: {
    width: "100%",
    maxWidth: 430,
    alignSelf: "center",
  },
});
