import numpy as np
from manim import *

FONT = "Microsoft YaHei"  # 如果报字体问题，可改成 SimHei 或 Noto Sans CJK SC


class ProveDEEqualsDF(Scene):
    def construct(self):
        self.camera.background_color = "#FAFAFA"

        # =========================
        # 1. 数学坐标
        # =========================
        # 构造一个等腰三角形：
        # B=(-a,0), C=(a,0), A=(0,h)
        a = 3.0
        h = 4.0
        k = 0.5  # BE / AB = CF / AC

        A = np.array([0.0, h])
        B = np.array([-a, 0.0])
        C = np.array([a, 0.0])

        # E 在 AB 上，BE = k * AB
        E = B + k * (A - B)

        # F 在 AC 的延长线上，CF = k * AC
        # C -> F 的方向与 A -> C 相同
        F = C + k * (C - A)

        # EF 的中点
        D = (E + F) / 2

        # =========================
        # 2. 坐标映射到画面左侧
        # =========================
        scale = 0.72
        offset = np.array([-4.2, -0.8, 0.0])

        def q(p):
            return np.array([p[0] * scale, p[1] * scale, 0]) + offset

        def label(tex, point, direction=UP, buff=0.08, size=30, color=BLACK):
            return MathTex(tex, font_size=size, color=color).next_to(
                q(point), direction, buff=buff
            )

        def small_tick(p1, p2, color=BLUE_E, length=0.18):
            """在线段 p1p2 的中点处画一个小刻痕"""
            p1 = q(p1)
            p2 = q(p2)
            mid = (p1 + p2) / 2
            v = p2 - p1
            v = v / np.linalg.norm(v)
            n = np.array([-v[1], v[0], 0])
            return Line(
                mid - n * length / 2, mid + n * length / 2, color=color, stroke_width=4
            )

        def double_tick(p1, p2, color=RED_E):
            """两条刻痕，用来表示 BE = CF"""
            p1m = q(p1)
            p2m = q(p2)
            mid = (p1m + p2m) / 2
            v = p2m - p1m
            v = v / np.linalg.norm(v)
            n = np.array([-v[1], v[0], 0])
            gap = 0.07
            length = 0.16

            tick1 = Line(
                mid - v * gap - n * length / 2,
                mid - v * gap + n * length / 2,
                color=color,
                stroke_width=4,
            )
            tick2 = Line(
                mid + v * gap - n * length / 2,
                mid + v * gap + n * length / 2,
                color=color,
                stroke_width=4,
            )
            return VGroup(tick1, tick2)

        # =========================
        # 3. 标题
        # =========================
        title = Text(
            "等腰三角形中的线段相等证明", font=FONT, font_size=34, color=BLACK
        ).to_edge(UP)

        self.play(Write(title))

        # =========================
        # 4. 左侧几何图形
        # =========================
        AB = Line(q(A), q(B), color=BLACK, stroke_width=4)
        BC = Line(q(B), q(C), color=BLACK, stroke_width=4)
        AC = Line(q(A), q(C), color=BLACK, stroke_width=4)
        CF = Line(q(C), q(F), color=BLACK, stroke_width=4)
        EF = Line(q(E), q(F), color=BLACK, stroke_width=4)

        dots = VGroup(
            Dot(q(A), color=BLACK),
            Dot(q(B), color=BLACK),
            Dot(q(C), color=BLACK),
            Dot(q(D), color=BLACK),
            Dot(q(E), color=BLACK),
            Dot(q(F), color=BLACK),
        )

        labels = VGroup(
            label("A", A, UP),
            label("B", B, DOWN + LEFT),
            label("C", C, RIGHT),
            label("D", D, DOWN),
            label("E", E, LEFT),
            label("F", F, DOWN + RIGHT),
        )

        self.play(Create(AB), Create(BC), Create(AC))
        self.play(Create(CF), Create(EF))
        self.play(FadeIn(dots), Write(labels))

        # =========================
        # 5. 标出已知条件 AB=AC
        # =========================
        AB_highlight = Line(q(A), q(B), color=BLUE_E, stroke_width=7).set_opacity(0.55)
        AC_highlight = Line(q(A), q(C), color=BLUE_E, stroke_width=7).set_opacity(0.55)

        tick_ab = small_tick(A, B, color=BLUE_E)
        tick_ac = small_tick(A, C, color=BLUE_E)

        known1 = Text("已知：AB = AC", font=FONT, font_size=26, color=BLUE_E).next_to(
            q(A), UP, buff=0.55
        )

        self.play(Create(AB_highlight), Create(AC_highlight))
        self.play(Create(tick_ab), Create(tick_ac), Write(known1))

        # =========================
        # 6. 标出已知条件 BE=CF
        # =========================
        BE_highlight = Line(q(B), q(E), color=RED_E, stroke_width=8).set_opacity(0.55)
        CF_highlight = Line(q(C), q(F), color=RED_E, stroke_width=8).set_opacity(0.55)

        tick_be = double_tick(B, E, color=RED_E)
        tick_cf = double_tick(C, F, color=RED_E)

        known2 = Text("已知：BE = CF", font=FONT, font_size=26, color=RED_E).next_to(
            q(F), RIGHT, buff=0.35
        )

        self.play(Create(BE_highlight), Create(CF_highlight))
        self.play(Create(tick_be), Create(tick_cf), Write(known2))

        # =========================
        # 7. 右侧公式区
        # =========================
        panel = RoundedRectangle(
            width=6.0,
            height=6.3,
            corner_radius=0.18,
            stroke_color=GREY_B,
            stroke_width=1.5,
            fill_color=WHITE,
            fill_opacity=0.92,
        ).move_to(np.array([3.1, -0.15, 0]))

        panel_title = Text("坐标法证明", font=FONT, font_size=28, color=BLACK)

        f1 = MathTex(r"B=(-a,0),\quad C=(a,0),\quad A=(0,h)", font_size=27, color=BLACK)

        f2 = MathTex(r"AB=AC=\ell,\quad BE=CF=s", font_size=28, color=BLACK)

        f3 = MathTex(r"k=\frac{s}{\ell}", font_size=31, color=BLACK)

        f4 = MathTex(r"E=B+k(A-B)", font_size=28, color=BLACK)

        f5 = MathTex(r"E=(-a+ka,\ kh)", font_size=28, color=BLACK)

        f6 = MathTex(r"F=C+k(C-A)", font_size=28, color=BLACK)

        f7 = MathTex(r"F=(a+ka,\ -kh)", font_size=28, color=BLACK)

        f8 = MathTex(r"M=\frac{E+F}{2}=(ka,\ 0)", font_size=31, color=BLACK)

        f9 = MathTex(r"M\in BC,\quad M\in EF", font_size=29, color=BLACK)

        f10 = MathTex(r"D=EF\cap BC\Rightarrow D=M", font_size=29, color=BLACK)

        f11 = MathTex(r"\therefore\ DE=DF", font_size=38, color=RED_E)

        formulas = VGroup(
            panel_title, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.13)

        formulas.move_to(panel.get_center())
        formulas.shift(UP * 0.05)

        self.play(FadeIn(panel))
        self.play(Write(panel_title))
        self.play(Write(f1))

        # =========================
        # 8. 展示“摆正坐标系”
        # =========================
        x_axis = DashedLine(
            q(np.array([-3.5, 0.0])),
            q(np.array([5.0, 0.0])),
            color=GREY_B,
            stroke_width=2,
        )

        y_axis = DashedLine(
            q(np.array([0.0, -0.5])),
            q(np.array([0.0, 4.5])),
            color=GREY_B,
            stroke_width=2,
        )

        x_label = MathTex("x", font_size=24, color=GREY_B).next_to(
            x_axis, RIGHT, buff=0.05
        )
        y_label = MathTex("y", font_size=24, color=GREY_B).next_to(
            y_axis, UP, buff=0.05
        )

        self.play(Create(x_axis), Create(y_axis), Write(x_label), Write(y_label))

        self.play(Write(f2), Write(f3))

        # =========================
        # 9. 推出 E、F 坐标
        # =========================
        E_glow = Dot(q(E), radius=0.08, color=RED_E)
        F_glow = Dot(q(F), radius=0.08, color=RED_E)

        self.play(Indicate(E_glow), Write(f4))
        self.play(Write(f5))

        self.play(Indicate(F_glow), Write(f6))
        self.play(Write(f7))

        # =========================
        # 10. 展示 D 是 EF 中点
        # =========================
        midpoint_dot = Dot(q(D), radius=0.09, color=GREEN_E)
        midpoint_label = MathTex("M", font_size=30, color=GREEN_E).next_to(
            q(D), UP, buff=0.12
        )

        ED_green = Line(q(E), q(D), color=GREEN_E, stroke_width=7).set_opacity(0.65)
        DF_green = Line(q(D), q(F), color=GREEN_E, stroke_width=7).set_opacity(0.65)

        tick_ed = small_tick(E, D, color=GREEN_E)
        tick_df = small_tick(D, F, color=GREEN_E)

        self.play(Write(f8))
        self.play(FadeIn(midpoint_dot), Write(midpoint_label))
        self.play(Write(f9), Write(f10))

        self.play(Create(ED_green), Create(DF_green))
        self.play(Create(tick_ed), Create(tick_df))

        # 把 M 标签变成 D=M
        dm_label = MathTex("D=M", font_size=30, color=GREEN_E).next_to(
            q(D), UP, buff=0.12
        )

        self.play(Transform(midpoint_label, dm_label))
        self.play(Write(f11))

        # =========================
        # 11. 最终结论
        # =========================
        conclusion = Text(
            "因为 D 是 EF 的中点，所以 DE = DF", font=FONT, font_size=30, color=RED_E
        ).next_to(panel, DOWN, buff=0.2)

        self.play(Write(conclusion))
        self.wait(2)
