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
import { AVAILABLE_MODELS, type ModelDef } from '../lib/config';

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
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
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
    backgroundColor: '#f8f9fa',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e0e0e0',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  closeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modelItemSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f7ff',
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
    color: '#1a1a1a',
  },
  modelNameSelected: {
    color: '#007AFF',
  },
  checkmark: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '700',
  },
  modelProvider: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  modelDesc: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  separator: {
    height: 8,
  },
});
