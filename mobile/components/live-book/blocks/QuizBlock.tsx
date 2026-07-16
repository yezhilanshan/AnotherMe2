import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { colors } from "../../../lib/theme";
import type { Block } from "../../../lib/types";
import {
  isChoiceQuizQuestion,
  normalizeQuizQuestionType,
  resolveChoiceAnswerKey,
} from "../../../lib/live-book/quiz-question-type";

export interface QuizAttemptArgs {
  questionId?: string;
  userAnswer?: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  question_id?: string;
  question?: string;
  question_type?: string;
  options?: Record<string, string> | null;
  correct_answer?: string;
  explanation?: string;
  difficulty?: string;
}

export interface QuizBlockProps {
  block: Block;
  onAttempt?: (block: Block, args: QuizAttemptArgs) => void;
}

export default function QuizBlock({ block, onAttempt }: QuizBlockProps) {
  const payload = (block.payload || {}) as Record<string, unknown>;
  const questions = (payload.questions as QuizQuestion[] | undefined) || [];

  if (questions.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>No quiz questions generated.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Quick Check title */}
      <View style={styles.titleRow}>
        <View style={styles.titleLine} />
        <Text style={styles.titleLabel}>Quick Check</Text>
        <View style={styles.titleLine} />
      </View>

      <View style={styles.questionsWrap}>
        {questions.map((q, idx) => (
          <QuizQuestionCard
            key={q.question_id || idx}
            index={idx}
            question={q}
            onAttempt={(args) => onAttempt?.(block, args)}
          />
        ))}
      </View>
    </View>
  );
}

function QuizQuestionCard({
  index,
  question,
  onAttempt,
}: {
  index: number;
  question: QuizQuestion;
  onAttempt?: (args: QuizAttemptArgs) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reported, setReported] = useState(false);
  const normalizedType = normalizeQuizQuestionType(question.question_type);
  const options = question.options || {};
  const isChoice = isChoiceQuizQuestion(normalizedType);
  const correct = String(question.correct_answer || "").trim();
  const correctChoiceKey = resolveChoiceAnswerKey(correct, options);

  useEffect(() => {
    if (revealed && selected && !reported && onAttempt) {
      onAttempt({
        questionId: question.question_id,
        userAnswer: selected,
        isCorrect: selected.toUpperCase() === correctChoiceKey,
      });
      setReported(true);
    }
  }, [revealed, selected, reported, onAttempt, question.question_id, correctChoiceKey]);

  return (
    <View style={index > 0 ? styles.questionGroup : undefined}>
      {/* Question text */}
      <View style={styles.questionHeader}>
        <View style={styles.questionContent}>
          <Text style={styles.questionIndex}>{index + 1}.</Text>
          <View style={styles.questionTextWrap}>
            <MarkdownRenderer
              content={String(question.question || "(missing)")}
              color={colors.textPrimary}
            />
          </View>
        </View>
        {question.difficulty ? (
          <View style={styles.difficultyBadge}>
            <Text style={styles.difficultyText}>{question.difficulty}</Text>
          </View>
        ) : null}
      </View>

      {/* Choice options */}
      {isChoice && Object.keys(options).length > 0 ? (
        <View style={styles.optionsWrap}>
          {Object.entries(options).map(([key, label]) => {
            const upperKey = key.toUpperCase();
            const isSelected = selected === upperKey;
            const isCorrect = revealed && upperKey === correctChoiceKey;
            const isWrongPick = revealed && isSelected && upperKey !== correctChoiceKey;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  styles.option,
                  isCorrect && styles.optionCorrect,
                  isWrongPick && styles.optionWrong,
                  isSelected && !isCorrect && !isWrongPick && styles.optionSelected,
                ]}
                onPress={() => setSelected(upperKey)}
                activeOpacity={0.7}
              >
                <Text style={styles.optionKey}>{upperKey}.</Text>
                <Text
                  style={[
                    styles.optionLabel,
                    isCorrect && styles.optionLabelCorrect,
                    isWrongPick && styles.optionLabelWrong,
                  ]}
                >
                  {label}
                </Text>
                {isCorrect && (
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                )}
                {isWrongPick && (
                  <Ionicons name="close-circle" size={16} color={colors.error} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.openHint}>
          {normalizedType === "written"
            ? "Think about your answer, then reveal the solution."
            : "Open response — click reveal to see the model answer."}
        </Text>
      )}

      {/* Reveal / Hide button + answer key */}
      <View style={styles.revealRow}>
        <TouchableOpacity
          style={styles.revealBtn}
          onPress={() => setRevealed((v) => !v)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={revealed ? "eye-off-outline" : "eye-outline"}
            size={14}
            color={colors.textSecondary}
          />
          <Text style={styles.revealText}>
            {revealed ? "Hide answer" : "Reveal answer"}
          </Text>
        </TouchableOpacity>
        {revealed && correct && isChoice && (
          <Text style={styles.answerKey}>
            Answer: <Text style={styles.answerKeyBold}>{correctChoiceKey || correct}</Text>
          </Text>
        )}
      </View>

      {/* Revealed answer for non-choice */}
      {revealed && correct && !isChoice && (
        <View style={styles.revealedAnswer}>
          <Text style={styles.revealedAnswerLabel}>Answer</Text>
          <MarkdownRenderer content={correct} color={colors.textPrimary} />
        </View>
      )}

      {/* Explanation */}
      {revealed && question.explanation ? (
        <View style={styles.explanationBox}>
          <MarkdownRenderer
            content={String(question.explanation)}
            color={colors.textSecondary}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  titleLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.primary + "30",
  },
  titleLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: colors.primary,
  },
  questionsWrap: {
    gap: 12,
  },
  questionGroup: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  questionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  questionContent: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
  },
  questionIndex: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.textPrimary,
    marginTop: 1,
  },
  questionTextWrap: {
    flex: 1,
  },
  difficultyBadge: {
    backgroundColor: colors.bgInput,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  difficultyText: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  optionsWrap: {
    marginTop: 10,
    gap: 6,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    gap: 8,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.infoLight,
  },
  optionCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  optionWrong: {
    borderColor: colors.error,
    backgroundColor: colors.errorLight,
  },
  optionKey: {
    fontSize: 12,
    fontFamily: "monospace",
    textTransform: "uppercase",
    color: colors.textSecondary,
  },
  optionLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  optionLabelCorrect: {
    color: "#2E7D32",
  },
  optionLabelWrong: {
    color: "#C62828",
  },
  openHint: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  revealRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    gap: 8,
  },
  revealBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
  },
  revealText: {
    fontSize: 12,
    fontWeight: "500",
    color: colors.textSecondary,
  },
  answerKey: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  answerKeyBold: {
    fontFamily: "monospace",
    color: colors.textPrimary,
  },
  revealedAnswer: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard + "B3",
    padding: 10,
  },
  revealedAnswerLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  explanationBox: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput + "66",
    padding: 10,
  },
});
