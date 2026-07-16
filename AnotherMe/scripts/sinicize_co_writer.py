import re

path = 'D:/AnotherMe-main/AnotherMe/features/co-writer/pages/co-writer/editor-page.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove i18n imports and hook
content = content.replace('import { useTranslation } from "react-i18next";\n', '')
content = content.replace('  const { t } = useTranslation();\n', '')

# Simple replacements
replacements = {
    't("Document not found")': '"文档未找到"',
    't("This document may have been deleted, or the link is incorrect.")': '"文档可能已被删除，或链接不正确。"',
    't("Back to Co-Writer")': '"返回协作写作"',
    't("Back to documents")': '"返回文档列表"',
    't("Co-Writer")': '"协作写作"',
    't("Loading document…")': '"加载文档中…"',
    't("Untitled draft")': '"未命名草稿"',
    't("Document title")': '"文档标题"',
    't("Double-click to rename")': '"双击重命名"',
    't("words")': '"词"',
    't("chars")': '"字符"',
    't("Saving…")': '"保存中…"',
    't("Saved")': '"已保存"',
    't("Editor")': '"编辑器"',
    't("Collapse editor")': '"折叠编辑器"',
    't("Expand editor")': '"展开编辑器"',
    't("Start writing in Markdown...")': '"开始用 Markdown 写作…"',
    't("Resize editor and preview")': '"拖拽调整编辑器与预览大小"',
    't("Drag to resize, double-click to reset")': '"拖拽调整大小，双击重置"',
    't("Preview")': '"预览"',
    't("Collapse preview")': '"折叠预览"',
    't("Expand preview")': '"展开预览"',
    't("Nothing to preview yet.")': '"暂无预览内容。"',
    't("Sync Scroll")': '"同步滚动"',
    't("Scroll sync is on. Click to disable.")': '"滚动同步已开启，点击关闭"',
    't("Scroll sync is off. Click to enable.")': '"滚动同步已关闭，点击开启"',
    't("Pro Vide Writing")': '"专业写作"',
    't("Full Draft")': '"全文"',
    't("Clear")': '"清空"',
    't("Export Markdown")': '"导出 Markdown"',
    't("Save to Notebook")': '"保存到笔记本"',
    't("Load Example Template")': '"加载示例模板"',
    't("Tell AI what to do with the selection...")': '"告诉 AI 如何处理选中文本…"',
    't("Apply AI edit")': '"应用 AI 编辑"',
    't("Tools")': '"工具"',
    't("Trace")': '"追踪"',
    't("Thought")': '"思考"',
    't("Thinking...")': '"思考中…"',
    't("Tool")': '"工具"',
    't("Response")': '"回复"',
    't("Running tools and preparing the final edit...")': '"运行工具并准备最终编辑…"',
    't("Full Draft AI Edit")': '"全文 AI 编辑"',
    't("Close")': '"关闭"',
    't("Describe how you want the text edited...")': '"描述你想要的编辑方式…"',
    't("Source")': '"来源"',
    't("None")': '"无"',
    't("Knowledge Base")': '"知识库"',
    't("Web Search")': '"网络搜索"',
    't("Select...")': '"选择…"',
    't("Auto Mark")': '"自动标注"',
    't("Apply")': '"应用"',
    't("Please select a text passage first.")': '"请先选中一段文本。"',
    't("Please enter an instruction or choose a mode.")': '"请输入指令或选择一个模式。"',
    't("Applied AI edit to the selection.")': '"已对选中区域应用 AI 编辑。"',
    't("Please enter an editing instruction first.")': '"请先输入编辑指令。"',
    't("Applied auto-mark annotations.")': '"已应用自动标注。"',
    't("Example template is already loaded.")': '"示例模板已加载。"',
    't("Loaded example template.")': '"已加载示例模板。"',
    't("Add some content before saving to a notebook.")': '"保存到笔记本前请先添加内容。"',
    't("Untitled Co-Writer Document")': '"未命名协作写作文档"',
    't("Saved to notebook.")': '"已保存到笔记本。"',
}

for old, new in replacements.items():
    content = content.replace(old, new)

# Parameterized: t("{{count}} tools", { count: selectionTools.length })
content = content.replace(
    't("{{count}} tools", { count: selectionTools.length })',
    '`${selectionTools.length} 个工具`'
)
# Parameterized: t("Applied {{action}} to the full draft.", { action: ... })
content = content.replace(
    't("Applied {{action}} to the full draft.", {\n'
    '                      action: LABEL_MAP[data.action] || data.action,\n'
    '                    })',
    '`已对全文应用${LABEL_MAP[data.action] || data.action}。`'
)

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done sinicizing editor page')
