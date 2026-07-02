use crate::domain::error::{AppError, AppResult};
use std::path::Path;

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

pub fn is_valid_portable_name(value: &str, max_utf16_units: usize) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || matches!(trimmed, "." | "..")
        || trimmed != value
        || value.ends_with(['.', ' '])
        || value.encode_utf16().count() > max_utf16_units
        || value.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
        || value.contains(['/', '\\'])
        || Path::new(value).is_absolute()
    {
        return false;
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    !WINDOWS_RESERVED.contains(&stem.as_str())
}

pub fn validate_item_name(value: &str) -> AppResult<()> {
    if !is_valid_portable_name(value, 255) {
        return Err(AppError::new(
            "invalid_name",
            "名称为空、过长，或包含当前平台不支持的字符",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_valid_portable_name;

    #[test]
    fn rejects_cross_platform_reserved_names() {
        for name in [
            "",
            "  ",
            ".",
            "..",
            "a/b",
            "a\\b",
            "a:b",
            "note.",
            "note ",
            "CON",
            "con.md",
            "LPT9.txt",
            "bad\nname",
        ] {
            assert!(!is_valid_portable_name(name, 255), "accepted {name:?}");
        }
    }

    #[test]
    fn accepts_portable_unicode_names() {
        for name in ["笔记.md", "assets", "release-notes.mdx"] {
            assert!(is_valid_portable_name(name, 255), "rejected {name:?}");
        }
    }
}
