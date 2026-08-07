//! 定位 docx XML（`styles.xml`/`document.xml`/`theme1.xml`……）里的标签边界，
//! 并按调用方声明的顺序表插入或替换子元素。
//!
//! 只服务于 `commands::pandoc` 里对导出产物做的定点字符串补丁——用真正的
//! [`quick_xml::Reader`] 识别标签边界、自闭合状态、直接子元素，取代手写的
//! `.find(needle)` + "下一个字符是不是 `/` 或空格" 这类猜测，这类猜测在这个
//! 项目里已经两次把子元素顺序搞反过（pBdr 插到 wordWrap/rPr 之后），Word
//! 会因此提示文档需要修复。
//!
//! 刻意不做的事：不把整份 XML 解析成 DOM 再重新序列化写回。改动之外的字节
//! 必须原样保留——`patch_academic_styles_xml` 的黄金哈希测试锁死的正是"默认
//! 排版下输出一个字节都不变"，这是证明重构没有默默改变导出效果的唯一安全网。
//! 所以这里所有函数都只返回"字节区间"，实际改写仍然是调用方对原始字符串做
//! 切片拼接，不经过任何序列化。
//!
//! OOXML 规定同一个父元素下子元素必须按 schema 声明的顺序出现，但这条规则没法
//! 从通用 XML 库里自动获得——那是调用方通过 `order` 参数自己声明的，且只需要
//! 列出这个父元素下实际会被这份代码插入/参照的那几个标签，不必是完整 schema。

use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;
use std::ops::Range;

/// 一个 XML 元素在原始字符串里的位置。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ElementSpan {
    /// 标签名，含命名空间前缀，例如 `"w:pPr"`。
    pub tag: String,
    /// 整个元素（开始标签到结束标签，或整个自闭合标签）的字节区间。
    pub outer: Range<usize>,
    /// 开始标签结束到结束标签开始之间的内容区间。自闭合元素没有内容，这里是
    /// 一个空区间，落在 `outer.end` 之前——即"如果要展开成一对标签，新内容
    /// 该插的位置"。
    pub inner: Range<usize>,
    pub self_closing: bool,
}

/// 在 `xml` 里从头开始找第一个满足 `matches` 的元素；`matches` 收到的是尚未
/// 消费任何字节前的 [`BytesStart`]，可以检查标签名、属性等。
fn scan_for<F>(xml: &str, matches: F) -> Option<ElementSpan>
where
    F: Fn(&BytesStart) -> bool,
{
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    loop {
        let start = reader.buffer_position() as usize;
        match reader.read_event() {
            Ok(Event::Eof) => return None,
            Ok(Event::Empty(e)) if matches(&e) => {
                let end = reader.buffer_position() as usize;
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                return Some(ElementSpan {
                    tag,
                    outer: start..end,
                    inner: end..end,
                    self_closing: true,
                });
            }
            Ok(Event::Start(e)) if matches(&e) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let inner_start = reader.buffer_position() as usize;
                let inner_end = matching_end(&mut reader, &tag)?;
                let outer_end = reader.buffer_position() as usize;
                return Some(ElementSpan {
                    tag,
                    outer: start..outer_end,
                    inner: inner_start..inner_end,
                    self_closing: false,
                });
            }
            Ok(_) => continue,
            Err(_) => return None,
        }
    }
}

/// 从"刚读完某个 Start 事件"的位置继续往后扫，跳过任意深度的嵌套，找到与之
/// 配对的 End 事件，返回它开始的字节偏移（也就是内容区间的结束点）。
fn matching_end(reader: &mut Reader<&[u8]>, tag: &str) -> Option<usize> {
    let mut depth = 0u32;
    loop {
        let before = reader.buffer_position() as usize;
        match reader.read_event() {
            Ok(Event::Eof) => return None,
            Ok(Event::Start(e)) if e.name().as_ref() == tag.as_bytes() => {
                depth += 1;
            }
            Ok(Event::End(e)) if e.name().as_ref() == tag.as_bytes() => {
                if depth == 0 {
                    return Some(before);
                }
                depth -= 1;
            }
            Ok(_) => continue,
            Err(_) => return None,
        }
    }
}

/// 找 `xml` 里第一个标签名为 `tag` 的元素。
pub fn find_element(xml: &str, tag: &str) -> Option<ElementSpan> {
    scan_for(xml, |start| start.name().as_ref() == tag.as_bytes())
}

/// 找 `xml` 里第一个标签名为 `tag` 且属性 `attr="value"` 的元素——用于按
/// `w:styleId` 定位具体的 `<w:style>` 块。
pub fn find_element_by_attr(xml: &str, tag: &str, attr: &str, value: &str) -> Option<ElementSpan> {
    scan_for(xml, |start| {
        if start.name().as_ref() != tag.as_bytes() {
            return false;
        }
        start
            .attributes()
            .flatten()
            .any(|a| a.key.as_ref() == attr.as_bytes() && a.value.as_ref() == value.as_bytes())
    })
}

