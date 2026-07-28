use super::workspace::{ensure_allowed, file_name, path_string};
use crate::domain::{
    error::{AppError, AppResult},
    models::{NamedPath, PathResult},
    safe_name::validate_item_name,
};
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::{ffi::CString, os::unix::ffi::OsStrExt};
use std::{fs, fs::OpenOptions, io::ErrorKind, path::Path};
use tauri::AppHandle;

#[cfg(target_os = "macos")]
fn rename_without_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    const RENAME_EXCL: u32 = 0x0000_0004;
    unsafe extern "C" {
        fn renamex_np(
            from: *const std::ffi::c_char,
            to: *const std::ffi::c_char,
            flags: u32,
        ) -> i32;
    }
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "源路径包含 NUL"))?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "目标路径包含 NUL"))?;
    let result = unsafe { renamex_np(source.as_ptr(), target.as_ptr(), RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn rename_without_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    // Linux 的 std::fs::rename 会覆盖已有目标。renameat2 + RENAME_NOREPLACE
    // 把“目标不存在”和移动合并成一次原子操作，避免 exists() 预检查后的竞态覆盖。
    const RENAME_NOREPLACE: u32 = 1;
    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "源路径包含 NUL"))?;
    let target = CString::new(target.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(ErrorKind::InvalidInput, "目标路径包含 NUL"))?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "windows")]
fn rename_without_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }
    // MoveFileExW only replaces an existing target when MOVEFILE_REPLACE_EXISTING
    // is explicitly set. Passing no flags gives files and directories one atomic
    // no-replace operation, unlike std::fs::rename on the current Windows runner.
    let source: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let target: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn rename_without_replace(_source: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        ErrorKind::Unsupported,
        "当前平台不支持原子不覆盖重命名",
    ))
}

pub fn create_file(app: &AppHandle, directory: &Path, name: &str) -> AppResult<NamedPath> {
    validate_item_name(name)?;
    ensure_allowed(app, directory)?;
    let target = directory.join(name);
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| AppError::io("新建文件失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name: name.to_owned(),
    })
}

pub fn create_dir(app: &AppHandle, directory: &Path, name: &str) -> AppResult<NamedPath> {
    validate_item_name(name)?;
    ensure_allowed(app, directory)?;
    let target = directory.join(name);
    fs::create_dir(&target).map_err(|error| AppError::io("新建文件夹失败", error))?;
    Ok(NamedPath {
        path: path_string(&target),
        name: name.to_owned(),
    })
}

pub fn rename_item(app: &AppHandle, old_path: &Path, new_name: &str) -> AppResult<NamedPath> {
    validate_item_name(new_name)?;
    ensure_allowed(app, old_path)?;
    let parent = old_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "原路径没有父目录"))?;
    ensure_allowed(app, parent)?;
    let target = parent.join(new_name);
    // Pre-check covers the common in-app duplicate-name case. We also map the
    // OS AlreadyExists error from rename itself (Windows surfaces it natively).
    if target.exists() {
        return Err(AppError::new("already_exists", "目标名称已存在"));
    }
    rename_without_replace(old_path, &target).map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists {
            AppError::new("already_exists", "目标名称已存在")
        } else {
            AppError::io("重命名失败", error)
        }
    })?;
    Ok(NamedPath {
        path: path_string(&target),
        name: new_name.to_owned(),
    })
}

pub fn move_item(app: &AppHandle, source: &Path, target_dir: &Path) -> AppResult<NamedPath> {
    ensure_allowed(app, source)?;
    ensure_allowed(app, target_dir)?;
    let name = file_name(source);
    let canonical_source = source
        .canonicalize()
        .map_err(|error| AppError::io("解析源路径失败", error))?;
    let canonical_target_dir = target_dir
        .canonicalize()
        .map_err(|error| AppError::io("解析目标目录失败", error))?;
    if source.is_dir() && canonical_target_dir.starts_with(&canonical_source) {
        return Err(AppError::new(
            "invalid_move",
            "不能把文件夹移动到它自己的子目录中",
        ));
    }
    let target = target_dir.join(&name);
    if target.exists() {
        return Err(AppError::new(
            "already_exists",
            format!("已存在同名项目：{name}"),
        ));
    }
    rename_without_replace(source, &target).map_err(|error| {
        if error.kind() == ErrorKind::AlreadyExists {
            AppError::new("already_exists", format!("已存在同名项目：{name}"))
        } else {
            AppError::io("移动失败", error)
        }
    })?;
    Ok(NamedPath {
        path: path_string(&target),
        name,
    })
}

pub fn trash_item(app: &AppHandle, target: &Path) -> AppResult<PathResult> {
    ensure_allowed(app, target)?;
    trash::delete(target).map_err(|error| AppError::new("trash_failed", error.to_string()))?;
    Ok(PathResult {
        path: path_string(target),
    })
}

#[cfg(test)]
mod tests {
    use super::rename_without_replace;

    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    #[test]
    fn rename_never_replaces_an_existing_target() {
        let directory = tempfile::tempdir().expect("temp directory");
        let source = directory.path().join("source.txt");
        let target = directory.path().join("target.txt");
        std::fs::write(&source, "source").expect("write source");
        std::fs::write(&target, "target").expect("write target");
        assert!(rename_without_replace(&source, &target).is_err());
        assert_eq!(
            std::fs::read_to_string(&source).expect("source remains"),
            "source"
        );
        assert_eq!(
            std::fs::read_to_string(&target).expect("target remains"),
            "target"
        );
    }
}
