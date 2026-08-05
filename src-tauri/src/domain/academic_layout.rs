//! 论文排版参数。
//!
//! 导出（生成 docx 样式）、设置页表单和排版预览三处共用同一份取值，避免出现
//! 「预览和导出对不上」这种最难排查的不一致。
//!
//! OOXML 的单位很反直觉，全部换算集中在本文件，且都有测试：
//! - `w:sz` / `w:szCs` 是**半磅**，小四（12pt）写作 24
//! - `w:line` 配 `w:lineRule="auto"` 时 240 表示单倍行距，1.5 倍写作 360
//! - `w:ind` / `w:pgMar` 是**缇**（twip，1/20 磅，1 英寸 = 1440）

use serde::{Deserialize, Serialize};

/// 一磅等于多少缇。
const TWIPS_PER_POINT: f32 = 20.0;
/// 一英寸等于多少缇。
const TWIPS_PER_INCH: f32 = 1440.0;
/// 一英寸等于多少毫米。
const MM_PER_INCH: f32 = 25.4;
/// `w:lineRule="auto"` 下表示单倍行距的基准值。
const SINGLE_LINE: f32 = 240.0;

/// 磅 → 半磅（`w:sz`）。
pub fn points_to_half_points(points: f32) -> u32 {
    (points * 2.0).round().max(1.0) as u32
}

/// 磅 → 缇。
pub fn points_to_twips(points: f32) -> u32 {
    (points * TWIPS_PER_POINT).round().max(0.0) as u32
}

/// 毫米 → 缇。
pub fn mm_to_twips(mm: f32) -> u32 {
    (mm / MM_PER_INCH * TWIPS_PER_INCH).round().max(0.0) as u32
}

/// 行距倍数 → `w:line`（配 `w:lineRule="auto"`）。
pub fn line_height_to_line(multiplier: f32) -> u32 {
    (multiplier * SINGLE_LINE).round().max(1.0) as u32
}

/// 字符数 → 缇。一个「字符」按给定字号的一个全角汉字宽度算，即等于字号本身。
pub fn chars_to_twips(chars: f32, font_points: f32) -> u32 {
    points_to_twips(chars * font_points)
}

/// 纸张。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PaperSize {
    A4,
    Letter,
}

impl PaperSize {
    /// 返回 (宽, 高)，单位缇。
    pub fn dimensions_twips(self) -> (u32, u32) {
        match self {
            // 210 × 297 mm
            PaperSize::A4 => (11906, 16838),
            // 8.5 × 11 in
            PaperSize::Letter => (12240, 15840),
        }
    }
}

/// 论文排版的可调参数。默认值即当前内置模板的排版。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicLayout {
    /// 正文字号，磅。默认 12（小四）。
    pub body_font_pt: f32,
    /// 正文行距倍数。默认 1.5。
    pub body_line_height: f32,
    /// 首行缩进，以正文字号的字符数计。默认 2。
    pub first_line_indent_chars: f32,
    /// 四周页边距，毫米。默认 25。
    pub margin_mm: f32,
    pub paper: PaperSize,
    /// 题名字号，磅。默认 18（小二）。
    pub title_font_pt: f32,
    /// 一至六级标题字号，磅。默认 16/14/12/12/12/12。
    pub heading_font_pt: [f32; 6],
    /// 图表题注字号，磅。默认 10.5（五号）。
    pub caption_font_pt: f32,
    /// 参考文献字号，磅。默认 10.5（五号）。
    pub bibliography_font_pt: f32,
    /// 表格使用三线表边框。
    pub three_line_table: bool,
    /// 页脚居中显示页码。
    pub page_number_footer: bool,
    /// 代码块加边框。默认关闭——这是新加的一项，开着的话会改变所有已有
    /// 用户导出结果的观感，所以默认值必须是 false 才能让黄金哈希测试
    /// （见 pandoc.rs 的 academic_styles_output_is_unchanged_for_default_layout）
    /// 继续证明"默认排版下的重构不改变输出"。
    pub code_block_bordered: bool,
}

impl Default for AcademicLayout {
    fn default() -> Self {
        Self {
            body_font_pt: 12.0,
            body_line_height: 1.5,
            first_line_indent_chars: 2.0,
            margin_mm: 25.0,
            paper: PaperSize::A4,
            title_font_pt: 18.0,
            heading_font_pt: [16.0, 14.0, 12.0, 12.0, 12.0, 12.0],
            caption_font_pt: 10.5,
            bibliography_font_pt: 10.5,
            three_line_table: true,
            page_number_footer: true,
            code_block_bordered: false,
        }
    }
}

impl AcademicLayout {
    /// 正文字号的半磅值。
    pub fn body_size(&self) -> u32 {
        points_to_half_points(self.body_font_pt)
    }

    /// 正文行距的 `w:line` 值。
    pub fn body_line(&self) -> u32 {
        line_height_to_line(self.body_line_height)
    }

    /// 首行缩进的缇值。
    pub fn first_line_indent(&self) -> u32 {
        chars_to_twips(self.first_line_indent_chars, self.body_font_pt)
    }

    /// 页边距的缇值。
    pub fn margin(&self) -> u32 {
        mm_to_twips(self.margin_mm)
    }

    pub fn title_size(&self) -> u32 {
        points_to_half_points(self.title_font_pt)
    }

