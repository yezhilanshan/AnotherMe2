"""Interactive HTML renderer for problem geometry scenes.

This renderer intentionally does not depend on Manim or Matplotlib GUI state.
It packages the solved geometry scene and script steps into a self-contained
HTML/SVG widget that can be opened directly by the mobile WebView.
"""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from ..foundation.base_agent import BaseAgent
from ..foundation.state import ScriptStep, VideoProject
from ..perception.layout_contract import resolve_layout_scene

try:
    from output_paths import DEFAULT_OUTPUT_DIR
except ModuleNotFoundError:
    from anotherme2_engine.output_paths import DEFAULT_OUTPUT_DIR


class InteractiveAgent(BaseAgent):
    """Build a PlotKityCat-like interactive scene package and HTML file."""

    def __init__(self, config: Dict[str, Any], llm: Optional[Any] = None):
        super().__init__(config, llm)
        self.output_dir = Path(config.get("output_dir", str(DEFAULT_OUTPUT_DIR)))

    def process(self, state: Dict[str, Any]) -> Dict[str, Any]:
        project: VideoProject = state["project"]
        if getattr(project, "status", "") == "failed":
            return state

        metadata = state.setdefault("metadata", {})
        script_steps: List[ScriptStep] = getattr(project, "script_steps", []) or []

        if not str(getattr(project, "problem_text", "") or "").strip() and not script_steps:
            return self._fail(state, "缺少题目文本或脚本步骤，无法生成交互可视化。")

        scene_package = self._build_scene_package(project, metadata, script_steps)
        interactive_dir = self.output_dir / "interactive"
        interactive_dir.mkdir(parents=True, exist_ok=True)

        package_path = interactive_dir / "scene_package.json"
        html_path = interactive_dir / "interactive.html"

        package_path.write_text(
            json.dumps(scene_package, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        html_path.write_text(self._build_html(scene_package), encoding="utf-8")

        project.scene_package_path = str(package_path)
        project.interactive_html_path = str(html_path)
        project.status = "completed"
        state["project"] = project
        state["current_step"] = "interactive_completed"
        state["messages"].append(
            {
                "role": "assistant",
                "content": f"交互可视化生成完成：{html_path}",
            }
        )
        metadata["interactive_scene_package_path"] = str(package_path)
        metadata["interactive_html_path"] = str(html_path)
        return state

    def _build_scene_package(
        self,
        project: VideoProject,
        metadata: Dict[str, Any],
        script_steps: List[ScriptStep],
    ) -> Dict[str, Any]:
        scene_selection = resolve_layout_scene(metadata, allow_semantic_fallback=True)
        source_name = scene_selection["selected_scene_source"]
        source_scene = scene_selection["selected_scene"]
        normalized_scene = self._normalize_scene(source_scene)
        return {
            "version": "interactive-scene-v1",
            "renderer": "anotherme-frontend-geometry",
            "problem_text": str(getattr(project, "problem_text", "") or ""),
            "scene_source": source_name,
            "scene": normalized_scene,
            "steps": [self._step_payload(step) for step in script_steps],
            "metadata": {
                "problem_constraints": copy.deepcopy(
                    metadata.get("problem_constraints")
                    if isinstance(metadata.get("problem_constraints"), dict)
                    else {}
                ),
                "problem_pattern": copy.deepcopy(
                    metadata.get("problem_pattern")
                    if isinstance(metadata.get("problem_pattern"), dict)
                    else {}
                ),
                "coordinate_scene_validation": copy.deepcopy(
                    metadata.get("coordinate_scene_validation")
                    if isinstance(metadata.get("coordinate_scene_validation"), dict)
                    else {}
                ),
                "layout_selection": copy.deepcopy(
                    metadata.get("layout_selection")
                    if isinstance(metadata.get("layout_selection"), dict)
                    else {}
                ),
            },
        }

    def _has_geometry(self, scene: Dict[str, Any]) -> bool:
        points = scene.get("points")
        if isinstance(points, dict) and points:
            return True
        if isinstance(points, list) and points:
            return True
        primitives = scene.get("primitives")
        if isinstance(primitives, list) and primitives:
            return True
        return False

    def _normalize_scene(self, scene: Dict[str, Any]) -> Dict[str, Any]:
        points = self._normalize_points(scene.get("points"))
        primitives = self._normalize_primitives(scene, points)
        step_actions = self._normalize_step_actions(scene, points)
        bbox = self._compute_bbox(points.values())
        return {
            "mode": str(scene.get("mode") or "2d"),
            "layout_mode": str(scene.get("layout_mode") or scene.get("source") or "interactive"),
            "points": list(points.values()),
            "primitives": primitives,
            "step_actions": step_actions,
            "display": copy.deepcopy(scene.get("display") if isinstance(scene.get("display"), dict) else {}),
            "bbox": bbox,
        }

    def _normalize_points(self, raw_points: Any) -> Dict[str, Dict[str, Any]]:
        points: Dict[str, Dict[str, Any]] = {}
        if isinstance(raw_points, dict):
            iterator = raw_points.items()
        elif isinstance(raw_points, list):
            iterator = ((item.get("id") if isinstance(item, dict) else None, item) for item in raw_points)
        else:
            iterator = []

        for key, value in iterator:
            if not isinstance(value, dict):
                continue
            point_id = str(value.get("id") or key or "").strip()
            if not point_id:
                continue
            coord = (
                self._coerce_xy(value.get("coord"))
                or self._coerce_xy(value.get("pos"))
                or self._coerce_xy(value.get("xy"))
                or self._coerce_xy(value.get("point"))
            )
            if coord is None:
                x = value.get("x")
                y = value.get("y")
                coord = self._coerce_xy([x, y])
            if coord is None:
                continue
            points[point_id] = {
                "id": point_id,
                "label": str(value.get("label") or point_id),
                "coord": [coord[0], coord[1]],
                "draggable": bool(value.get("draggable", True)),
                "role": str(value.get("role") or value.get("type") or "point"),
            }
        return points

    def _normalize_primitives(
        self,
        scene: Dict[str, Any],
        points: Dict[str, Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        primitives: List[Dict[str, Any]] = []
        for primitive in scene.get("primitives") or []:
            if not isinstance(primitive, dict):
                continue
            item = self._primitive_payload(primitive, points)
            if item:
                primitives.append(item)

        for line in scene.get("lines") or []:
            if not isinstance(line, dict):
                continue
            refs = (
                self._point_refs(line.get("points"))
                or self._point_refs(line.get("through"))
                or self._point_refs([line.get("p1"), line.get("p2")])
            )
            if len(refs) >= 2:
                primitives.append(
                    {
                        "id": str(line.get("id") or "".join(refs[:2])),
                        "type": "segment",
                        "points": refs[:2],
                        "style": {"stroke": "#64748b", "dash": line.get("dash")},
                    }
                )

        return self._dedupe_primitives(primitives)

    def _primitive_payload(
        self,
        primitive: Dict[str, Any],
        points: Dict[str, Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        kind = str(
            primitive.get("type")
            or primitive.get("kind")
            or primitive.get("shape")
            or ""
        ).lower()
        refs = (
            self._point_refs(primitive.get("points"))
            or self._point_refs(primitive.get("vertices"))
            or self._point_refs(primitive.get("through"))
            or self._point_refs([primitive.get("start"), primitive.get("end")])
            or self._point_refs([primitive.get("p1"), primitive.get("p2")])
        )

        if kind in {"segment", "line", "edge", "ray"} and len(refs) >= 2:
            return {
                "id": str(primitive.get("id") or "".join(refs[:2])),
                "type": "segment" if kind != "ray" else "ray",
                "points": refs[:2],
                "style": self._style_payload(primitive),
            }
        if kind in {"polygon", "triangle", "quadrilateral", "face"} and len(refs) >= 3:
            return {
                "id": str(primitive.get("id") or "".join(refs)),
                "type": "polygon",
                "points": refs,
                "style": self._style_payload(primitive, fill="#d8f3dc"),
            }
        if kind == "circle":
            center = str(primitive.get("center") or (refs[0] if refs else "")).strip()
            radius = primitive.get("radius")
            through = str(primitive.get("through") or "").strip()
            if center and (self._finite_number(radius) or through):
                return {
                    "id": str(primitive.get("id") or f"circle_{center}"),
                    "type": "circle",
                    "center": center,
                    "radius": float(radius) if self._finite_number(radius) else None,
                    "through": through or None,
                    "style": self._style_payload(primitive, stroke="#5b8def"),
                }
        if len(refs) >= 2:
            return {
                "id": str(primitive.get("id") or "".join(refs[:2])),
                "type": "segment",
                "points": refs[:2],
                "style": self._style_payload(primitive),
            }
        return None

    def _normalize_step_actions(
        self, scene: Dict[str, Any], points: Dict[str, Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        actions: List[Dict[str, Any]] = []
        for bucket in ("actions", "step_actions", "construction_actions"):
            for action in scene.get(bucket) or []:
                if not isinstance(action, dict):
                    continue
                payload = copy.deepcopy(action)
                refs = self._point_refs(
                    payload.get("points")
                    or payload.get("segment")
                    or [payload.get("start"), payload.get("end")]
                )
                if refs:
                    payload["points"] = refs
                actions.append(payload)
        return actions

    def _point_refs(self, value: Any) -> List[str]:
        if value is None:
            return []
        if isinstance(value, str):
            if "," in value:
                return [part.strip() for part in value.split(",") if part.strip()]
            return [value.strip()] if value.strip() else []
        if isinstance(value, (list, tuple)):
            refs = []
            for item in value:
                if isinstance(item, dict):
                    ref = str(item.get("id") or item.get("point") or "").strip()
                else:
                    ref = str(item or "").strip()
                if ref:
                    refs.append(ref)
            return refs
        return []

    def _style_payload(
        self,
        source: Dict[str, Any],
        *,
        stroke: str = "#334155",
        fill: str = "none",
    ) -> Dict[str, Any]:
        style = source.get("style") if isinstance(source.get("style"), dict) else {}
        return {
            "stroke": str(source.get("stroke") or style.get("stroke") or stroke),
            "fill": str(source.get("fill") or style.get("fill") or fill),
            "dash": source.get("dash") or style.get("dash") or source.get("dashed"),
            "opacity": source.get("opacity") or style.get("opacity") or 1,
        }

    def _dedupe_primitives(self, primitives: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen: set[str] = set()
        result: List[Dict[str, Any]] = []
        for item in primitives:
            key = json.dumps(
                {
                    "type": item.get("type"),
                    "points": item.get("points"),
                    "center": item.get("center"),
                    "through": item.get("through"),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    def _compute_bbox(self, points: Iterable[Dict[str, Any]]) -> Dict[str, float]:
        xs = [point["coord"][0] for point in points if self._coerce_xy(point.get("coord"))]
        ys = [point["coord"][1] for point in points if self._coerce_xy(point.get("coord"))]
        if not xs or not ys:
            return {"min_x": -1.0, "max_x": 1.0, "min_y": -1.0, "max_y": 1.0}
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        pad = max(max_x - min_x, max_y - min_y, 1.0) * 0.18
        return {
            "min_x": min_x - pad,
            "max_x": max_x + pad,
            "min_y": min_y - pad,
            "max_y": max_y + pad,
        }

    def _step_payload(self, step: ScriptStep) -> Dict[str, Any]:
        return {
            "id": step.id,
            "title": step.title,
            "duration": step.duration,
            "narration": step.narration,
            "visual_cues": list(step.visual_cues or []),
            "visible_segments": list(step.visible_segments or []),
            "required_actions": copy.deepcopy(step.required_actions or []),
            "auxiliary_line_actions": copy.deepcopy(step.auxiliary_line_actions or []),
        }

    def _fallback_scene(self) -> Dict[str, Any]:
        return {
            "points": [
                {"id": "A", "coord": [-2.0, -1.0]},
                {"id": "B", "coord": [2.0, -1.0]},
                {"id": "C", "coord": [0.0, 1.8]},
            ],
            "primitives": [{"type": "polygon", "points": ["A", "B", "C"]}],
            "layout_mode": "fallback_triangle",
        }

    def _coerce_xy(self, value: Any) -> Optional[List[float]]:
        if isinstance(value, dict):
            value = [value.get("x"), value.get("y")]
        if not isinstance(value, (list, tuple)) or len(value) < 2:
            return None
        try:
            x = float(value[0])
            y = float(value[1])
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(x) and math.isfinite(y)):
            return None
        return [x, y]

    def _finite_number(self, value: Any) -> bool:
        try:
            return math.isfinite(float(value))
        except (TypeError, ValueError):
            return False

    def _fail(self, state: Dict[str, Any], message: str) -> Dict[str, Any]:
        project: VideoProject = state["project"]
        project.status = "failed"
        project.error_message = message
        state["project"] = project
        state["current_step"] = "interactive_failed"
        state.setdefault("messages", []).append({"role": "assistant", "content": message})
        return state

    def _build_html(self, scene_package: Dict[str, Any]) -> str:
        embedded = json.dumps(scene_package, ensure_ascii=False).replace("</", "<\\/")
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
  <title>AnotherMe 交互可视化</title>
  <style>
    :root {{ color-scheme: light; --blue:#4a6fa5; --ink:#243044; --muted:#64748b; --line:#334155; --paper:#fffdf8; }}
    * {{ box-sizing: border-box; }}
    body {{ margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f5f5f7; color:var(--ink); }}
    .app {{ min-height:100vh; display:flex; flex-direction:column; }}
    .topbar {{ display:flex; align-items:center; gap:10px; padding:12px 14px; background:#fff; border-bottom:1px solid #e5e7eb; }}
    .title {{ font-size:16px; font-weight:700; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }}
    .badge {{ font-size:12px; color:var(--muted); background:#eef4ff; padding:4px 8px; border-radius:999px; }}
    .workspace {{ flex:1; display:grid; grid-template-columns:minmax(0,1fr) 320px; min-height:0; }}
    .stageWrap {{ min-height:0; padding:10px; }}
    .stage {{ width:100%; height:100%; min-height:420px; background:var(--paper); border:1px solid #e5e7eb; border-radius:8px; touch-action:none; }}
    .side {{ background:#fff; border-left:1px solid #e5e7eb; display:flex; flex-direction:column; min-height:0; }}
    .controls {{ display:flex; gap:8px; flex-wrap:wrap; padding:10px; border-bottom:1px solid #eef2f7; }}
    button {{ border:1px solid #d8e0ee; background:#fff; color:var(--ink); border-radius:8px; min-height:36px; padding:0 10px; font-size:14px; }}
    button.primary {{ background:var(--blue); color:#fff; border-color:var(--blue); }}
    .stepPanel {{ padding:12px; overflow:auto; }}
    .stepTitle {{ font-weight:700; font-size:15px; margin-bottom:8px; }}
    .stepText {{ font-size:14px; line-height:1.55; color:#3f4b5f; white-space:pre-wrap; }}
    .steps {{ display:flex; gap:6px; padding:10px; overflow-x:auto; border-top:1px solid #eef2f7; background:#fff; }}
    .chip {{ flex:0 0 auto; border:1px solid #d8e0ee; border-radius:999px; padding:7px 10px; font-size:13px; color:#475569; }}
    .chip.active {{ background:#4a6fa5; color:#fff; border-color:#4a6fa5; }}
    .geom-label {{ font-size:14px; font-weight:700; fill:#243044; paint-order:stroke; stroke:#fffdf8; stroke-width:4px; stroke-linejoin:round; }}
    .point {{ cursor:grab; }}
    .point.dragging {{ cursor:grabbing; }}
    @media (max-width: 760px) {{
      .workspace {{ grid-template-columns:1fr; grid-template-rows:minmax(380px,1fr) auto; }}
      .side {{ border-left:none; border-top:1px solid #e5e7eb; max-height:42vh; }}
      .stage {{ min-height:380px; }}
    }}
  </style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="title" id="problemTitle">交互可视化</div>
    <div class="badge" id="sceneSource">scene</div>
  </div>
  <div class="workspace">
    <div class="stageWrap"><svg id="stage" class="stage" role="img" aria-label="interactive geometry scene"></svg></div>
    <aside class="side">
      <div class="controls">
        <button id="prevBtn">上一步</button>
        <button id="playBtn" class="primary">播放</button>
        <button id="nextBtn">下一步</button>
        <button id="resetBtn">复位</button>
        <button id="zoomInBtn">放大</button>
        <button id="zoomOutBtn">缩小</button>
        <button id="labelsBtn">标签</button>
      </div>
      <div class="stepPanel">
        <div class="stepTitle" id="stepTitle"></div>
        <div class="stepText" id="stepText"></div>
      </div>
      <div class="steps" id="steps"></div>
    </aside>
  </div>
</div>
<script type="application/json" id="scene-package">{embedded}</script>
<script>
(() => {{
  const pkg = JSON.parse(document.getElementById('scene-package').textContent);
  const svg = document.getElementById('stage');
  const scene = pkg.scene || {{}};
  const points = new Map((scene.points || []).map(p => [p.id, {{...p, coord:[+p.coord[0], +p.coord[1]], initial:[+p.coord[0], +p.coord[1]]}}]));
  const primitives = scene.primitives || [];
  const steps = pkg.steps && pkg.steps.length ? pkg.steps : [{{id:1,title:'可视化',narration:pkg.problem_text || ''}}];
  let currentStep = 0, showLabels = true, scale = 1, timer = null, dragging = null;
  document.getElementById('problemTitle').textContent = pkg.problem_text || '交互可视化';
  document.getElementById('sceneSource').textContent = pkg.scene_source || 'scene';

  function bbox() {{
    const b = scene.bbox || {{}};
    const xs = [...points.values()].map(p => p.coord[0]);
    const ys = [...points.values()].map(p => p.coord[1]);
    let minX = Number.isFinite(b.min_x) ? b.min_x : Math.min(...xs, -1);
    let maxX = Number.isFinite(b.max_x) ? b.max_x : Math.max(...xs, 1);
    let minY = Number.isFinite(b.min_y) ? b.min_y : Math.min(...ys, -1);
    let maxY = Number.isFinite(b.max_y) ? b.max_y : Math.max(...ys, 1);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const w = Math.max((maxX - minX) / scale, 0.1), h = Math.max((maxY - minY) / scale, 0.1);
    return {{minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2}};
  }}
  function size() {{
    const r = svg.getBoundingClientRect();
    return {{w: Math.max(r.width, 320), h: Math.max(r.height, 320)}};
  }}
  function project([x, y]) {{
    const b = bbox(), s = size(), pad = 34;
    const sx = pad + (x - b.minX) / Math.max(b.maxX - b.minX, 0.001) * (s.w - pad * 2);
    const sy = s.h - pad - (y - b.minY) / Math.max(b.maxY - b.minY, 0.001) * (s.h - pad * 2);
    return [sx, sy];
  }}
  function unproject(clientX, clientY) {{
    const rect = svg.getBoundingClientRect(), b = bbox(), pad = 34;
    const x = b.minX + (clientX - rect.left - pad) / Math.max(rect.width - pad * 2, 1) * (b.maxX - b.minX);
    const y = b.minY + (rect.height - (clientY - rect.top) - pad) / Math.max(rect.height - pad * 2, 1) * (b.maxY - b.minY);
    return [x, y];
  }}
  function el(name, attrs = {{}}, children = []) {{
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, String(v));
    for (const child of children) node.appendChild(child);
    return node;
  }}
  function point(id) {{ return points.get(id); }}
  function styleAttrs(style = {{}}, fallback = '#334155') {{
    return {{
      stroke: style.stroke || fallback,
      fill: style.fill || 'none',
      'stroke-width': style.strokeWidth || 2.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: style.opacity ?? 1,
      'stroke-dasharray': style.dash ? '7 7' : undefined
    }};
  }}
  function visiblePrimitive(p, idx) {{
    const step = steps[currentStep] || {{}};
    const visible = step.visible_segments || [];
    if (!visible.length) return idx <= currentStep + 20;
    return visible.includes(p.id) || (p.points || []).some(id => visible.includes(id));
  }}
  function render() {{
    const s = size();
    svg.setAttribute('viewBox', `0 0 ${{s.w}} ${{s.h}}`);
    svg.innerHTML = '';
    svg.appendChild(el('rect', {{x:0,y:0,width:s.w,height:s.h,fill:'#fffdf8'}}));
    primitives.forEach((p, idx) => {{
      if (!visiblePrimitive(p, idx)) return;
      if (p.type === 'polygon') {{
        const pts = (p.points || []).map(id => point(id)).filter(Boolean).map(pt => project(pt.coord).join(',')).join(' ');
        if (pts) svg.appendChild(el('polygon', {{points:pts, ...styleAttrs(p.style, '#4a6fa5'), fill:(p.style && p.style.fill) || '#d8f3dc', opacity:(p.style && p.style.opacity) || 0.42}}));
      }} else if (p.type === 'circle') {{
        const c = point(p.center);
        if (!c) return;
        const pc = project(c.coord);
        let radius = +p.radius;
        if (!Number.isFinite(radius) && p.through && point(p.through)) {{
          const t = point(p.through).coord;
          radius = Math.hypot(t[0]-c.coord[0], t[1]-c.coord[1]);
        }}
        const pr = project([c.coord[0] + (radius || 1), c.coord[1]]);
        svg.appendChild(el('circle', {{cx:pc[0], cy:pc[1], r:Math.abs(pr[0]-pc[0]), ...styleAttrs(p.style, '#5b8def')}}));
      }} else {{
        const refs = p.points || [];
        const a = point(refs[0]), b = point(refs[1]);
        if (!a || !b) return;
        const pa = project(a.coord), pb = project(b.coord);
        svg.appendChild(el('line', {{x1:pa[0], y1:pa[1], x2:pb[0], y2:pb[1], ...styleAttrs(p.style)}}));
      }}
    }});
    for (const p of points.values()) {{
      const [x, y] = project(p.coord);
      const g = el('g', {{class:'point', 'data-id':p.id}});
      g.appendChild(el('circle', {{cx:x, cy:y, r:6.5, fill:'#4a6fa5', stroke:'#fff', 'stroke-width':2}}));
      if (showLabels) g.appendChild(el('text', {{x:x+9, y:y-9, class:'geom-label'}}, [document.createTextNode(p.label || p.id)]));
      svg.appendChild(g);
    }}
    updateStep();
  }}
  function updateStep() {{
    const step = steps[currentStep] || steps[0];
    document.getElementById('stepTitle').textContent = `${{currentStep + 1}}. ${{step.title || '步骤'}}`;
    document.getElementById('stepText').textContent = step.narration || (step.visual_cues || []).join('\\n') || pkg.problem_text || '';
    document.querySelectorAll('.chip').forEach((n, i) => n.classList.toggle('active', i === currentStep));
  }}
  function buildChips() {{
    const box = document.getElementById('steps');
    box.innerHTML = '';
    steps.forEach((step, i) => {{
      const chip = document.createElement('div');
      chip.className = 'chip' + (i === currentStep ? ' active' : '');
      chip.textContent = `${{i + 1}} ${{step.title || ''}}`;
      chip.onclick = () => {{ currentStep = i; render(); }};
      box.appendChild(chip);
    }});
  }}
  function stop() {{ if (timer) clearInterval(timer); timer = null; document.getElementById('playBtn').textContent = '播放'; }}
  document.getElementById('prevBtn').onclick = () => {{ currentStep = Math.max(0, currentStep - 1); render(); }};
  document.getElementById('nextBtn').onclick = () => {{ currentStep = Math.min(steps.length - 1, currentStep + 1); render(); }};
  document.getElementById('resetBtn').onclick = () => {{ for (const p of points.values()) p.coord = [...p.initial]; scale = 1; currentStep = 0; stop(); render(); }};
  document.getElementById('zoomInBtn').onclick = () => {{ scale = Math.min(4, scale * 1.2); render(); }};
  document.getElementById('zoomOutBtn').onclick = () => {{ scale = Math.max(0.4, scale / 1.2); render(); }};
  document.getElementById('labelsBtn').onclick = () => {{ showLabels = !showLabels; render(); }};
  document.getElementById('playBtn').onclick = () => {{
    if (timer) return stop();
    document.getElementById('playBtn').textContent = '暂停';
    timer = setInterval(() => {{
      currentStep = currentStep >= steps.length - 1 ? 0 : currentStep + 1;
      render();
    }}, 2200);
  }};
  svg.addEventListener('pointerdown', e => {{
    const g = e.target.closest && e.target.closest('.point');
    if (!g) return;
    const p = point(g.getAttribute('data-id'));
    if (!p || p.draggable === false) return;
    dragging = p;
    g.classList.add('dragging');
    svg.setPointerCapture(e.pointerId);
  }});
  svg.addEventListener('pointermove', e => {{
    if (!dragging) return;
    dragging.coord = unproject(e.clientX, e.clientY);
    render();
  }});
  svg.addEventListener('pointerup', e => {{ dragging = null; try {{ svg.releasePointerCapture(e.pointerId); }} catch {{}} }});
  window.addEventListener('resize', render);
  buildChips();
  render();
}})();
</script>
</body>
</html>
"""
