可以优化，而且空间还不少。
这段代码现在最大的问题不是“功能不够”，而是**职责太多、启发式太重、重复扫描太频繁**，所以会带来三类问题：**慢、难维护、容易误判**。 

我按优先级说。

## 1. 先拆职责，这是最该做的

现在 `CoordinateSceneCompiler` 这个类几乎全包了：

* 输入修复
* 规范化
* 模板推断
* 坐标求解
* 依赖点补全
* 校验
* 导出。  

这会导致后果：

* 一个类过大，后续改一个逻辑容易误伤别处
* 很多 helper 到处共享状态，调试困难
* 模板新增越多，复杂度会继续膨胀

更好的拆法：

* `GeometryNormalizer`
* `TemplateInferer`
* `TemplateSolver`
* `DependentPointResolver`
* `SceneValidator`
* `SceneExporter`

这样做的直接收益不是“看起来更优雅”，而是：

* 每层更容易单测
* 可以单独替换某一层
* 性能分析更清晰，知道慢在哪一段

---

## 2. 最大性能点：减少反复全表扫描

现在很多函数都在反复遍历：

* `spec["constraints"]`
* `spec["measurements"]`
* `spec["primitives"]`
* `spec["points"]`

例如 `_resolve_dependent_points()` 里是多轮迭代，每轮又调用多个函数，而这些函数内部又继续扫全量约束和测量。

像这些函数都属于高频扫描点：

* `_find_length_between()` 每次查长度都扫一遍 measurements。
* `_midpoint_targets()`、`_point_on_segment_targets()`、`_point_on_circle_targets()`、`_intersection_targets()` 都是每次现扫 constraints。
* `_point_neighbors_from_primitives()` 每次查邻接点都扫全部 segments。

### 优化方式

在 `normalize_geometry_spec()` 结束后，顺手建立索引：

* `length_index[frozenset({A,B})] -> value`
* `segment_index[seg_id] -> (A,B)`
* `point_to_segment_constraints[point_id] -> [...]`
* `point_to_circle_constraints[point_id] -> [...]`
* `polygon_index[poly_id] -> points`
* `neighbors[point_id] -> set(...)`

这样很多 O(n) 查找会变成 O(1) 或 O(k)。

### 这类优化最值

因为这段代码后面很可能要批量处理题目，单题多几毫秒没感觉，多题就会明显。

---

## 3. `_resolve_dependent_points()` 建议改成“事件驱动”而不是“多轮盲扫”

现在它是：

* 最多循环 `len(points)+3` 轮
* 每轮依次尝试 midpoint、point_on_segment、point_on_circle、point_in_polygon、point_outside_polygon、parallel endpoint、intersection
* 只要有一点进展就继续下一轮。

这是典型的“能跑，但不够高效”的写法。

### 问题

很多点其实根本还不具备求解条件，但每轮都会被重复检查。

### 更好的做法

改成依赖图/队列机制：

* 每个待解点记录“依赖哪些已知点/图元”
* 当某个点坐标刚被解出时，只唤醒依赖它的那些任务
* 不再每轮全量遍历所有待解点

比如：

* `midpoint(M, AB)` 依赖 A、B
* `intersect(P, seg1, seg2)` 依赖 seg1 两端点、seg2 两端点
* `point_on_circle(Q, circle)` 依赖圆心和半径点

这样会从“重复试错型循环”变成“条件满足即触发”。

这是这段代码最值得做的结构性性能优化。

---

## 4. 模板推断和模板求解要解耦得更彻底

现在 `_infer_templates()` 会根据约束、角度、等长关系推断模板。
然后 `solve_coordinate_scene()` 依次试模板，失败就继续。

### 问题

这是一种“猜模板—试模板”的策略：

* 推断不准，就会白试很多模板
* 某些模板之间有重叠，比如 `generic_triangle`、`isosceles_triangle`、`right_triangle`
* 错误可能来自模板不匹配，不一定来自题目真的无解

### 建议

给模板打分，不要只给列表：

* `right_triangle: 0.92`
* `isosceles_triangle: 0.55`
* `generic_triangle: 0.35`

然后：

* 先试高置信模板
* 低于阈值的不试
* 或者把“严格模板”与“兜底模板”分层

这样能减少无效尝试，也更容易解释为什么会选某个模板。

---

