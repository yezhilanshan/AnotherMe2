"""Post-render review between stable source scene, generated code, and frame evidence."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


class RenderVsSourceValidator:
    """Review render intent against the stable scene and basic frame evidence."""

    def __init__(
        self,
        canvas_config: Optional[Dict[str, Any]] = None,
        *,
        ffmpeg_timeout: int = 180,
    ) -> None:
        self.canvas_config = canvas_config or {}
        self.ffmpeg_timeout = int(ffmpeg_timeout)

    def validate(
        self,
        *,
        render_scene: Optional[Dict[str, Any]],
        geometry_ir: Optional[Dict[str, Any]],
        manim_code: str,
        render_topology_validation: Optional[Dict[str, Any]],
        visual_geometry_source: Optional[Dict[str, Any]],
        final_video_path: Optional[str],
        output_dir: Path,
    ) -> Dict[str, Any]:
        report: Dict[str, Any] = {
            "version": "render_vs_source_validation.v1",
            "is_valid": True,
            "failed_checks": [],
            "warnings": [],
            "checks": [],
            "source_summary": self._scene_summary(render_scene, geometry_ir),
            "code_summary": self._code_summary(manim_code),
            "artifact_review": {
                "final_video_path": str(final_video_path or ""),
                "frame_path": "",
                "frame_extracted": False,
                "frame_extract_error": "",
                "frame_size": None,
                "grayscale_extrema": None,
                "non_background_ratio": None,
                "appears_blank": None,
                "content_bbox": None,
                "content_bbox_norm": None,
                "content_center_norm": None,
                "content_bbox_area_ratio": None,
            },
            "topology": self._topology_summary(render_topology_validation),
            "visual_geometry_source_mode": str(
                (visual_geometry_source or {}).get("mode", "")
            ).strip(),
        }

        def fail(check: str, detail: str) -> None:
            report["is_valid"] = False
            report["failed_checks"].append({"check": check, "detail": detail})

        def warn(check: str, detail: str) -> None:
            report["warnings"].append({"check": check, "detail": detail})

        def ok(check: str, detail: str) -> None:
            report["checks"].append({"check": check, "detail": detail})

        source_summary = report["source_summary"]
        code_summary = report["code_summary"]
        topology_summary = report["topology"]

        if not source_summary["has_render_scene"]:
            warn("render_scene", "missing render_scene metadata; source-vs-render review is partial")
        else:
            ok(
                "render_scene",
                f"{source_summary['point_count']} points, {source_summary['segment_count']} segments",
            )

        missing_points = sorted(
            set(source_summary["point_ids"]) - set(code_summary["point_ids"])
        )
        if missing_points:
            fail("point_registry", f"generated code missing points: {missing_points}")
        else:
            ok("point_registry", "all source scene points are present in generated code")

        missing_segments = sorted(
            set(source_summary["segment_ids"]) - set(code_summary["segment_ids"])
        )
        if missing_segments:
            fail(
                "segment_registry",
                f"generated code missing visible segments: {missing_segments}",
            )
        else:
            ok("segment_registry", "all source scene segments are present in generated code")

        expected_dashed = sorted(source_summary["dashed_segment_ids"])
        actual_dashed = sorted(code_summary["dashed_segment_ids"])
        if expected_dashed != actual_dashed:
            fail(
                "dashed_segments",
                f"dashed segment mismatch: expected {expected_dashed}, got {actual_dashed}",
            )
        else:
            ok("dashed_segments", "dashed/solid segment split matches source scene")

        forbidden_pairs = topology_summary["rejected_pairs"]
        leaked_pairs = sorted(
            pair for pair in forbidden_pairs if pair in set(code_summary["segment_pairs"])
        )
        if leaked_pairs:
            fail(
                "forbidden_topology",
                f"rejected topology leaked into generated code: {leaked_pairs}",
            )
        else:
            detail = (
                "no rejected topology present in generated code"
                if forbidden_pairs
                else "no rejected topology reported"
            )
            ok("forbidden_topology", detail)

        artifact_review = report["artifact_review"]
        frame_path, frame_error = self._extract_review_frame(
            final_video_path=final_video_path,
            output_dir=output_dir,
        )
        if frame_path:
            artifact_review["frame_path"] = str(frame_path)
            artifact_review["frame_extracted"] = True
            frame_metrics = self._inspect_frame(frame_path)
            artifact_review.update(frame_metrics)
            if frame_metrics.get("appears_blank") is True:
                fail("frame_nonblank", "extracted render frame appears blank or near-blank")
            else:
                ok("frame_nonblank", "render frame contains visible geometry/text contrast")
            if frame_metrics.get("content_bbox"):
                ok("frame_content_bbox", "render frame visible content has measurable bounds")
        else:
            artifact_review["frame_extract_error"] = frame_error
            warn("frame_extract", frame_error or "frame extraction skipped")

        return report

    def _scene_summary(
        self,
        render_scene: Optional[Dict[str, Any]],
        geometry_ir: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        summary = {
            "has_render_scene": isinstance(render_scene, dict),
            "point_count": 0,
            "point_ids": [],
            "segment_count": 0,
            "segment_ids": [],
            "segment_pairs": [],
            "dashed_segment_count": 0,
            "dashed_segment_ids": [],
            "polygon_count": 0,
            "polygon_ids": [],
            "geometry_ir_version": str((geometry_ir or {}).get("version", "")).strip(),
        }
        if not isinstance(render_scene, dict):
            return summary

        point_ids = sorted(self._scene_point_ids(render_scene))
        summary["point_count"] = len(point_ids)
        summary["point_ids"] = point_ids

        segment_ids: List[str] = []
        segment_pairs: List[str] = []
        dashed_ids: List[str] = []
        polygon_ids: List[str] = []
        display = (
            render_scene.get("display") if isinstance(render_scene.get("display"), dict) else {}
        )
        primitive_display = (
            display.get("primitives") if isinstance(display.get("primitives"), dict) else {}
        )

        for primitive in render_scene.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            primitive_type = str(primitive.get("type", "")).strip().lower()
            primitive_id = str(primitive.get("id", "")).strip()
            if primitive_type == "segment":
                pair = self._pair_from_points(primitive.get("points") or [])
                if not pair:
                    continue
                segment_ids.append(primitive_id or f"seg_{pair}")
                segment_pairs.append(pair)
                if self._segment_is_dashed(primitive, primitive_display):
                    dashed_ids.append(primitive_id or f"seg_{pair}")
            elif primitive_type == "polygon":
                polygon_ids.append(primitive_id)

        summary["segment_ids"] = sorted(segment_ids)
        summary["segment_pairs"] = sorted(set(segment_pairs))
        summary["segment_count"] = len(summary["segment_ids"])
        summary["dashed_segment_ids"] = sorted(dashed_ids)
        summary["dashed_segment_count"] = len(dashed_ids)
        summary["polygon_ids"] = sorted([item for item in polygon_ids if item])
        summary["polygon_count"] = len(summary["polygon_ids"])
        return summary

    def _scene_point_ids(self, render_scene: Dict[str, Any]) -> Iterable[str]:
        points = render_scene.get("points")
        if isinstance(points, dict):
            for key in points:
                point_id = self._normalize_token(key)
                if point_id:
                    yield point_id
            return
        if isinstance(points, list):
            for item in points:
                if not isinstance(item, dict):
                    continue
                point_id = self._normalize_token(item.get("id") or item.get("label"))
                if point_id:
                    yield point_id

    def _segment_is_dashed(
        self,
        primitive: Dict[str, Any],
        primitive_display: Dict[str, Any],
    ) -> bool:
        primitive_id = str(primitive.get("id", "")).strip()
        display_payload = (
            primitive_display.get(primitive_id)
            if primitive_id and isinstance(primitive_display.get(primitive_id), dict)
            else {}
        )
        style = str(display_payload.get("style") or primitive.get("style") or "").strip().lower()
        role = str(display_payload.get("role") or primitive.get("role") or "").strip().lower()
        dashed_flag = display_payload.get("dashed", primitive.get("dashed"))
        return style == "dashed" or role == "construction" or dashed_flag is True

    def _code_summary(self, manim_code: str) -> Dict[str, Any]:
        code = str(manim_code or "")
        point_ids = {
            self._normalize_token(item)
            for item in self._findall_escaped(r"points\['((?:\\'|[^'])+)'\]\s*=", code)
        }
        line_defs = list(
            self._iter_line_definitions(
                self._findall_escaped(
                    r"lines\['((?:\\'|[^'])+)'\]\s*=\s*.*?(DashedLine|Line)\(",
                    code,
                    with_ctor=True,
                )
            )
        )
        segment_ids = sorted({item["id"] for item in line_defs if item["id"]})
        dashed_ids = sorted(
            {item["id"] for item in line_defs if item["constructor"] == "DashedLine"}
        )
        segment_pairs = sorted(
            {
                pair
                for item in line_defs
                for pair in [self._pair_from_segment_id(item["id"])]
                if pair
            }
        )
        return {
            "point_ids": sorted(point_ids - {""}),
            "point_count": len(point_ids - {""}),
            "segment_ids": segment_ids,
            "segment_count": len(segment_ids),
            "dashed_segment_ids": dashed_ids,
            "dashed_segment_count": len(dashed_ids),
            "segment_pairs": segment_pairs,
        }

    def _iter_line_definitions(
        self,
        matches: Iterable[Tuple[str, str]],
    ) -> Iterable[Dict[str, str]]:
        for raw_id, constructor in matches:
            line_id = self._normalize_token(raw_id)
            if line_id:
                yield {"id": line_id, "constructor": constructor}

    def _topology_summary(
        self,
        render_topology_validation: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        report = render_topology_validation if isinstance(render_topology_validation, dict) else {}
        rejected = report.get("rejected") if isinstance(report.get("rejected"), list) else []
        pairs: List[str] = []
        for item in rejected:
            if not isinstance(item, dict):
                continue
            pair = self._normalize_token(item.get("pair"))
            if pair:
                pairs.append(pair)
                continue
            points = item.get("points")
            if isinstance(points, list):
                pair = self._pair_from_points(points)
                if pair:
                    pairs.append(pair)
        return {
            "skipped": bool(report.get("skipped")),
            "rejected_count": int(report.get("rejected_count", len(rejected)) or 0),
            "rejected_pairs": sorted(set(pairs)),
            "rejected": rejected,
        }

    def _extract_review_frame(
        self,
        *,
        final_video_path: Optional[str],
        output_dir: Path,
    ) -> Tuple[Optional[Path], str]:
        video_path = Path(str(final_video_path or "")).expanduser()
        if not final_video_path:
            return None, "missing final video path"
        if not video_path.exists():
            return None, f"final video path does not exist: {video_path}"
        if video_path.suffix.lower() not in {".mp4", ".mov", ".mkv", ".avi"}:
            return None, f"final artifact is not a video file: {video_path.name}"

        debug_dir = output_dir / "debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        frame_path = debug_dir / "render_review_frame.png"
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-ss",
                "0.5",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(frame_path),
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.ffmpeg_timeout,
            )
            if result.returncode != 0 or (not frame_path.exists()):
                message = result.stderr or result.stdout or "ffmpeg frame extraction failed"
                return None, message.strip()
            return frame_path, ""
        except subprocess.TimeoutExpired:
            return None, "ffmpeg frame extraction timed out"
        except FileNotFoundError:
            return None, "ffmpeg not available for frame extraction"
        except Exception as exc:  # pragma: no cover
            return None, str(exc)

    def _inspect_frame(self, frame_path: Path) -> Dict[str, Any]:
        try:
            from PIL import Image
        except Exception as exc:  # pragma: no cover
            return {
                "frame_size": None,
                "grayscale_extrema": None,
                "non_background_ratio": None,
                "appears_blank": None,
                "frame_inspect_error": f"Pillow unavailable: {exc}",
            }

        with Image.open(frame_path) as image:
            gray = image.convert("L")
            width, height = gray.size
            histogram = gray.histogram()
            total = max(sum(histogram), 1)
            extrema = gray.getextrema()
            non_background = sum(histogram[:248])
            non_background_ratio = round(non_background / total, 6)
            appears_blank = bool((extrema[1] - extrema[0]) < 6 or non_background_ratio < 0.001)
            bbox = gray.point(lambda value: 255 if value < 248 else 0).getbbox()
            content_bbox = None
            content_bbox_norm = None
            content_center_norm = None
            content_bbox_area_ratio = None
            if bbox is not None:
                left, top, right, bottom = bbox
                inclusive_right = max(left, right - 1)
                inclusive_bottom = max(top, bottom - 1)
                content_bbox = [
                    int(left),
                    int(top),
                    int(inclusive_right),
                    int(inclusive_bottom),
                ]
                content_bbox_norm = [
                    round(left / max(width, 1), 6),
                    round(top / max(height, 1), 6),
                    round(inclusive_right / max(width, 1), 6),
                    round(inclusive_bottom / max(height, 1), 6),
                ]
                content_center_norm = [
                    round((left + inclusive_right) / (2 * max(width, 1)), 6),
                    round((top + inclusive_bottom) / (2 * max(height, 1)), 6),
                ]
                bbox_area = max(right - left, 1) * max(bottom - top, 1)
                content_bbox_area_ratio = round(bbox_area / max(width * height, 1), 6)
            return {
                "frame_size": [int(width), int(height)],
                "grayscale_extrema": [int(extrema[0]), int(extrema[1])],
                "non_background_ratio": non_background_ratio,
                "appears_blank": appears_blank,
                "content_bbox": content_bbox,
                "content_bbox_norm": content_bbox_norm,
                "content_center_norm": content_center_norm,
                "content_bbox_area_ratio": content_bbox_area_ratio,
            }

    def _findall_escaped(
        self,
        pattern: str,
        text: str,
        *,
        with_ctor: bool = False,
    ) -> List[Any]:
        matches = re.findall(pattern, text, flags=re.DOTALL)
        if with_ctor:
            return [(self._unescape(item[0]), str(item[1])) for item in matches]
        return [self._unescape(item) for item in matches]

    def _pair_from_points(self, raw_points: Sequence[Any]) -> str:
        points = [self._normalize_point(item) for item in raw_points]
        points = [item for item in points if item]
        if len(points) != 2 or points[0] == points[1]:
            return ""
        return "".join(sorted(points))

    def _pair_from_segment_id(self, raw_id: str) -> str:
        token = self._normalize_token(raw_id)
        if token.startswith("seg_"):
            token = token[4:]
        points = re.findall(r"[A-Za-z]\d*(?:\\'|')?", token)
        normalized = [self._normalize_point(item) for item in points[:2]]
        normalized = [item for item in normalized if item]
        if len(normalized) != 2 or normalized[0] == normalized[1]:
            return ""
        return "".join(sorted(normalized))

    def _normalize_point(self, raw: Any) -> str:
        token = self._normalize_token(raw)
        if re.fullmatch(r"[A-Za-z]\d*'?", token):
            return token.upper()
        return ""

    def _normalize_token(self, raw: Any) -> str:
        token = str(raw or "").strip().replace("′", "'").replace("`", "'")
        token = token.replace("\\'", "'")
        token = re.sub(r"\s+", "", token)
        return token

    def _unescape(self, value: str) -> str:
        return str(value).replace("\\'", "'").replace("\\\\", "\\")
