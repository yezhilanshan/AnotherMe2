有，而且问题不止一个。
这段 `VisionAgent` 的整体思路是对的：**先抽取，再清洗，再编译，再求坐标，失败再降级**。
但从代码质量、稳定性、性能、可维护性上看，仍然有几类比较明显的问题。

我按“最值得优先改”的顺序说。

---

## 1. `process()` 太重，职责过多

现在 `process()` 里同时做了：

* 输入校验
* bundle 分析
* bundle 恢复
* bundle 稳定化
* geometry spec 编译
* semantic signals 推断
* 坐标场景求解
* 验证
* fallback 构图
* metadata 回填
* debug 导出
* 错误处理
* 状态机推进 

这会带来两个问题：

### 问题

**第一，可读性差。**
主流程太长，真正的主干逻辑被大量细节淹没了。

**第二，后续改一处容易牵一片。**
比如你想改“坐标失败后的 fallback 策略”，结果会碰到 metadata、状态、debug 输出等很多地方。

### 建议

把 `process()` 至少拆成几个阶段函数：

* `_extract_and_stabilize_bundle(...)`
* `_compile_and_infer(...)`
* `_build_coordinate_or_fallback_scene(...)`
* `_finalize_vision_metadata(...)`

这样不会增加系统复杂度，反而会明显提升可维护性。

---

## 2. fallback 太多，容易掩盖真实问题

这段代码的一个明显风格是：**尽量别失败，失败了就继续兜底。**

比如：

* bundle 空了就 recover
* text 不好就 OCR fallback
* geometry facts 不够就 geometry fallback
* coordinate_scene 失败就 schematic fallback
* compile 失败也直接给空 spec 

### 问题

这会让系统“表面成功率很高”，但真实质量不透明。

最典型的是：

* 你最后拿到了 `vision_completed`
* 但其实核心几何关系已经很弱了
* 后面动画和脚本都只能基于近似或缺损信息运行

也就是**静默降级**太多。

### 建议

给每次 fallback 都增加显式质量标记，而不是只在 metadata 里悄悄写：

比如加一个统一字段：

* `vision_quality_level = exact / recovered / schematic / degraded`

或者更细：

* `text_source = model / ocr_fallback / upgraded_ocr`
* `geometry_source = model / geometry_fallback / sanitized_text_augmented`
* `scene_source = coordinate_scene / schematic_solver_fallback / schematic_fallback`

你现在虽然已经有一些 source 字段，但不够统一，也不够能直接拿来做后续决策。

---

## 3. 文本正则增强很强，但也很容易误补

`_augment_facts_from_problem_text()` 做了很多基于题目文本的补充，例如：

* 从“菱形 ABCD”补平行、等边关系
* 从“沿 DE 折叠”补 `DE`
* 从 `AD=5` 补长度
* 从 `tan B = 2` 补角度
* 从圆相关文字补 `point_on_circle` 

这个思路很实用，但也有隐患。

### 问题

**它有点过于激进。**

例如：

#### 1）`[A-Z][A-Z]` 这种模式太宽

`_infer_problem_text_segments()` 直接从文本里抓连续 token 作为线段，误识别空间不小。

#### 2）“菱形 ABCD”直接补很多关系，默认了图形一定规范成立

理论上没错，但这已经不是视觉识别了，而是在做“题意逻辑补全”。
一旦 OCR 错了一个字母，后面就会补出一整套错误关系。

#### 3）`tan B = 2` 直接转成 `arctan(2)` 型 angle measurement

这在语义上是合理的，但对于后续求解器是否真能正确消费，未必稳。
因为 `tan B` 和“角 B 的角度数值”不是一回事，它只是一个函数关系。

### 建议

把文本补强分成两类：

* **硬事实补强**：例如 `AD=5`
* **推理型补强**：例如“菱形 ⇒ 平行 + 边相等”

后者建议单独放到 `inferred_relations`，不要直接混入原始 `relations`。
这样后面如果出问题，更容易排查“哪些是看出来的，哪些是推出来的”。

---

## 4. 几何 facts 清洗函数过长，局部复杂度太高

`_sanitize_geometry_facts()` 本身很合理，但它依赖了大量内部函数：

* `_sanitize_circle_bucket`
* `_sanitize_arc_bucket`
* `_sanitize_angle_bucket`
* `_sanitize_relation_bucket`
* `_sanitize_measurement_bucket`
* `_augment_facts_from_problem_text`
* 多种 normalize / extract 函数 

### 问题

这套系统的复杂度已经接近一个“小型解析器”了。
但当前实现方式还是比较平铺直叙、函数散落，导致：

* 规则不好追踪
* bucket 之间依赖关系不够显式
* 改某个 token 规则时，可能影响多个 bucket

### 建议

可以把这一层抽成单独的 `GeometryFactsSanitizer` 类。
不是为了花哨，而是因为这块本质上已经是独立子系统了。

否则 VisionAgent 会越来越像“上帝类”。

---

## 5. 语义信号推断偏关键词驱动，容易误判

`_infer_semantic_signals()` 本质上是基于：

* 文本关键词
* templates
* relation_types

来推断题型和动作。

### 问题

这会有两个风险：

#### 1）关键词误触发

比如文本里出现“垂线”或“距离”，就可能把题型往 `metric_computation` 拉。
但有些题只是证明题的一部分描述。

#### 2）推荐动作容易过多

例如：

