import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import type { DiagnosticProbe as ProbeType } from '../lib/types';

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
          <Text style={styles.diffText}>
            {'★'.repeat(Math.min(probe.difficulty, 5))}{'☆'.repeat(Math.max(0, 5 - probe.difficulty))}
          </Text>
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
          placeholderTextColor="#999"
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
                <Text
                  style={[
                    styles.optionText,
                    isSelected && styles.optionTextSelected,
                    isCorrectStep && styles.optionTextCorrect,
                    isWrongStep && styles.optionTextWrong,
                  ]}
                >
                  {isSelected ? '☑' : '☐'} {opt}
                </Text>
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
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    marginHorizontal: 16,
    shadowColor: '#000',
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
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  diffText: {
    fontSize: 12,
    color: '#E65100',
  },
  kpBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  kpText: {
    fontSize: 12,
    color: '#1565C0',
  },
  question: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
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
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
  },
  optionSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  optionCorrect: {
    borderColor: '#4CAF50',
    backgroundColor: '#E8F5E9',
  },
  optionWrong: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFEBEE',
  },
  optionText: {
    fontSize: 15,
    color: '#333',
  },
  optionTextSelected: {
    color: '#007AFF',
    fontWeight: '500',
  },
  optionTextCorrect: {
    color: '#2E7D32',
    fontWeight: '500',
  },
  optionTextWrong: {
    color: '#C62828',
  },
  fillInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#FAFAFA',
  },
  fillCorrect: {
    borderColor: '#4CAF50',
    backgroundColor: '#E8F5E9',
  },
  fillWrong: {
    borderColor: '#FF3B30',
    backgroundColor: '#FFEBEE',
  },
  submitButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  submitDisabled: {
    backgroundColor: '#99C5FF',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  resultBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 10,
  },
  resultCorrect: {
    backgroundColor: '#E8F5E9',
    borderLeftWidth: 4,
    borderLeftColor: '#4CAF50',
  },
  resultWrong: {
    backgroundColor: '#FFEBEE',
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  explanation: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  hintsContainer: {
    marginTop: 8,
  },
  hintsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  hintText: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
});