    /// 1–6 级标题的半磅字号；越界时退回正文字号。
    ///
    /// 用 `checked_sub` 而不是 `saturating_sub`：后者会把非法的 0 级映射成
    /// 索引 0，也就是悄悄当成一级标题。
    pub fn heading_size(&self, level: usize) -> u32 {
        points_to_half_points(
            level
                .checked_sub(1)
                .and_then(|index| self.heading_font_pt.get(index))
                .copied()
                .unwrap_or(self.body_font_pt),
        )
    }

    pub fn caption_size(&self) -> u32 {
        points_to_half_points(self.caption_font_pt)
    }

    pub fn bibliography_size(&self) -> u32 {
        points_to_half_points(self.bibliography_font_pt)
    }

    /// 参考文献的悬挂缩进。按正文字号算，与首行缩进保持视觉一致。
    pub fn bibliography_hanging(&self) -> u32 {
        chars_to_twips(2.0, self.body_font_pt)
    }

    /// 把越界的取值收回可用范围。设置来自用户输入（含手改配置文件），
    /// 不能直接信任——尤其字号，写进 XML 前必须是个合理的正数。
    pub fn sanitize(&mut self) {
        self.body_font_pt = self.body_font_pt.clamp(6.0, 36.0);
        self.body_line_height = self.body_line_height.clamp(1.0, 3.0);
        self.first_line_indent_chars = self.first_line_indent_chars.clamp(0.0, 8.0);
        self.margin_mm = self.margin_mm.clamp(5.0, 60.0);
        self.title_font_pt = self.title_font_pt.clamp(6.0, 72.0);
        for size in &mut self.heading_font_pt {
            *size = size.clamp(6.0, 48.0);
        }
        self.caption_font_pt = self.caption_font_pt.clamp(6.0, 24.0);
        self.bibliography_font_pt = self.bibliography_font_pt.clamp(6.0, 24.0);
    }

    /// 是否已经落在 `sanitize` 允许的范围内。
    ///
    /// 故意不重复一份边界字面量：真出现两处判断悄悄漂移，比多一次
    /// clone+比较的开销更难发现。
    pub fn is_valid(&self) -> bool {
        let mut sanitized = self.clone();
        sanitized.sanitize();
        &sanitized == self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_conversions_match_the_ooxml_definitions() {
        // 小四 = 12pt -> w:sz="24"
        assert_eq!(points_to_half_points(12.0), 24);
        // 五号 = 10.5pt -> 21，半磅制正好能表示
        assert_eq!(points_to_half_points(10.5), 21);
        // 1.5 倍行距 -> w:line="360"
        assert_eq!(line_height_to_line(1.5), 360);
        assert_eq!(line_height_to_line(1.0), 240);
        // 2.5cm -> 1417 twips（1 英寸 = 1440 缇 = 25.4mm）
        assert_eq!(mm_to_twips(25.0), 1417);
        // 两个 12pt 汉字符 -> 480 缇
        assert_eq!(chars_to_twips(2.0, 12.0), 480);
    }

    #[test]
    fn default_layout_reproduces_the_current_template_values() {
        // 这些是重构前写死在 patch_academic_styles_xml 里的字面量。
        let layout = AcademicLayout::default();
        assert_eq!(layout.body_size(), 24);
        assert_eq!(layout.body_line(), 360);
        assert_eq!(layout.first_line_indent(), 480);
        assert_eq!(layout.margin(), 1417);
        assert_eq!(layout.title_size(), 36);
        assert_eq!(layout.heading_size(1), 32);
        assert_eq!(layout.heading_size(2), 28);
        assert_eq!(layout.heading_size(3), 24);
        assert_eq!(layout.heading_size(6), 24);
        assert_eq!(layout.caption_size(), 21);
        assert_eq!(layout.bibliography_size(), 21);
        assert_eq!(layout.bibliography_hanging(), 480);
        assert_eq!(layout.paper.dimensions_twips(), (11906, 16838));
    }

    #[test]
    fn heading_level_out_of_range_falls_back_to_body() {
        let layout = AcademicLayout::default();
        assert_eq!(layout.heading_size(0), layout.body_size());
        assert_eq!(layout.heading_size(9), layout.body_size());
    }

    #[test]
    fn default_layout_is_valid() {
        assert!(AcademicLayout::default().is_valid());
    }

    /// 锁死 PaperSize 的 JSON 表示——TS 那边的 `PaperSize` 联合类型字面量是照抄
    /// 这两个字符串写的，`rename_all` 换了写法或者有人手滑改成别的 rename
    /// 都不会在 Rust 侧编译报错，只会在前端悄悄收到一个它不认识的值。
    #[test]
    fn paper_size_serializes_to_the_strings_the_frontend_expects() {
        assert_eq!(serde_json::to_string(&PaperSize::A4).unwrap(), "\"a4\"");
        assert_eq!(
            serde_json::to_string(&PaperSize::Letter).unwrap(),
            "\"letter\""
        );
    }

    #[test]
    fn sanitize_pulls_out_of_range_values_back() {
        let mut layout = AcademicLayout {
            body_font_pt: 900.0,
            body_line_height: 0.1,
            margin_mm: -5.0,
            heading_font_pt: [0.0, 900.0, 12.0, 12.0, 12.0, 12.0],
            ..AcademicLayout::default()
        };
        assert!(!layout.is_valid());
        layout.sanitize();
        assert_eq!(layout.body_font_pt, 36.0);
        assert_eq!(layout.body_line_height, 1.0);
        assert_eq!(layout.margin_mm, 5.0);
        assert_eq!(layout.heading_font_pt[0], 6.0);
        assert_eq!(layout.heading_font_pt[1], 48.0);
        assert!(layout.is_valid());
    }
}