* 有 parallel 就推荐 `draw_connection_auxiliary`
* 有 tangent 或圆+垂直就推荐 `connect_center_tangent`

这有点“见一个特征就加一个动作”的味道。

### 建议

不要只输出 `recommended_geometry_actions`，最好同时输出每个动作的依据和置信度，例如：

```json
[
  {
    "action": "animate_fold",
    "confidence": 0.92,
    "evidence": ["text: 折叠", "pattern: fold_transform"]
  }
]
```

这样后面动画层就能做阈值裁剪，而不是全吃。

---

## 6. 坐标失败后 fallback 场景“能画出来”，但不一定“教学合理”

`_build_schematic_drawable_scene()` 和 `_attach_fallback_positions()` 的目标非常明确：

**没有精确坐标，也先把图摆出来。** 

### 问题

这个策略工程上对，但教学上未必对。

例如 fallback 布局时：

* 多边形按圆周均匀排点
* 圆上点按固定角度摆
* 未知点按网格放
* 线段上的点按比例插值 

这会带来一个隐患：

**图虽然可视化了，但可能和真实题意差别很大。**

特别是：

* 折叠题
* 轨迹题
* 切线/弦/圆幂题
* 特殊角关系题

示意图如果偏差太大，后面的动画讲解可能误导学生。

### 建议

对于 fallback scene，最好加一层“适用性判断”：

* 简单静态题允许 schematic
* 折叠/圆/动态题若只能 schematic，则应主动降动画复杂度，甚至切成“弱图形 + 强讲解”模式

而不是所有题都统一继续。

---

## 7. debug 输出很多，但缺少统一诊断结构

当前代码会写很多 debug 文件，例如：

* `vision_bundle_raw_response.txt`
* `vision_ocr_vs_geometry_text_quality.json`
* `problem_text_quality_check.json`
* `vision_problem_text_fallback.txt`
* `vision_geometry_facts_fallback.txt` 

### 问题

这些文件很多是有价值的，但比较散。

排查一个问题时，往往想知道的是：

* 模型原始输出是什么
* 最终选了哪个 OCR 文本
* 哪些 geometry facts 被删了
* 哪些是从文本补进去的
* 为什么 coordinate_scene 失败
* 最终用了哪一级 fallback

当前这些信息分散在不同 debug 文件和 metadata 里，不够集中。

### 建议

新增一个统一的 `vision_diagnostic_report.json`，把关键诊断信息一次写全。
这不会增加算法复杂度，但会极大方便排查。

---

## 8. 一些函数默认吞异常，调试体验不好

比如：

* `_compile_geometry_spec()` 失败直接返回空结构
* `_write_debug_text()` 直接 `except Exception: pass`
* 部分 fallback 也是只兜底不暴露原因 

### 问题

在生产环境里吞异常能保流程，但开发期会让你很难定位根因。

### 建议

至少区分两种模式：

* `dev/debug mode`：异常写详细日志
* `prod mode`：继续兜底，但记录错误摘要

否则“为什么 spec 空了”这种问题会很难查。

---

## 9. token 规范化规则比较散，后续容易出边界 bug

现在有很多 normalize：

* `_normalize_point_token`
* `_normalize_segment_token`
* `_normalize_polygon_token`
* `_normalize_circle_center_token`
* `_normalize_circle_id`
* `_normalize_angle_name`
* `_normalize_prime_markers` 

### 问题

这说明“命名规范化”已经是一个核心问题了。
但现在它还是分散函数式实现。

随着题型变复杂，很可能出现：

* `C1`、`C'`、`C''`
* `O1`
* `A1B1`
* 带下标、带 prime、多字符点名

这些边界情况越来越难控。

### 建议

把 token normalization 单独抽成一个小模块，统一负责：

* 点名合法性
* 线段解析
* 角名解析
* prime / subscript 兼容
* 大小写规则

这样以后改命名规则不会到处改。

---

## 10. 性能上有重复调用和重复处理空间

这段代码为了稳，做了不少重复检查和 fallback。
但这也意味着额外耗时。

例如：

* `_analyze_problem_bundle()` 后又可能 OCR fallback
* `_stabilize_problem_bundle()` 中又可能再做 problem text fallback
* geometry facts 空时又再次 geometry fallback
* 坐标失败后还会再建 semantic/drawable scene 

### 问题

逻辑上合理，但会让 Vision 阶段比较重。

### 建议

可以加一个更明确的“停止条件”：

例如如果：

* `problem_text` 质量已经高于某阈值
* `geometry_facts` bucket 已经够全
* spec 编译质量高

那就不要再触发额外升级和兜底。

这不是加复杂度，而是减少重复工作。

---

# 我认为最值得优先改的 5 点

如果只挑最值的，我会这样排：

## 1

**拆分 `process()`，降低主流程耦合**

## 2

**把 fallback 等级显式化，不要只是在 metadata 里悄悄降级**

## 3

**把“文本补强得到的推理关系”和“视觉直接识别关系”分开存**

## 4

**限制 semantic signals 的动作推荐，不要见特征就加动作**

## 5

**给 schematic fallback 增加题型适用约束，避免误导性几何图**

---

# 一句话总结

这段代码现在最大的问题不是“不能用”，而是：

**识别、推理、补全、降级、布局这几件事混得太紧，导致系统虽然很能兜底，但质量边界不清，后续也不太好维护。** 

你要的话，我下一条可以继续直接给你写成更实用的形式：
**“VisionAgent 重构建议清单（尽量不增加复杂度版）”**。
