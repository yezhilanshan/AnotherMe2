"""
动画规划器 - 将脚本步骤转换为结构化动画计划，供代码生成器使用
"""
import re
from typing import Any, Dict, List


class AnimationPlanner:
    """把脚本步骤转换为结构化动画计划，供 codegen 使用。"""

    FORMULA_PANEL_MAX_ITEMS = 6

    def plan_step(
        self,
        step: Any,
        step_scene: Dict[str, Any],
        time_offset: float,
    ) -> Dict[str, Any]:
        
        duration = float(step.audio_duration) if step.audio_duration else float(step.duration) # 以音频时长为准，若无则用默认时长
        formula_items = self._extract_formula_items(step) # 公式区可显示公式与描述文本
        reset_formula_area = self._should_reset_formula_area(step)

        actions: List[Dict[str, Any]] = [
            {
                "type": "add_sound",
                "audio_file": step.audio_file,
                "time_offset": 0.0,
                "global_time_offset": round(time_offset, 2),
            }
        ]
        actions.extend(step_scene.get("operations", []))

        if formula_items:
            actions.append({
                "type": "show_formula",
                "items": formula_items,
                "reset_formula_area": reset_formula_area,
            })

        if step_scene.get("focus_entities"):
            actions.append({
                "type": "focus_entities",
                "targets": step_scene["focus_entities"],
            })

        actions.append({
            "type": "align_audio_duration",
            "duration": duration,
        })

        return {
            "step_id": step.id,
            "title": step.title,
            "duration": duration,
            "time_offset": 0.0,
            "global_time_offset": round(time_offset, 2),
            "focus_entities": step_scene.get("focus_entities", []),
            "formula_items": formula_items,
            "reset_formula_area": reset_formula_area,
            "actions": actions,
            "codegen_notes": self._build_codegen_notes(step, step_scene, formula_items),
        }

    def _extract_formula_items(self, step: Any) -> List[str]:
        max_items = self.FORMULA_PANEL_MAX_ITEMS

        spoken_formulas = self._extract_from_spoken_formulas(getattr(step, "spoken_formulas", []) or [])

        # 优先使用脚本侧结构化屏幕文案，并保留脚本给出的推导顺序。
        on_screen_items = getattr(step, "on_screen_texts", []) or []
        prioritized = self._extract_from_on_screen_texts(on_screen_items)
        has_structured_title = any(
            isinstance(item, dict)
            and str(item.get("target_area", "formula_area")).strip() == "formula_area"
            and str(item.get("kind", "")).strip().lower() == "title"
            for item in on_screen_items
        )

        candidates: List[str] = []
        if not has_structured_title:
            self._append_panel_item(candidates, self._build_step_heading_text(step))
        for item in prioritized:
            self._append_panel_item(candidates, item)

        for item in spoken_formulas:
            self._append_panel_item(candidates, item)

        # 兜底：兼容旧脚本，从标题/视觉/旁白中抽取公式样式文本。
        texts = [step.title, *step.visual_cues, step.narration]
        for text in texts:
            if not text:
                continue
            for match in self._extract_formula_fragments(str(text)):
                cleaned = self._normalize_formula_candidate(match)
                self._append_panel_item(candidates, cleaned)

        result = self._ensure_explanatory_copy(step, candidates)
        return result[:max_items]

    def _ensure_explanatory_copy(self, step: Any, items: List[str]) -> List[str]:
        if not items:
            return items
        has_chinese = any(re.search(r"[一-鿿]", item) for item in items)
        if has_chinese:
            return self._dedupe_formula_panel_items(items)
        hint = self._build_step_summary_text(step)
        if not hint:
            return items
        return self._dedupe_formula_panel_items([hint] + items)

    def _prioritize_formula_panel_items(self, items: List[str]) -> List[str]:
        return self._dedupe_formula_panel_items(items)

    def _dedupe_formula_panel_items(self, items: List[str]) -> List[str]:
        result: List[str] = []
        for item in items:
            self._append_panel_item(result, item)
        return result

    def _append_panel_item(self, items: List[str], text: Any) -> None:
        cleaned = self._normalize_display_text(str(text or ""))
        if not cleaned or self._is_low_information_panel_text(cleaned):
            return
        candidate_key = self._formula_panel_key(cleaned)
        if any(self._formula_panel_key(item) == candidate_key for item in items):
            return
        items.append(cleaned)

    def _formula_panel_key(self, text: str) -> str:
        return re.sub(r"\s+", "", str(text or "")).strip().lower()

    def _build_step_heading_text(self, step: Any) -> str:
        title = self._shorten_explanatory_text(
            str(getattr(step, "title", "") or ""),
            max_chars=24,
        )
        if not title:
            return ""
        step_id = getattr(step, "id", "")
        if str(step_id).strip():
            return f"第{step_id}步：{title}"
        return title

    def _build_step_summary_text(self, step: Any) -> str:
        title = self._shorten_explanatory_text(
            str(getattr(step, "title", "") or ""),
            max_chars=18,
        )
        if title:
            return f"思路：{title}"
        narration = self._shorten_explanatory_text(
            str(getattr(step, "narration", "") or ""),
            max_chars=22,
        )
        return f"要点：{narration}" if narration else ""

    def _extract_from_spoken_formulas(self, items: Any) -> List[str]:
        if not isinstance(items, list):
            return []
        result: List[str] = []
        seen = set()
        for item in items:
            if isinstance(item, dict):
                text = str(item.get("latex") or item.get("text") or "").strip()
            else:
                text = str(item).strip()
            cleaned = self._normalize_display_text(text)
            if not cleaned or cleaned in seen:
                continue
            if re.fullmatch(r"[A-Za-z]+'?\s*=\s*\d+(?:\.\d+)?", cleaned):
                continue
            seen.add(cleaned)
            result.append(cleaned)
        return result

    def _extract_from_on_screen_texts(self, items: List[Dict[str, Any]]) -> List[str]:
        result: List[str] = []
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue

            target_area = str(item.get("target_area", "formula_area")).strip() or "formula_area"
            if target_area != "formula_area":
                continue

            text = str(item.get("text", "")).strip()
            if not text:
                continue

            kind = str(item.get("kind", "description")).strip().lower() or "description"
            if kind in {"title", "conclusion"}:
                text = self._normalize_display_text(text)
                if len(text) > 32:
                    text = text[:32]
            elif kind == "description":
                text = self._shorten_explanatory_text(
                    text,
                    max_chars=34,
                )
            elif kind == "formula":
                text = self._normalize_formula_candidate(text) or self._normalize_display_text(text)
            self._append_panel_item(result, text)
        return result

    def _normalize_display_text(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text.strip(" ，。；：,."))
        if not cleaned:
            return ""
        if re.search(r"[一-鿿]", cleaned) and len(cleaned) > 40:
            return cleaned[:40]
        if len(cleaned) > 72:
            return cleaned[:72]
        return cleaned

    def _shorten_explanatory_text(self, text: str, *, max_chars: int) -> str:
        cleaned = re.sub(r"\s+", "", str(text or "").strip())
        cleaned = re.sub(r"^(步骤|第[一二三四五六七八九十\d]+步)[:：、.\s]*", "", cleaned)
        if not cleaned:
            return ""
        chunks = re.split(r"[。；;，,：:\n]", cleaned)
        for chunk in chunks:
            chunk = chunk.strip()
            if not chunk:
                continue
            if self._normalize_formula_candidate(chunk):
                continue
            return chunk[:max_chars]
        return cleaned[:max_chars]

    def _extract_formula_fragments(self, text: str) -> List[str]:
        patterns = [
            re.compile(r"[A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△°]+(?:\s*[A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△°]+)*\s*(?:=|≤|≥|<|>|⊥|∥|\\perp|\\parallel|⇒)\s*[A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△°]+(?:\s*[A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△°]+)*"),
            re.compile(r"\([A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△° ]+\)\s*=\s*[A-Za-z0-9'()\\\^_²√+\-=/×·<>∠△° ]+"),
            re.compile(r"\b\d+(?:\.\d+)?\s*[-+]\s*[A-Za-z]\b"),
            re.compile(r"\b[A-Za-z]{1,3}'?\s*=\s*\d+(?:\.\d+)?\s*cm(?:²)?\b", re.IGNORECASE),
        ]

        matches: List[str] = []
        for pattern in patterns:
            matches.extend(pattern.findall(text))
        return matches

    def _normalize_formula_candidate(self, text: str) -> str:
        cleaned = re.sub(r"\s+", " ", text.strip(" ，。；：,."))
        if not cleaned:
            return ""
        if re.search(r"[\u4e00-\u9fff]", cleaned):
            return ""
        if re.fullmatch(r"\d+(?:\.\d+)?\s*cm(?:²)?", cleaned, flags=re.IGNORECASE):
            return ""
        if len(cleaned) < 3 or len(cleaned) > 48:
            return ""
        if not any(token in cleaned for token in ["=", "+", "-", "√", "²", "×", "/", "cm", "⊥", "∥", "\\perp", "\\parallel", "∠", "⇒"]):
            return ""
        if re.fullmatch(r"[A-Za-z]+'?", cleaned):
            return ""
        if re.fullmatch(r"[A-Za-z]+'?\s*=\s*\d+(?:\.\d+)?", cleaned):
            return ""
        return cleaned

    def _is_low_information_panel_text(self, text: str) -> bool:
        compact = re.sub(r"\s+", "", str(text or "").strip(" ：:，。；;,."))
        if not compact:
            return True
        if any(token in compact for token in ["=", "⊥", "∥", "\\perp", "\\parallel", "∠", "⇒", "√", "²"]):
            return False
        return compact in {"已知", "求证", "证明", "解析", "解", "思路", "过程", "结论"}

    def _should_reset_formula_area(self, step: Any) -> bool:
        text = " ".join([step.title, step.narration, " ".join(step.visual_cues)])
        return any(keyword in text for keyword in ["接下来", "重新整理", "总结", "最终", "因此"])

    def _build_codegen_notes(
        self,
        step: Any,
        step_scene: Dict[str, Any],
        formula_items: List[str],
    ) -> List[str]:
        notes = ["优先复用已有几何对象，不要重新创建整张题图"]
        if step_scene.get("focus_entities"):
            notes.append(f"本步骤重点对象：{', '.join(step_scene['focus_entities'])}")
        if formula_items:
            notes.append("右侧文字区只显示当前步骤所需内容（可含公式与描述文字），并遵守布局器返回的位置")
        if any(op.get("type") == "transform" for op in step_scene.get("operations", [])):
            notes.append("若涉及折叠/旋转，使用同一对象做变换，不新建重复图元")
        return notes
