import React from "react";
import { Image, StyleSheet, View } from "react-native";

export function BackgroundImage({
  source,
  overlayColor,
}: {
  source: any;
  overlayColor?: string;
}) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Image
        source={source}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      {overlayColor ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: overlayColor }]} />
      ) : null}
    </View>
  );
}
