use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{
        settings::AppSettings,
        workspace::{ensure_allowed, ensure_write_allowed},
    },
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
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

    let target = create_unique_attachment(&target_dir, file_name, data)?;
    let relative = pathdiff::diff_paths(&target, doc_dir)
        .ok_or_else(|| AppError::new("relative_path_failed", "无法生成附件相对路径"))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn sanitized_attachment_parts(file_name: &str) -> (String, String) {
    // Sanitize before asking `Path` to parse the name. On Windows, an input such as
    // `a:b.png` is otherwise interpreted as a drive-prefixed path and loses `a:`.
    let sanitized = file_name.replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_");
    let source = Path::new(&sanitized);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("png")
        .trim_end_matches(['.', ' '])
        .to_owned();
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image")
        .trim_end_matches(['.', ' '])
        .to_owned();
    (
        if stem.is_empty() {
            "image".into()
        } else {
            stem
        },
        if extension.is_empty() {
            "png".into()
        } else {
            extension
        },
    )
}

fn attachment_name(file_name: &str, index: usize) -> String {
    let (stem, extension) = sanitized_attachment_parts(file_name);
    if index == 0 {
        format!("{stem}.{extension}")
    } else {
        format!("{stem}-{index}.{extension}")
    }
}

fn create_unique_attachment(directory: &Path, file_name: &str, data: &[u8]) -> AppResult<PathBuf> {
    for index in 0..10_000usize {
        let name = attachment_name(file_name, index);
        let candidate = directory.join(name);
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AppError::io("创建附件失败", error)),
        };
        if let Err(error) = file.write_all(data).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&candidate);
            return Err(AppError::io("写入附件失败", error));
        }
        return Ok(candidate);
    }
    Err(AppError::new(
        "attachment_name_exhausted",
        "无法为附件分配唯一名称",
    ))
}

#[cfg(test)]
fn unique_attachment_path(directory: &Path, file_name: &str) -> PathBuf {
    let mut index = 0usize;
    loop {
        let name = attachment_name(file_name, index);
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_unique_attachment, unique_attachment_path, validate_attachment_size,
        MAX_ATTACHMENT_BYTES,
    };
    use std::fs;
    use std::sync::{Arc, Barrier};
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

    #[test]
    fn concurrent_attachments_never_overwrite_each_other() {
        let directory = tempdir().expect("temporary directory");
        let root = Arc::new(directory.path().to_path_buf());
        let barrier = Arc::new(Barrier::new(16));
        let handles = (0_u8..16)
            .map(|value| {
                let root = Arc::clone(&root);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    create_unique_attachment(&root, "same.png", &[value])
                        .expect("attachment creation")
                })
            })
            .collect::<Vec<_>>();
        let paths = handles
            .into_iter()
            .map(|handle| handle.join().expect("attachment thread"))
            .collect::<Vec<_>>();
        assert_eq!(
            paths
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            16
        );
        let mut values = paths
            .iter()
            .map(|path| fs::read(path).expect("attachment content")[0])
            .collect::<Vec<_>>();
        values.sort_unstable();
        assert_eq!(values, (0_u8..16).collect::<Vec<_>>());
    }
}
