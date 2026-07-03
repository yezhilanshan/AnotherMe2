import { useEffect, useState } from "react";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";

declare const require: (path: string) => number;

export interface KatexAssetText {
  katexCss: string;
  katexJs: string;
  loaded: boolean;
}

const KATEX_CSS_ASSET = require("../assets/katex/katex.embedded.min.css.txt");
const KATEX_JS_ASSET = require("../assets/katex/katex.min.js.txt");

const EMPTY_KATEX_ASSETS: KatexAssetText = {
  katexCss: "",
  katexJs: "",
  loaded: false,
};

let cachedKatexAssets: KatexAssetText | null = null;
let pendingKatexLoad: Promise<KatexAssetText> | null = null;

async function readTextAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) return "";
  return FileSystem.readAsStringAsync(uri);
}

export async function loadKatexAssets(): Promise<KatexAssetText> {
  if (cachedKatexAssets) return cachedKatexAssets;
  if (pendingKatexLoad) return pendingKatexLoad;

  pendingKatexLoad = Promise.all([
    readTextAsset(KATEX_CSS_ASSET),
    readTextAsset(KATEX_JS_ASSET),
  ])
    .then(([katexCss, katexJs]) => {
      cachedKatexAssets = {
        katexCss,
        katexJs,
        loaded: Boolean(katexCss && katexJs),
      };
      return cachedKatexAssets;
    })
    .catch(() => EMPTY_KATEX_ASSETS)
    .finally(() => {
      pendingKatexLoad = null;
    });

  return pendingKatexLoad;
}

export function useKatexAssets(): KatexAssetText {
  const [assets, setAssets] = useState<KatexAssetText>(
    cachedKatexAssets || EMPTY_KATEX_ASSETS,
  );

  useEffect(() => {
    let cancelled = false;
    loadKatexAssets().then((nextAssets) => {
      if (!cancelled) setAssets(nextAssets);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return assets;
}
