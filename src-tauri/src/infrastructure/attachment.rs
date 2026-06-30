use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{
        settings::AppSettings,
        workspace::{ensure_allowed, ensure_write_allowed},
    },
};
use std::{fs, path::Path};
use tauri::AppHandle;

const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;

pub fn validate_attachment_size(size: usize) -> AppResult<()> {
    if size > MAX_ATTACHMENT_BYTES {
        return Err(AppError::new(
            "attachment_too_large",
            "单个附件不能超过 20 MB",
        ));
    }
    Ok(())
}

pub fn save_attachment(
    app: &AppHandle,
    settings: &AppSettings,
    doc_dir: &Path,
    doc_name: &str,
    vault_root: Option<&Path>,
    file_name: &str,
    data: &[u8],
) -> AppResult<String> {
    validate_attachment_size(data.len())?;
    ensure_allowed(app, doc_dir)?;
    if let Some(root) = vault_root {
        ensure_allowed(app, root)?;
    }

    let folder = if settings.attachment_folder.trim().is_empty() {
        "assets"
    } else {
        settings.attachment_folder.trim()
    };
    if folder.contains('/') || folder.contains('\\') || matches!(folder, "." | "..") {
        return Err(AppError::new(
            "invalid_attachment_folder",
            "附件目录名称无效",
        ));
    }
    let root = vault_root.unwrap_or(doc_dir);
    let doc_stem = Path::new(doc_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("untitled");

    let target_dir = match settings.attachment_mode.as_str() {
        "same" => doc_dir.to_path_buf(),
        "docSubfolder" => doc_dir.join(folder).join(doc_stem),
        "vault" => root.to_path_buf(),
        "vaultSubfolder" => root.join(folder),
        _ => doc_dir.join(folder),
    };
    ensure_write_allowed(app, &target_dir)?;
    fs::create_dir_all(&target_dir).map_err(|error| AppError::io("创建附件目录失败", error))?;

    let target = unique_attachment_path(&target_dir, file_name);
    ensure_write_allowed(app, &target)?;
    fs::write(&target, data).map_err(|error| AppError::io("写入附件失败", error))?;
    let relative = pathdiff::diff_paths(&target, doc_dir)
        .ok_or_else(|| AppError::new("relative_path_failed", "无法生成附件相对路径"))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn unique_attachment_path(directory: &Path, file_name: &str) -> std::path::PathBuf {
    // Sanitize before asking `Path` to parse the name. On Windows, an input such as
    // `a:b.png` is otherwise interpreted as a drive-prefixed path and loses `a:`.
    let sanitized = file_name.replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    let source = Path::new(&sanitized);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    let mut index = 0usize;
    loop {
        let name = if index == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{unique_attachment_path, validate_attachment_size, MAX_ATTACHMENT_BYTES};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_a_unique_sanitized_attachment_name() {
        let directory = tempdir().expect("temporary directory");
        let first = unique_attachment_path(directory.path(), "a:b?.png");
        assert_eq!(
            first.file_name().and_then(|name| name.to_str()),
            Some("a_b_.png")
        );
        fs::write(&first, b"image").expect("seed attachment");

        let second = unique_attachment_path(directory.path(), "a:b?.png");
        assert_eq!(
            second.file_name().and_then(|name| name.to_str()),
            Some("a_b_-1.png")
        );
    }

    #[test]
    fn rejects_attachment_bodies_above_the_memory_budget() {
        assert!(validate_attachment_size(MAX_ATTACHMENT_BYTES).is_ok());
        assert!(validate_attachment_size(MAX_ATTACHMENT_BYTES + 1).is_err());
    }
}