## 5. 现在“修复输入”和“猜拓扑”过重，建议收缩自动修复范围

像 `_repair_raw_geometry_spec()` 和 `_repair_normalized_geometry_spec()` 做了很多自动修复和自动补全。 

尤其 `_augment_triangle_scene_topology()` 很长，里面做了很多启发式判断：

* 猜哪个 polygon 是主三角形
* 猜哪个点在多边形内外
* 自动给 segment 标 primary_edge / construction
* 自动删部分 `point_on_segment` 约束。

### 风险

这类启发式在简单题上很方便，但复杂题很容易“修错”。

### 建议

把自动修复分两级：

* **安全修复**：命名统一、line→segment、缺省 id 补全
* **推断性修复**：自动补 polygon、自动判内外点、自动改 display role

默认只开安全修复，推断性修复交给显式配置开关。

这会显著减少“看起来能跑，但图其实被改歪了”的问题。

---

## 6. 几何关系校验应区分“硬约束”和“软约束”

现在 `validate_coordinate_scene()` 里很多检查失败就直接记为 failed check。

但实际上有些关系是：

* 硬约束：点在线段上、垂直、交点
* 软约束：显示用 angle primitive、某些 inferred topology、默认布局近似关系

### 建议

给约束分级：

* `hard`
* `soft`
* `display_only`

最后报告里分开输出：

* hard fail
* soft mismatch
* unsupported

这样能避免因为一个弱提示没满足，就把整体场景判死。

---

## 7. “模板摆放”应升级成“初值 + 局部优化”模式

现在很多 `_solve_xxx()` 本质是直接把点硬放到某个位置，比如：

* 直角三角形固定在坐标轴
* 矩形固定成标准矩形
* 梯形用默认高度和偏移
* 通用四边形用 canonical layout。

这在渲染上可用，但几何一致性不一定最好。

### 更好的方式

模板求解只给一个**初始坐标**，然后做一次轻量局部优化：

目标函数可以包括：

* 长度误差
* 角度误差
* 平行/垂直误差
* 点在线段上误差
* 点在圆上误差

这样你不必一开始就精确求解析解，只要初始化合理，后面让数值优化把图“拉正”。

这一步对复杂题、折叠题、弱约束题会很有帮助。

---

## 8. 对折叠题的支持可以单独抽子模块

你这段代码里已经有一些折叠相关逻辑：

* `reflect_point`
* `_solve_fold_point_on_segment()`
* `_find_reflection_fold_angle()`
* `_is_reflection_pair()`。

但它们现在夹在通用求解流程里。

### 建议

单独做一个 `FoldGeometryResolver`：

* 管理折叠轴
* 镜像点
* 折叠前后角度关系
* 折叠落点计算

因为折叠本质不是普通平面几何的简单子集，它更像“带变换的几何构造”。单独抽出来，后面加动画也更方便。

---

## 9. 缓存 primitive_map / point_lookup，别反复现建

代码里很多地方都在重复构建：

```python
primitive_map = {
    str(item.get("id", "")).strip(): item
    for item in primitives
    if isinstance(item, dict) and item.get("id")
}
```

这种模式出现很多次。  

### 建议

把 `normalized_spec` 和 `resolved_scene` 包成 dataclass / model，对外直接提供：

* `point_map`
* `primitive_map`
* `measurement_index`
* `constraint_index`
* `neighbor_map`

这样不仅更快，而且读代码的人更容易明白数据形态。

---

## 10. unsupported relation 不要静默丢给“大一统失败”

现在像 `equal_angle`、`angle_bisector` 直接返回 `"unsupported"`。

这会有两个问题：

* 用户只知道“验证失败/不支持”，不知道差在哪
* 未来扩展时，容易遗漏

### 建议

做 relation registry：

* 每种 relation 单独注册 validator / solver
* 未支持关系统一报到 registry 层
* 报告里明确列出哪些关系阻断了求解，哪些只是未参与验证

这样扩展新关系时就更自然。

---

## 11. 导出层别耦合在核心编译器里

`export_ggb_commands()`、`write_debug_exports()` 这类属于 exporter，不应该和核心求解强绑。

建议单独拆成：

* `GeoGebraExporter`
* `DebugExporter`
* `SceneGraphExporter`

这样后续你接 Manim、前端 Canvas、SVG、HTML 时，会更顺。

