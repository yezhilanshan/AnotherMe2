import React from "react";
import { Dimensions, StyleSheet } from "react-native";

import {
  CapabilityMediaPreview,
  type CapabilityArtifact,
} from "./CapabilityMediaPreview";

interface MathAnimatorPreviewProps {
  output_mode?: string;
  artifacts?: CapabilityArtifact[];
  code?: { language: string; content: string };
}

const SCREEN_WIDTH = Dimensions.get("window").width;

export const MathAnimatorPreview = React.memo(function MathAnimatorPreview({
  artifacts,
}: MathAnimatorPreviewProps) {
  return (
    <CapabilityMediaPreview
      artifacts={artifacts}
      title="数学动画"
      icon="calculator"
      imageStyle={styles.imagePreview}
    />
  );
});

const styles = StyleSheet.create({
  imagePreview: {
    height: Math.min(SCREEN_WIDTH * 0.6, 300),
  },
});
