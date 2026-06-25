import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AVAILABLE_MODELS, type ModelDef } from '../lib/config';
import { colors } from '../lib/theme';

interface ModelSelectorProps {
  visible: boolean;
  selectedModel: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}

// 提供商颜色
const PROVIDER_COLORS: Record<string, string> = {
  OpenAI: '#10a37f',
  Anthropic: '#d97706',
  DeepSeek: '#4f6df5',
  Google: '#4285f4',
};

export function ModelSelector({ visible, selectedModel, onSelect, onClose }: ModelSelectorProps) {
  const handleSelect = (model: ModelDef) => {
    onSelect(model.id);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* 头部 */}
        <View style={styles.header}>
          <Text style={styles.title}>选择模型</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>完成</Text>
          </TouchableOpacity>
        </View>

        {/* 模型列表 */}
        <FlatList
          data={AVAILABLE_MODELS}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedModel;
            const providerColor = PROVIDER_COLORS[item.provider] || '#666';
            return (
              <TouchableOpacity
                style={[styles.modelItem, isSelected && styles.modelItemSelected]}
                onPress={() => handleSelect(item)}
                activeOpacity={0.7}
              >
                {/* 提供商色标 */}
                <View style={[styles.providerDot, { backgroundColor: providerColor }]} />
                <View style={styles.modelInfo}>
                  <View style={styles.modelNameRow}>
                    <Text style={[styles.modelName, isSelected && styles.modelNameSelected]}>
                      {item.label}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                    )}
                  </View>
                  <Text style={styles.modelProvider}>{item.provider}</Text>
                  <Text style={styles.modelDesc}>{item.description}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  closeText: {
    color: colors.textInverse,
    fontSize: 15,
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  providerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  modelInfo: {
    flex: 1,
  },
  modelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modelNameSelected: {
    color: colors.primary,
  },
  modelProvider: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  modelDesc: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  separator: {
    height: 8,
  },
});
