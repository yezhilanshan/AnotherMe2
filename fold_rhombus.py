from math import sqrt

import numpy as np
from manim import *

# 中文字体。Windows 下通常可用 Microsoft YaHei
# 若报字体错误，可改成 "SimHei" 或 "Noto Sans CJK SC"
FONT = "Microsoft YaHei"


class FoldRhombusExplanation(Scene):
    def construct(self):
        self.camera.background_color = "#FAFAFA"

        # =========================
        # 1. 建立几何坐标
        # =========================
        rt5 = sqrt(5)

        # 令 BC 为 x 轴，B=(0,0)，BC=AD=5
        B = np.array([0.0, 0.0])
        C = np.array([5.0, 0.0])

        # tanB=2，所以方向向量可取 (1,2)，单位化后乘边长 5
        A = np.array([rt5, 2 * rt5])
        D = np.array([5 + rt5, 2 * rt5])

        # 由 ∠BEB'=90° 解得 E 在 AB 上的位置
        t = 1 - rt5 / 5
        E = t * A

        # 折叠后 B、C 关于直线 DE 的对称点
        Bp = np.array([1 - rt5, 3 * rt5 - 3])
        Cp = np.array([5 - rt5, 3 * rt5])

        # C' 到 BC 的垂足
        F = np.array([Cp[0], 0.0])

        # =========================
        # 2. 坐标映射到 Manim 画布
        # =========================
        scale = 0.58
        offset_x = -5.25
        offset_y = -1.25

        def q(p):
            return np.array([offset_x + scale * p[0], offset_y + scale * p[1], 0])

        def make_label(tex, point, direction=UP, buff=0.08, size=28, color=BLACK):
            return MathTex(tex, font_size=size, color=color).next_to(
                q(point), direction, buff=buff
            )

        def right_angle_marker(vertex, p1, p2, size=0.18, color=YELLOW_D):
            """
            在 vertex 处画直角标记。
            vertex, p1, p2 都是 Manim 坐标。
            """
            u1 = p1 - vertex
            u2 = p2 - vertex
            u1 = u1 / np.linalg.norm(u1)
            u2 = u2 / np.linalg.norm(u2)

            a = vertex + size * u1
            b = vertex + size * u1 + size * u2
            c = vertex + size * u2

            marker = VMobject(color=color, stroke_width=3)
            marker.set_points_as_corners([a, b, c])
            return marker

        # =========================
        # 3. 标题
        # =========================
        title = Text(
            "菱形折叠问题：求 C' 到 BC 的距离", font=FONT, font_size=34, color=BLACK
        ).to_edge(UP)

        self.play(Write(title))

        # =========================
        # 4. 左侧图形
        # =========================
        rhombus = Polygon(
            q(A), q(B), q(C), q(D), stroke_color=BLACK, stroke_width=3, fill_opacity=0
        )

        fixed_part = Polygon(
            q(A),
            q(E),
            q(D),
            stroke_color=BLUE_E,
            stroke_width=3,
            fill_color=BLUE_B,
            fill_opacity=0.12,
        )

        fold_part_before = Polygon(
            q(E),
            q(B),
            q(C),
            q(D),
            stroke_color=ORANGE,
            stroke_width=3,
            fill_color=ORANGE,
            fill_opacity=0.22,
        )

        fold_part_after = Polygon(
            q(E),
            q(Bp),
            q(Cp),
            q(D),
            stroke_color=ORANGE,
            stroke_width=3,
            fill_color=ORANGE,
            fill_opacity=0.22,
        )

        crease = Line(q(E), q(D), color=RED, stroke_width=4)

        # 点
        dot_A = Dot(q(A), radius=0.045, color=BLACK)
        dot_B = Dot(q(B), radius=0.045, color=BLACK)
        dot_C = Dot(q(C), radius=0.045, color=BLACK)
        dot_D = Dot(q(D), radius=0.045, color=BLACK)
        dot_E = Dot(q(E), radius=0.045, color=RED)

        # 标签
        label_A = make_label("A", A, UP)
        label_B = make_label("B", B, DOWN)
        label_C = make_label("C", C, DOWN)
        label_D = make_label("D", D, RIGHT)
        label_E = make_label("E", E, LEFT, color=RED)

        self.play(
            Create(rhombus),
            FadeIn(dot_A, dot_B, dot_C, dot_D),
            Write(label_A),
            Write(label_B),
            Write(label_C),
            Write(label_D),
        )

        self.play(
            FadeIn(dot_E),
            Write(label_E),
            Create(crease),
        )

        self.play(FadeIn(fixed_part), FadeIn(fold_part_before))

        # =========================
        # 5. 右侧公式区
        # =========================
        panel = RoundedRectangle(
            width=5.95,
            height=6.35,
            corner_radius=0.18,
            stroke_color=GREY_B,
            stroke_width=1.5,
            fill_color=WHITE,
            fill_opacity=0.92,
        ).move_to(np.array([3.1, -0.05, 0]))

        panel_title = Text("坐标化求解", font=FONT, font_size=27, color=BLACK)

        f1 = MathTex(
            r"\tan B=2\Rightarrow"
            r"\cos B=\frac{1}{\sqrt5},\ "
            r"\sin B=\frac{2}{\sqrt5}",
            font_size=27,
            color=BLACK,
        )

        f2 = MathTex(r"B=(0,0),\quad C=(5,0)", font_size=27, color=BLACK)

        f3 = MathTex(
            r"A=(\sqrt5,2\sqrt5),\quad "
            r"D=(5+\sqrt5,2\sqrt5)",
            font_size=26,
            color=BLACK,
        )

        f4 = MathTex(r"E=tA=(t\sqrt5,2t\sqrt5)", font_size=27, color=BLACK)

        f5 = MathTex(
            r"\angle BEB'=90^\circ"
            r"\Rightarrow (B-E)\cdot(B'-E)=0",
            font_size=25,
            color=BLACK,
        )

        f6 = MathTex(r"5t^2-(10+2\sqrt5)t+2+2\sqrt5=0", font_size=25, color=BLACK)

        f7 = MathTex(r"t=1-\frac{\sqrt5}{5}", font_size=29, color=BLACK)

        f8 = MathTex(r"C'=(5-\sqrt5,\ 3\sqrt5)", font_size=29, color=BLACK)

        f9 = MathTex(r"d(C',BC)=3\sqrt5", font_size=36, color=RED)

        formulas = VGroup(panel_title, f1, f2, f3, f4, f5, f6, f7, f8, f9).arrange(
            DOWN, aligned_edge=LEFT, buff=0.18
        )

        formulas.move_to(panel.get_center())
        formulas.shift(UP * 0.05)

        self.play(FadeIn(panel))
        self.play(Write(panel_title))
        self.play(Write(f1), Write(f2), Write(f3))
        self.play(Write(f4))

        # =========================
        # 6. 折叠动画：EBCD 关于 DE 翻折
        # =========================
        shadow_original = VGroup(
            DashedLine(q(B), q(C), color=GREY_B, stroke_width=2),
            DashedLine(q(C), q(D), color=GREY_B, stroke_width=2),
            DashedLine(q(B), q(E), color=GREY_B, stroke_width=2),
        )

        label_B_shadow = make_label("B", B, DOWN, color=GREY_B)
        label_C_shadow = make_label("C", C, DOWN, color=GREY_B)

        label_Bp_target = make_label("B'", Bp, LEFT)
        label_Cp_target = make_label("C'", Cp, UP)

        dot_Bp_target = Dot(q(Bp), radius=0.045, color=BLACK)
        dot_Cp_target = Dot(q(Cp), radius=0.045, color=BLACK)

        self.play(
            Transform(fold_part_before, fold_part_after),
            Transform(dot_B, dot_Bp_target),
            Transform(dot_C, dot_Cp_target),
            Transform(label_B, label_Bp_target),
            Transform(label_C, label_Cp_target),
            FadeIn(shadow_original),
            FadeIn(label_B_shadow),
            FadeIn(label_C_shadow),
            run_time=2.3,
        )

        # =========================
        # 7. 展示 ∠BEB'=90°
        # =========================
        EB_line = DashedLine(q(E), q(B), color=GREY_B, stroke_width=2)
        EBp_line = Line(q(E), q(Bp), color=YELLOW_E, stroke_width=4)

        angle_marker = right_angle_marker(q(E), q(B), q(Bp), size=0.23, color=YELLOW_D)

        angle_text = MathTex(r"90^\circ", font_size=24, color=YELLOW_D).next_to(
            angle_marker, LEFT, buff=0.08
        )

        self.play(Create(EB_line), Create(EBp_line))
        self.play(Create(angle_marker), Write(angle_text))
        self.play(Write(f5), Write(f6), Write(f7))

        # =========================
        # 8. 展示 C' 到 BC 的距离
        # =========================
        distance_line = DashedLine(q(Cp), q(F), color=GREEN_E, stroke_width=4)

        foot_marker = right_angle_marker(q(F), q(Cp), q(C), size=0.18, color=GREEN_E)

        distance_label = MathTex(r"3\sqrt5", font_size=30, color=GREEN_E).next_to(
            distance_line, RIGHT, buff=0.1
        )

        foot_label = MathTex(r"H", font_size=24, color=GREEN_E).next_to(
            q(F), DOWN, buff=0.06
        )

        self.play(Write(f8))
        self.play(
            Create(distance_line),
            Create(foot_marker),
            Write(distance_label),
            Write(foot_label),
        )
        self.play(Write(f9))

        answer = Text("答案：D", font=FONT, font_size=34, color=RED).next_to(
            panel, DOWN, buff=0.18
        )

        self.play(Write(answer))
        self.wait(2)
