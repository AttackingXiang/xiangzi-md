use std::{ffi::OsStr, path::Path};

/// Canonical native manifest for formats the editor can open. Keep this list in
/// sync with src/lib/fileCapabilities.ts; all Rust consumers derive from here.
pub(crate) const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mdx"];
pub(crate) const TEXT_EXTENSIONS: &[&str] = &[
    "txt",
    "log",
    "json",
    "json5",
    "jsonc",
    "yaml",
    "yml",
    "toml",
    "ini",
    "conf",
    "properties",
    "xml",
    "svg",
    "html",
    "htm",
    "css",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "mts",
    "cts",
    "tsx",
    "sql",
    "sh",
    "bash",
    "zsh",
];

fn has_extension(path: &Path, candidates: &[&str]) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            candidates
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
}

pub(crate) fn is_markdown(path: &Path) -> bool {
    has_extension(path, MARKDOWN_EXTENSIONS)
}

pub(crate) fn is_known_text(path: &Path) -> bool {
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or("");
    if name.starts_with('.') {
        return false;
    }
    match path.extension().and_then(OsStr::to_str) {
        None => true,
        Some(_) => is_markdown(path) || has_extension(path, TEXT_EXTENSIONS),
    }
}

#[cfg(test)]
mod tests {
    use super::{is_known_text, is_markdown};
    use std::path::Path;

    #[test]
    fn classifies_the_shared_document_formats_case_insensitively() {
        assert!(is_markdown(Path::new("README.MDX")));
        assert!(is_known_text(Path::new("config.JSON")));
        assert!(is_known_text(Path::new("LICENSE")));
        assert!(!is_known_text(Path::new(".env")));
        assert!(!is_known_text(Path::new("photo.png")));
    }
}
