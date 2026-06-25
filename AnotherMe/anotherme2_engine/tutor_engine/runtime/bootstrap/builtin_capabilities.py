"""Built-in capability class paths."""

BUILTIN_CAPABILITY_CLASSES: dict[str, str] = {
    "chat": "tutor_engine.capabilities.chat:ChatCapability",
    "visual_solve_fast": "tutor_engine.capabilities.chat:VisualSolveFastCapability",
    "deep_solve": "tutor_engine.capabilities.deep_solve:DeepSolveCapability",
    "deep_question": "tutor_engine.capabilities.deep_question:DeepQuestionCapability",
    "deep_research": "tutor_engine.capabilities.deep_research:DeepResearchCapability",
    "math_animator": "tutor_engine.capabilities.math_animator:MathAnimatorCapability",
    "visualize": "tutor_engine.capabilities.visualize:VisualizeCapability",
    "auto": "tutor_engine.capabilities.auto:AutoCapability",
}
