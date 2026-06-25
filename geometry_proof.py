import numpy as np
from manim import *


class GeometryProofSplitScreen(Scene):
    def construct(self):
        # ------------------- 1. 场景初始化与布局 -------------------
        # 标题
        title = Text("求证: DE = DF", font_size=40, color=YELLOW).to_edge(UP)
        self.play(Write(title))
        self.wait(0.5)

        # 定义左右区域
        left_zone = VGroup().shift(LEFT * 3.5).scale(0.9)  # 左侧放图
        right_zone = VGroup().shift(RIGHT * 2.5)  # 右侧放字

        # ------------------- 2. 几何坐标计算 -------------------
        # 定义基础点
        A = np.array([0, 2.5, 0])
        B = np.array([-2, -1.5, 0])
        C = np.array([2, -1.5, 0])

        # 计算 E (在 AB 上)
        vec_BA = A - B
        len_BA = np.linalg.norm(vec_BA)
        # 假设 BE 长度约为 AB 的 1/3
        E = B + (vec_BA / len_BA) * (len_BA / 3)

        # 计算 F (在 AC 延长线上，满足 CF = BE)
        vec_AC = C - A
        len_AC = np.linalg.norm(vec_AC)
        unit_vec_AC = vec_AC / len_AC
        target_len = len_BA / 3  # CF = BE
        F = C + unit_vec_AC * target_len

        # 计算 D (EF 与 BC 的交点)
        # BC 在 y = -1.5 直线上
        t = (E[1] - (-1.5)) / (E[1] - F[1])
        D_x = E[0] + t * (F[0] - E[0])
        D = np.array([D_x, -1.5, 0])

        # 计算辅助点 G (过 E 作 EG // AC 交 BC 于 G)
        # 利用相似比或向量计算
        # 因为 EG // AC，所以 △EBG ~ △ABC
        ratio = np.linalg.norm(E - B) / np.linalg.norm(A - B)
        G = B + (C - B) * ratio

        # ------------------- 3. 绘制图形元素 -------------------
        # 主三角形 ABC
        triangle_abc = Polygon(A, B, C, color=WHITE, stroke_width=2)

        # 线段 EF
        line_ef = Line(E, F, color=YELLOW, stroke_width=3)

        # 关键点标签
        label_A = MathTex("A").next_to(A, UP, buff=0.1)
        label_B = MathTex("B").next_to(B, LEFT, buff=0.1)
        label_C = MathTex("C").next_to(C, RIGHT, buff=0.1)
        label_E = MathTex("E").next_to(E, LEFT, buff=0.1)
        label_F = MathTex("F").next_to(F, DOWN, buff=0.1)
        label_D = MathTex("D").next_to(D, DOWN, buff=0.1)

        # 组合左侧图形
        left_group = VGroup(
            triangle_abc, line_ef, label_A, label_B, label_C, label_E, label_F, label_D
        )
        left_group.move_to(left_zone.get_center())

        # 播放左侧入场
        self.play(Create(triangle_abc), Write(VGroup(label_A, label_B, label_C)))
        self.play(Create(line_ef), Write(VGroup(label_E, label_F, label_D)))
        self.wait(0.5)

        # ------------------- 4. 证明过程 (图文同步) -------------------

        # --- 步骤 1: 已知条件 ---
        text_1 = Text("已知: AB=AC, BE=CF", font_size=28, color=WHITE).next_to(
            right_zone, UP, aligned_edge=UP
        )
        self.play(Write(text_1))
        self.wait(1)

        # --- 步骤 2: 作辅助线 ---
        text_2 = Text(
            "作辅助线: 过 E 作 EG // AC 交 BC 于 G", font_size=26, color=WHITE
        )
        text_2.next_to(text_1, DOWN, buff=0.5, aligned_edge=LEFT)

        aux_line = Line(E, G, color=RED, stroke_width=2.5)
        label_G = MathTex("G", color=RED).next_to(G, DOWN, buff=0.1)

        self.play(Write(text_2))
        self.play(Create(aux_line), Write(label_G), run_time=1.5)
        self.wait(1)

        # --- 步骤 3: 导角 (等腰三角形性质) ---
        text_3 = VGroup(
            Tex("$\\because AB=AC \\Rightarrow \\angle B = \\angle ACB$", font_size=26),
            Tex(
                "$\\because EG \\parallel AC \\Rightarrow \\angle EGB = \\angle ACB$",
                font_size=26,
            ),
            Tex(
                "$\\therefore \\angle B = \\angle EGB \\Rightarrow EB=EG$",
                font_size=26,
                color=YELLOW,
            ),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
        text_3.next_to(text_2, DOWN, buff=0.5, aligned_edge=LEFT)

        # 高亮相关的角 (示意)
        angle_B = Arc(
            radius=0.3, start_angle=0, angle=PI / 3, color=BLUE
        ).move_arc_center_to(B)
        angle_C = Arc(
            radius=0.3, start_angle=2 * PI / 3, angle=PI / 3, color=BLUE
        ).move_arc_center_to(C)
        angle_G = Arc(
            radius=0.3, start_angle=2 * PI / 3, angle=PI / 3, color=GREEN
        ).move_arc_center_to(G)

        self.play(Write(text_3))
        self.play(Create(angle_B), Create(angle_C), run_time=1)
        self.play(Transform(angle_C.copy(), angle_G), run_time=1)  # 视觉暗示角相等
        self.wait(1)

        # --- 步骤 4: 边长代换 ---
        text_4 = Text("因为 BE=CF (已知), 所以 EG=CF", font_size=26, color=RED)
        text_4.next_to(text_3, DOWN, buff=0.5, aligned_edge=LEFT)

        # 高亮 EG 和 CF
        highlight_EG = Line(E, G, color=RED, stroke_width=6).set_opacity(0.5)
        highlight_CF = Line(C, F, color=RED, stroke_width=6).set_opacity(0.5)

        self.play(Write(text_4))
        self.play(Create(highlight_EG), Create(highlight_CF))
        self.wait(1)
        self.play(
            FadeOut(highlight_EG),
            FadeOut(highlight_CF),
            FadeOut(angle_B),
            FadeOut(angle_G),
        )

        # --- 步骤 5: 全等证明 ---
        text_5 = VGroup(
            Text("在三角形 EDG 和三角形 FDC 中:", font_size=26, color=WHITE),
            Text("∠EDG = ∠FDC (对顶角)", font_size=24, color=WHITE),
            Text("∠DEG = ∠DFC (内错角)", font_size=24, color=WHITE),
            Text("EG = CF (已证)", font_size=24, color=WHITE),
            Text("所以 △EDG ≌ △FDC (AAS)", font_size=26, color=YELLOW),
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.2)
        text_5.next_to(text_4, DOWN, buff=0.5, aligned_edge=LEFT)

        # 高亮两个小三角形
        tri_left = Polygon(E, D, G, color=ORANGE, fill_opacity=0.3, stroke_width=2)
        tri_right = Polygon(F, D, C, color=ORANGE, fill_opacity=0.3, stroke_width=2)

        self.play(Write(text_5))
        self.play(Create(tri_left), Create(tri_right), run_time=1.5)
        self.wait(2)

        # --- 步骤 6: 结论 ---
        conclusion = Tex("$\\therefore DE = DF$", font_size=40, color=GREEN)
        conclusion.next_to(text_5, DOWN, buff=0.8)

        # 加粗最终的线段 DE 和 DF
        final_DE = Line(D, E, color=GREEN, stroke_width=5)
        final_DF = Line(D, F, color=GREEN, stroke_width=5)

        self.play(Write(conclusion))
        self.play(Create(final_DE), Create(final_DF), run_time=1)

        self.wait(3)
