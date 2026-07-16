"""Runtime contracts for agent-node input/output validation."""

from __future__ import annotations

from typing import Any, Callable, Dict, Tuple


StateLike = Dict[str, Any]
NodeFunc = Callable[[StateLike], StateLike]


def _has_drawable_geometry(payload: Any) -> bool:
	if not isinstance(payload, dict):
		return False
	points = payload.get("points")
	has_points = False
	if isinstance(points, dict):
		has_points = any(
			isinstance(item, dict) and (item.get("coord") or item.get("pos"))
			for item in points.values()
		)
	elif isinstance(points, list):
		has_points = any(
			isinstance(item, dict) and (item.get("coord") or item.get("pos") or item.get("position"))
			for item in points
		)
	if not has_points:
		return False
	primitives = payload.get("primitives") or []
	if any(
		isinstance(item, dict) and str(item.get("type", "")).strip()
		for item in primitives
	):
		return True
	for bucket in ("lines", "objects", "angles", "circles", "arcs", "segments", "polygons"):
		items = payload.get(bucket)
		if isinstance(items, list) and bool(items):
			return True
	return False


def _set_failure(state: StateLike, step_name: str, message: str) -> StateLike:
	state.setdefault("messages", [])
	state.setdefault("metadata", {})
	project = state.get("project")
	if project is not None:
		project.status = "failed"
		project.error_message = message
		state["project"] = project
	state["current_step"] = f"{step_name}_failed"
	state["messages"].append({"role": "assistant", "content": message})
	state["metadata"]["fallback_level"] = "critical"
	events = state["metadata"].setdefault("fallback_events", [])
	events.append({
		"stage": f"{step_name}.node_execution",
		"message": message,
		"retryable": False,
	})
	return state


def _has_structured_geometry(metadata: Dict[str, Any]) -> bool:
	if _has_drawable_geometry(metadata.get("drawable_scene")):
		return True
	semantic_graph = metadata.get("semantic_graph")
	if isinstance(semantic_graph, dict) and bool(semantic_graph):
		return True
	geometry_facts = metadata.get("geometry_facts")
	if isinstance(geometry_facts, dict) and bool(geometry_facts):
		return True
	if isinstance(geometry_facts, list) and bool(geometry_facts):
		return True
	return False


def _validate_before(step_name: str, state: StateLike) -> Tuple[bool, str]:
	project = state.get("project")
	if project is None:
		return False, "Workflow state is missing project payload."

	if getattr(project, "status", "") == "failed":
		return True, ""

	metadata = state.get("metadata") or {}
	if step_name == "script":
		has_problem_text = bool(str(getattr(project, "problem_text", "") or "").strip())
		if not has_problem_text and not _has_structured_geometry(metadata):
			return False, "ScriptAgent input missing: project.problem_text or structured geometry metadata"
	elif step_name == "voice":
		if not getattr(project, "script_steps", []):
			return False, "VoiceAgent input missing: project.script_steps"
	elif step_name == "animation":
		if not getattr(project, "script_steps", []):
			return False, "AnimationAgent input missing: project.script_steps"
	elif step_name == "repair":
		if not str(metadata.get("manim_code", "") or "").strip():
			return False, "RepairAgent input missing: metadata.manim_code"
	elif step_name == "merge":
		if not str(metadata.get("manim_code", "") or "").strip():
			return False, "MergeAgent input missing: metadata.manim_code"
	elif step_name == "pre_planning":
		has_problem_text = bool(str(getattr(project, "problem_text", "") or "").strip())
		if not has_problem_text and not _has_structured_geometry(metadata):
			return False, "ProblemTypePrePlanner input missing: project.problem_text or structured geometry metadata"
	elif step_name == "matplotlib_render":
		has_problem_text = bool(str(getattr(project, "problem_text", "") or "").strip())
		has_script = bool(getattr(project, "script_steps", []))
		if not has_problem_text and not has_script:
			return False, "MatplotlibAgent input missing: project.problem_text or project.script_steps"

	return True, ""


def _validate_after(step_name: str, state: StateLike) -> Tuple[bool, str]:
	project = state.get("project")
	if project is None:
		return False, "Workflow state is missing project payload."

	if getattr(project, "status", "") == "failed":
		return True, ""

	metadata = state.get("metadata") or {}
	if step_name == "vision":
		has_problem_text = bool(str(getattr(project, "problem_text", "") or "").strip())
		if not has_problem_text and not _has_structured_geometry(metadata):
			return False, "VisionAgent output missing: project.problem_text or structured geometry metadata"
	elif step_name == "script":
		if not getattr(project, "script_steps", []):
			return False, "ScriptAgent output missing: project.script_steps"
	elif step_name == "voice":
		audio_files = getattr(project, "tts_audio_files", None)
		if not isinstance(audio_files, list):
			return False, "VoiceAgent output invalid: project.tts_audio_files"
		if not audio_files:
			return False, "VoiceAgent output invalid: project.tts_audio_files is empty"
	elif step_name == "animation":
		if not str(metadata.get("manim_code", "") or "").strip():
			return False, "AnimationAgent output missing: metadata.manim_code"
		if not str(getattr(project, "manim_class_name", "") or "").strip():
			return False, "AnimationAgent output missing: project.manim_class_name"
	elif step_name == "repair":
		if not str(metadata.get("manim_code", "") or "").strip():
			return False, "RepairAgent output missing: metadata.manim_code"
	elif step_name == "merge":
		if str(getattr(project, "status", "")) in {"completed", "completed_degraded", "completed_with_fallback"}:
			if not str(getattr(project, "final_video_path", "") or "").strip():
				return False, "MergeAgent completed without final output path"
	elif step_name == "pre_planning":
		if not isinstance(metadata.get("problem_constraints"), dict):
			return False, "ProblemTypePrePlanner output missing: metadata.problem_constraints"
	elif step_name == "matplotlib_render":
		if str(getattr(project, "status", "")) in {"completed", "completed_degraded", "completed_with_fallback"}:
			if not str(getattr(project, "matplotlib_image_path", "") or "").strip():
				return False, "MatplotlibAgent completed without matplotlib_image_path"
	elif step_name == "interactive_render":
		if str(getattr(project, "status", "")) in {"completed", "completed_degraded", "completed_with_fallback"}:
			if not str(getattr(project, "interactive_html_path", "") or "").strip():
				return False, "InteractiveAgent completed without interactive_html_path"
			if not str(getattr(project, "scene_package_path", "") or "").strip():
				return False, "InteractiveAgent completed without scene_package_path"

	return True, ""


def wrap_agent_node(step_name: str, node_func: NodeFunc) -> NodeFunc:
	"""Wrap agent node with pre/post contract validation."""

	def _wrapped(state: StateLike) -> StateLike:
		state.setdefault("messages", [])
		state.setdefault("metadata", {})
		project = state.get("project")
		if project is not None and getattr(project, "status", "") == "failed":
			return state

		ok_before, message_before = _validate_before(step_name, state)
		if not ok_before:
			return _set_failure(state, step_name, message_before)

		try:
			updated_state = node_func(state)
		except Exception as exc:
			return _set_failure(state, step_name, f"{step_name} node execution failed: {exc}")

		if not isinstance(updated_state, dict):
			return _set_failure(
				state,
				step_name,
				f"{step_name} node returned invalid state type: {type(updated_state).__name__}",
			)

		ok_after, message_after = _validate_after(step_name, updated_state)
		if not ok_after:
			return _set_failure(updated_state, step_name, message_after)

		return updated_state

	return _wrapped
