import React from "react";
import { Text, View } from "react-native";

import { debugError } from "../lib/debug";
import { colors } from "../lib/theme";

type Props = {
  name: string;
  meta?: Record<string, unknown>;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

type State = { failed: boolean };

export class RenderDebugBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    debugError("render", "boundary_caught", {
      name: this.props.name,
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      meta: this.props.meta,
    });
  }

  componentDidUpdate(prevProps: Props) {
    // 当包裹的内容（按 id 区分）变化时，尝试重新渲染，避免一次错误永远空白
    if (
      this.state.failed &&
      prevProps.meta?.id !== this.props.meta?.id
    ) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <View>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            这段内容渲染失败，已跳过。
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}