/// 找 `parent` 的某一个直接子元素；不存在则返回 `None`。
///
/// 和 [`upsert_ordered_child`] 的区别：这里只是"看一眼在不在"，不做任何插入
/// 或替换——调用方需要在"子元素已存在，要在它内部再做一层改写"和"子元素整个
/// 不存在，要连它一起新建"这两种情况之间分支时用这个。
pub fn find_direct_child(xml: &str, parent: &ElementSpan, tag: &str) -> Option<ElementSpan> {
    direct_children(xml, parent)
        .into_iter()
        .find(|child| child.tag == tag)
}

/// 列出 `parent` 的直接子元素（不含孙元素），按文档顺序。
fn direct_children(xml: &str, parent: &ElementSpan) -> Vec<ElementSpan> {
    if parent.self_closing || parent.inner.is_empty() {
        return Vec::new();
    }
    let content = &xml[parent.inner.clone()];
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(false);
    let mut children = Vec::new();
    loop {
        let start = reader.buffer_position() as usize;
        match reader.read_event() {
            Ok(Event::Eof) => break,
            Ok(Event::Empty(e)) => {
                let end = reader.buffer_position() as usize;
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let offset = parent.inner.start;
                children.push(ElementSpan {
                    tag,
                    outer: (offset + start)..(offset + end),
                    inner: (offset + end)..(offset + end),
                    self_closing: true,
                });
            }
            Ok(Event::Start(e)) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let inner_start = reader.buffer_position() as usize;
                let Some(inner_end) = matching_end(&mut reader, &tag) else {
                    break;
                };
                let outer_end = reader.buffer_position() as usize;
                let offset = parent.inner.start;
                children.push(ElementSpan {
                    tag,
                    outer: (offset + start)..(offset + outer_end),
                    inner: (offset + inner_start)..(offset + inner_end),
                    self_closing: false,
                });
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    children
}

/// 在 `container` 内插入或替换一个名为 `tag` 的直接子元素。
///
/// - `container` 已有一个名为 `tag` 的直接子元素：原样替换成 `fragment`
/// - 没有，且 `container` 是自闭合的（比如 `<w:pPr/>`）：展开成
///   `<w:pPr>{fragment}</w:pPr>`，保留原有属性
/// - 没有，`container` 有内容：按 `order` 找到第一个"顺序应该排在 `tag` 之后"
///   的现有子元素，插到它前面；找不到就插在 `container` 结束标签之前。
///   `order` 之外的现有子元素（这份代码不关心、不会主动插入的标签）不参与
///   排序判断，既不构成插入点也不被跳过——纯粹被忽略。
/// - 没有，`container` 完全没内容：直接插在末尾（等价于"没找到更靠后的锚点"）
///
/// `fragment` 是完整的元素文本（含标签本身），不是"要插进已有标签里的内容"。
pub fn upsert_ordered_child(
    xml: &str,
    container: &ElementSpan,
    tag: &str,
    fragment: &str,
    order: &[&str],
) -> String {
    if container.self_closing {
        let opening = &xml[container.outer.clone()];
        let Some(self_close_at) = opening.rfind("/>") else {
            return xml.to_owned();
        };
        // 去掉 `/>` 前可能存在的空格（`<w:rPr />` 这类写法很常见）：展开成一对
        // 标签后不该带着这个纯粹是格式差异的空格，否则同一份输入换一种自闭合
        // 写法就会得到不同字节的输出，跟"改动之外的字节保持不变"这条原则冲突。
        let before_slash = opening[..self_close_at].trim_end();
        let expanded = format!("{before_slash}>{fragment}</{}>", container.tag);
        return format!(
            "{}{}{}",
            &xml[..container.outer.start],
            expanded,
            &xml[container.outer.end..]
        );
    }

    let children = direct_children(xml, container);
    if let Some(existing) = children.iter().find(|child| child.tag == tag) {
        return format!(
            "{}{}{}",
            &xml[..existing.outer.start],
            fragment,
            &xml[existing.outer.end..]
        );
    }

    let target_index = order.iter().position(|candidate| *candidate == tag);
    let insert_at = target_index
        .and_then(|target| {
            children.iter().find_map(|child| {
                let child_index = order.iter().position(|candidate| *candidate == child.tag)?;
                (child_index > target).then_some(child.outer.start)
            })
        })
        .unwrap_or(container.inner.end);

    format!("{}{}{}", &xml[..insert_at], fragment, &xml[insert_at..])
}

/// [`upsert_ordered_child`] 的便捷写法，用在"`element` 这个字符串本身就是一个
/// 完整的 `tag` 元素"的场景（比如整段 `<w:sectPr>...</w:sectPr>`）。
///
/// 每次调用都会重新定位 `element` 自己：连续对同一个 `element` 做多次 upsert
/// 时，前一次返回的新字符串字节内容已经变了，沿用旧的 [`ElementSpan`] 会用
/// 错区间、把 XML 切裂——重新定位一次的开销远小于这个风险。
pub fn upsert_self_child(
    element: &str,
    tag: &str,
    child: &str,
    fragment: &str,
    order: &[&str],
) -> String {
    let span =
        find_element(element, tag).expect("element 参数按约定必须自身就是一个完整的 tag 元素");
    upsert_ordered_child(element, &span, child, fragment, order)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_simple_element_and_a_self_closing_one() {
        let xml = r#"<a><b w:val="1"/><c>text</c></a>"#;
        let b = find_element(xml, "b").unwrap();
        assert!(b.self_closing);
        assert_eq!(&xml[b.outer.clone()], r#"<b w:val="1"/>"#);

        let c = find_element(xml, "c").unwrap();
        assert!(!c.self_closing);
        assert_eq!(&xml[c.outer.clone()], "<c>text</c>");
        assert_eq!(&xml[c.inner.clone()], "text");

        assert!(find_element(xml, "missing").is_none());
    }

    #[test]
    fn finds_the_element_matching_an_attribute() {
        let xml = r#"<w:styles><w:style w:styleId="A"><w:pPr/></w:style><w:style w:styleId="SourceCode"><w:pPr><w:wordWrap/></w:pPr></w:style></w:styles>"#;
        let found = find_element_by_attr(xml, "w:style", "w:styleId", "SourceCode").unwrap();
        assert!(xml[found.outer.clone()].contains("wordWrap"));
        assert!(!xml[found.outer.clone()].contains(r#"w:styleId="A""#));
        assert!(find_element_by_attr(xml, "w:style", "w:styleId", "Missing").is_none());
    }

    #[test]
    fn find_direct_child_distinguishes_present_from_absent() {
        let xml = r#"<w:style><w:pPr><w:wordWrap/></w:pPr></w:style>"#;
        let style = find_element(xml, "w:style").unwrap();
        let ppr = find_direct_child(xml, &style, "w:pPr");
        assert!(ppr.is_some());
        assert!(find_direct_child(xml, &style, "w:rPr").is_none());
    }

    #[test]
    fn direct_children_skips_grandchildren() {
        let xml = r#"<w:pPr><w:pStyle w:val="x"/><w:nested><w:wordWrap/></w:nested></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let children = direct_children(xml, &ppr);
        assert_eq!(
            children.iter().map(|c| c.tag.as_str()).collect::<Vec<_>>(),
            vec!["w:pStyle", "w:nested"],
            "wordWrap 是 nested 的孙元素，不该被当成 pPr 的直接子元素",
        );
    }

    #[test]
    fn replaces_an_existing_child_in_place() {
        let xml = r#"<w:pPr><w:pStyle w:val="old"/><w:wordWrap w:val="off"/></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &ppr,
            "w:pStyle",
            r#"<w:pStyle w:val="new"/>"#,
            &["w:pStyle", "w:wordWrap"],
        );
        assert_eq!(
            out,
            r#"<w:pPr><w:pStyle w:val="new"/><w:wordWrap w:val="off"/></w:pPr>"#
        );
    }

    /// 早先手写的定位逻辑用 `find("/>")` 找一个元素的结尾；遇到
    /// `<w:ind ...></w:ind>` 这种开合标签成对的写法（而不是 `<w:ind .../>`
    /// 自闭合），会一路吃到后面无关标签的 `/>`，把中间整段 XML 一起吞掉。
    /// quick_xml 的事件流天然区分 Start/End 和 Empty，不会有这个问题，这条
    /// 测试锁死这一点。
    #[test]
    fn replaces_a_non_self_closing_child_without_swallowing_later_siblings() {
        let xml = r#"<w:pPr><w:ind w:firstLine="1"></w:ind><w:jc w:val="left"/></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &ppr,
            "w:ind",
            r#"<w:ind w:firstLine="480"/>"#,
            &["w:ind", "w:jc"],
        );
        assert_eq!(
            out,
            r#"<w:pPr><w:ind w:firstLine="480"/><w:jc w:val="left"/></w:pPr>"#
        );
    }

    /// 这就是这次会话真正踩过的 bug：pBdr 必须排在 wordWrap 之前。
    #[test]
    fn inserts_a_new_child_before_the_correct_later_anchor() {
        let xml = r#"<w:pPr><w:wordWrap w:val="off"/></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let border = "<w:pBdr>…</w:pBdr>";
        let out = upsert_ordered_child(xml, &ppr, "w:pBdr", border, &["w:pBdr", "w:wordWrap"]);
        assert_eq!(
            out,
            r#"<w:pPr><w:pBdr>…</w:pBdr><w:wordWrap w:val="off"/></w:pPr>"#
        );
    }

    #[test]
    fn appends_at_the_end_when_no_later_anchor_exists() {
        let xml = r#"<w:pPr><w:pStyle w:val="x"/></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &ppr,
            "w:wordWrap",
            r#"<w:wordWrap w:val="off"/>"#,
            &["w:pStyle", "w:wordWrap"],
        );
        assert_eq!(
            out,
            r#"<w:pPr><w:pStyle w:val="x"/><w:wordWrap w:val="off"/></w:pPr>"#
        );
    }

    #[test]
    fn expands_a_self_closing_container_and_keeps_its_attributes() {
        let xml = r#"<w:pPr w:rsidR="00AA"/>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &ppr,
            "w:pBdr",
            "<w:pBdr>…</w:pBdr>",
            &["w:pBdr", "w:wordWrap"],
        );
        assert_eq!(
            out,
            r#"<w:pPr w:rsidR="00AA">"#.to_owned() + "<w:pBdr>…</w:pBdr>" + "</w:pPr>"
        );
    }

    /// `<w:rPr />` 这类"斜杠前带个空格"的自闭合写法在真实 pandoc 输出里很常见；
    /// 展开后不该带着这个纯格式差异的空格，否则同一份逻辑输入换一种写法就会
    /// 得到不同字节的输出——这正是黄金哈希测试第一次踩过的坑。
    #[test]
    fn expanding_a_self_closing_container_trims_the_space_before_the_slash() {
        let xml = r#"<w:rPr />"#;
        let rpr = find_element(xml, "w:rPr").unwrap();
        let out = upsert_ordered_child(xml, &rpr, "w:sz", r#"<w:sz w:val="24"/>"#, &["w:sz"]);
        assert_eq!(out, r#"<w:rPr><w:sz w:val="24"/></w:rPr>"#);
    }

    /// order 表里没列到的现有子元素既不构成插入点、也不影响判断——纯粹被忽略。
    #[test]
    fn ignores_existing_children_the_order_table_does_not_know_about() {
        let xml = r#"<w:pPr><w:unknownTag/><w:wordWrap w:val="off"/></w:pPr>"#;
        let ppr = find_element(xml, "w:pPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &ppr,
            "w:pBdr",
            "<w:pBdr>…</w:pBdr>",
            &["w:pBdr", "w:wordWrap"],
        );
        assert_eq!(
            out, r#"<w:pPr><w:unknownTag/><w:pBdr>…</w:pBdr><w:wordWrap w:val="off"/></w:pPr>"#,
            "pBdr 仍然要排在 wordWrap 前面，不该被 unknownTag 的存在打乱",
        );
    }

    #[test]
    fn inserts_between_the_correct_pair_of_several_anchors() {
        let xml = r#"<w:sectPr><w:pgSz w:w="1"/><w:pgMar w:top="1"/></w:sectPr>"#;
        let sect = find_element(xml, "w:sectPr").unwrap();
        let out = upsert_ordered_child(
            xml,
            &sect,
            "w:footerReference",
            r#"<w:footerReference r:id="rId1"/>"#,
            &["w:footerReference", "w:pgSz", "w:pgMar"],
        );
        assert_eq!(
            out,
            r#"<w:sectPr><w:footerReference r:id="rId1"/><w:pgSz w:w="1"/><w:pgMar w:top="1"/></w:sectPr>"#
        );
    }

    #[test]
    fn upsert_self_child_relocates_between_successive_calls() {
        const ORDER: &[&str] = &["w:footerReference", "w:pgSz", "w:pgMar"];
        let mut section = "<w:sectPr/>".to_owned();
        section = upsert_self_child(
            &section,
            "w:sectPr",
            "w:footerReference",
            r#"<w:footerReference r:id="rId1"/>"#,
            ORDER,
        );
        section = upsert_self_child(
            &section,
            "w:sectPr",
            "w:pgSz",
            r#"<w:pgSz w:w="1"/>"#,
            ORDER,
        );
        section = upsert_self_child(
            &section,
            "w:sectPr",
            "w:pgMar",
            r#"<w:pgMar w:top="1"/>"#,
            ORDER,
        );
        assert_eq!(
            section,
            r#"<w:sectPr><w:footerReference r:id="rId1"/><w:pgSz w:w="1"/><w:pgMar w:top="1"/></w:sectPr>"#,
        );
    }
}
