import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DiagnosticProbe as ProbeType } from '../lib/types';
import { colors } from '../lib/theme';

interface DiagnosticProbeProps {
  probe: ProbeType;
  onSubmit: (correct: boolean) => void;
}

export function DiagnosticProbe({ probe, onSubmit }: DiagnosticProbeProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [fillAnswer, setFillAnswer] = useState('');
  const [stepSelections, setStepSelections] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const checkAnswer = (): boolean => {
    if (probe.probeType === 'choice') {
      return selectedOption === probe.correctAnswer;
    }
    if (probe.probeType === 'fill_blank') {
      return fillAnswer.trim().toLowerCase() === (probe.correctAnswer as string).toLowerCase();
    }
    if (probe.probeType === 'step_by_step') {
      const correct = new Set(probe.correctAnswer as string[]);
      if (correct.size !== stepSelections.size) return false;
      for (const idx of stepSelections) {
        if (!correct.has(probe.options?.[idx] || '')) return false;
      }
      return true;
    }
    return false;
  };

  const handleSubmit = () => {
    const correct = checkAnswer();
    setIsCorrect(correct);
    setSubmitted(true);
    onSubmit(correct);
  };

  const toggleStep = (index: number) => {
    if (submitted) return;
    setStepSelections(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const canSubmit = () => {
    if (submitted) return false;
    if (probe.probeType === 'choice') return selectedOption !== null;
    if (probe.probeType === 'fill_blank') return fillAnswer.trim().length > 0;
    if (probe.probeType === 'step_by_step') return stepSelections.size > 0;
    return false;
  };

  return (
    <View style={styles.container}>
      {/* Difficulty badge */}
      <View style={styles.badgeRow}>
        <View style={styles.diffBadge}>
          <View style={{ flexDirection: 'row', gap: 2 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <Ionicons
                key={i}
                name={i < probe.difficulty ? 'star' : 'star-outline'}
                size={12}
                color={i < probe.difficulty ? colors.warning : colors.apricotLight}
              />
            ))}
          </View>
        </View>
        {probe.knowledgePointId && (
          <View style={styles.kpBadge}>
            <Text style={styles.kpText}>{probe.knowledgePointId}</Text>
          </View>
        )}
      </View>

      {/* Question */}
      <Text style={styles.question}>{probe.question}</Text>

      {/* Answer area */}
      {probe.probeType === 'choice' && probe.options && (
        <View style={styles.optionsContainer}>
          {probe.options.map((opt, i) => {
            const isSelected = selectedOption === opt;
            const isCorrectOpt = submitted && opt === probe.correctAnswer;
            const isWrong = submitted && isSelected && !isCorrectOpt;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionSelected,
                  isCorrectOpt && styles.optionCorrect,
                  isWrong && styles.optionWrong,
                ]}
                onPress={() => !submitted && setSelectedOption(opt)}
                disabled={submitted}
              >
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                    isCorrectOpt && styles.optionTextCorrect,
                    isWrong && styles.optionTextWrong,
                  ]}
                >
                  {String.fromCharCode(65 + i)}. {opt}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {probe.probeType === 'fill_blank' && (
        <TextInput
          style={[styles.fillInput, submitted && (isCorrect ? styles.fillCorrect : styles.fillWrong)]}
          value={fillAnswer}
          onChangeText={setFillAnswer}
          placeholder="输入答案..."
          placeholderTextColor={colors.textMuted}
          editable={!submitted}
        />
      )}

      {probe.probeType === 'step_by_step' && probe.options && (
        <View style={styles.optionsContainer}>
          {probe.options.map((opt, i) => {
            const isSelected = stepSelections.has(i);
            const isCorrectStep = submitted && (probe.correctAnswer as string[]).includes(opt);
            const isWrongStep = submitted && isSelected && !isCorrectStep;
            return (
              <TouchableOpacity
                key={i}
                style={[
                  styles.optionButton,
                  isSelected && styles.optionSelected,
                  isCorrectStep && styles.optionCorrect,
                  isWrongStep && styles.optionWrong,
                ]}
                onPress={() => toggleStep(i)}
                disabled={submitted}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={18}
                    color={
                      isCorrectStep
                        ? colors.success
                        : isWrongStep
                        ? colors.error
                        : isSelected
                        ? colors.primary
                        : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.optionText,
                      isSelected && styles.optionTextSelected,
                      isCorrectStep && styles.optionTextCorrect,
                      isWrongStep && styles.optionTextWrong,
                    ]}
                  >
                    {opt}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Submit button */}
      {!submitted && (
        <TouchableOpacity
          style={[styles.submitButton, !canSubmit() && styles.submitDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit()}
        >
          <Text style={styles.submitText}>提交答案</Text>
        </TouchableOpacity>
      )}

      {/* Result + explanation */}
      {submitted && (
        <View style={[styles.resultBox, isCorrect ? styles.resultCorrect : styles.resultWrong]}>
          <Text style={styles.resultTitle}>
            {isCorrect ? '回答正确!' : '回答错误'}
          </Text>
          <Text style={styles.explanation}>{probe.explanation}</Text>
          {probe.hints && probe.hints.length > 0 && (
            <View style={styles.hintsContainer}>
              <Text style={styles.hintsTitle}>提示：</Text>
              {probe.hints.map((hint, i) => (
                <Text key={i} style={styles.hintText}>• {hint}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    marginHorizontal: 16,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 8,
    gap: 8,
  },
  diffBadge: {
    backgroundColor: colors.apricotLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  diffText: {
    fontSize: 12,
    color: colors.warning,
  },
  kpBadge: {
    backgroundColor: colors.infoLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  kpText: {
    fontSize: 12,
    color: colors.info,
  },
  question: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
    lineHeight: 24,
    marginBottom: 12,
  },
  optionsContainer: {
    gap: 8,
  },
  optionButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgInput,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  optionCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  optionWrong: {
    borderColor: colors.error,
    backgroundColor: colors.errorLight,
  },
  optionText: {
    fontSize: 15,
    color: colors.textPrimary,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '500',
  },
  optionTextCorrect: {
    color: colors.success,
    fontWeight: '500',
  },
  optionTextWrong: {
    color: colors.error,
  },
  fillInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: colors.bgInput,
  },
  fillCorrect: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  fillWrong: {
    borderColor: colors.error,
    backgroundColor: colors.errorLight,
  },
  submitButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  submitDisabled: {
    backgroundColor: colors.primaryLight,
  },
  submitText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  resultBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
  },
  resultCorrect: {
    backgroundColor: colors.successLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.success,
  },
  resultWrong: {
    backgroundColor: colors.errorLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  explanation: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  hintsContainer: {
    marginTop: 8,
  },
  hintsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  hintText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
