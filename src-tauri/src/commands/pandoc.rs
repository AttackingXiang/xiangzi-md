/// Pandoc 集成命令：检测 pandoc 路径、导出 docx、导入 docx。
///
/// 设计原则：
/// - macOS GUI 应用从 Finder 启动时 PATH 不含 /opt/homebrew/bin，
///   因此先按平台候选路径逐个探测，最后才尝试 PATH。
/// - normalize_docx_fonts 对 pandoc 生成的 docx 后处理，把 word/styles.xml
///   和 word/theme/theme1.xml 里的字体归一化为指定规范，不依赖 pandoc 版本。
use crate::domain::error::{AppError, AppResult};
use crate::infrastructure::settings::SettingsStore;
use serde::Serialize;
use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_fs::FsExt;

// ── 字体常量（集中定义，日后改一处即可）──────────────────────────────────────
/// 正文系列：宋体(东亚) + Calibri(ASCII/HAnsi/CS)
const FONT_BODY_EA: &str = "宋体";
const FONT_BODY_LATIN: &str = "Calibri";
/// 标题系列：黑体(东亚) + Calibri(ASCII/HAnsi/CS)
const FONT_HEADING_EA: &str = "黑体";
/// 代码系列：宋体(东亚) + Consolas(ASCII/HAnsi/CS)
const FONT_CODE_LATIN: &str = "Consolas";

// ── pandoc 路径探测 ──────────────────────────────────────────────────────────

/// 返回可用 pandoc 二进制的路径。
///
/// 查找顺序：
/// 1. 用户在设置里自定义的 override_path（非空时）
/// 2. 平台特定候选路径（macOS/Linux/Windows 各不同）
/// 3. PATH 上的 pandoc（用 `--version` 探测）
///
/// 注：对外推荐使用 find_pandoc_full，它整合了平台动态路径探测。
/// 此函数保留供内部（或测试隔离）场景使用。
#[allow(dead_code)]
pub fn find_pandoc(override_path: Option<&str>) -> Option<PathBuf> {
    // 1. 用户自定义路径优先
    if let Some(p) = override_path.filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
        // 用户给了路径但找不到 → 不继续搜索（返回 None 让上层报错）
        return None;
    }

    // 2. 平台候选路径（GUI 应用从 Finder 启动时 PATH 里不一定有这些目录）
    let candidates: &[&str] = platform_candidates();
    for c in candidates {
        let pb = PathBuf::from(c);
        if pb.is_file() {
            return Some(pb);
        }
    }

    // 3. 尝试 PATH（执行 --version 探测是否存在）
    let ok = std::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        return Some(PathBuf::from("pandoc"));
    }

    None
}

#[cfg(target_os = "macos")]
fn platform_candidates() -> &'static [&'static str] {
    &[
        "/opt/homebrew/bin/pandoc", // Apple Silicon homebrew
        "/usr/local/bin/pandoc",    // Intel homebrew / 手动安装
        "/opt/local/bin/pandoc",    // MacPorts
    ]
}

#[cfg(target_os = "linux")]
fn platform_candidates() -> &'static [&'static str] {
    // ~/.local/bin 在环境变量探测里很少出现，所以列出来兜底
    &[
        "/usr/bin/pandoc",
        "/usr/local/bin/pandoc",
        // ~/.local/bin 包含展开后的路径，运行时通过 dirs::home_dir 动态拼接
    ]
}

#[cfg(target_os = "windows")]
fn platform_candidates() -> &'static [&'static str] {
    &[]
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn platform_candidates() -> &'static [&'static str] {
    &[]
}

// Linux 平台还需探测 ~/.local/bin（动态路径无法放常量数组）
#[cfg(target_os = "linux")]
fn find_pandoc_linux_extra() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let p = home.join(".local/bin/pandoc");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

// Windows 平台探测 %ProgramFiles% 和 %LocalAppData%
#[cfg(target_os = "windows")]
fn find_pandoc_windows() -> Option<PathBuf> {
    for env_var in ["ProgramFiles", "LocalAppData"] {
        if let Ok(base) = std::env::var(env_var) {
            let p = PathBuf::from(base).join("Pandoc").join("pandoc.exe");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// 完整版 find_pandoc，整合平台特定的动态探测。
pub fn find_pandoc_full(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
        return None;
    }

    for c in platform_candidates() {
        let pb = PathBuf::from(c);
        if pb.is_file() {
            return Some(pb);
        }
    }

    // 平台额外探测
    #[cfg(target_os = "linux")]
    if let Some(p) = find_pandoc_linux_extra() {
        return Some(p);
    }
    #[cfg(target_os = "windows")]
    if let Some(p) = find_pandoc_windows() {
        return Some(p);
    }

    // 最后：PATH
    let ok = std::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if ok {
        Some(PathBuf::from("pandoc"))
    } else {
        None
    }
}

const MAX_CUSTOM_PANDOC_ARGS: usize = 64;

/// 按常见命令行引号规则解析附加参数，但始终直接传给 Command，不经过 shell。
fn parse_pandoc_args(raw: &str) -> AppResult<Vec<String>> {
    #[derive(Clone, Copy, PartialEq)]
    enum Quote {
        None,
        Single,
        Double,
    }

    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote = Quote::None;
    let mut escaped = false;

    for ch in raw.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        match (quote, ch) {
            (Quote::None | Quote::Double, '\\') => escaped = true,
            (Quote::None, '\'') => quote = Quote::Single,
            (Quote::None, '"') => quote = Quote::Double,
            (Quote::Single, '\'') => quote = Quote::None,
            (Quote::Double, '"') => quote = Quote::None,
            (Quote::None, value) if value.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            (_, value) => current.push(value),
        }
    }

    if escaped || quote != Quote::None {
        return Err(AppError::new(
            "pandoc_args_invalid",
            "Pandoc 附加参数中存在未闭合的引号或转义符",
        ));
    }
    if !current.is_empty() {
        args.push(current);
    }
    if args.len() > MAX_CUSTOM_PANDOC_ARGS {
        return Err(AppError::new(
            "pandoc_args_invalid",
            format!("Pandoc 附加参数不能超过 {MAX_CUSTOM_PANDOC_ARGS} 项"),
        ));
    }
    if let Some(argument) = args
        .iter()
        .find(|argument| is_reserved_pandoc_arg(argument))
    {
        return Err(AppError::new(
            "pandoc_args_reserved",
            format!("参数 {argument} 由应用管理，请使用对应设置项"),
        ));
    }
    Ok(args)
}

fn is_reserved_pandoc_arg(argument: &str) -> bool {
    const LONG: &[&str] = &[
        "--from",
        "--to",
        "--output",
        "--extract-media",
        "--reference-doc",
    ];
    LONG.iter()
        .any(|name| argument == *name || argument.starts_with(&format!("{name}=")))
        || ["-f", "-t", "-o"].iter().any(|name| {
            argument == *name
                || (argument.starts_with(name)
                    && argument.len() > name.len()
                    && !argument.starts_with("--"))
        })
}

// ── Tauri 命令 ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocStatus {
    pub path: String,
    pub version: String,
}

/// 检测 pandoc 是否可用，返回路径和版本号；找不到则返回 null。
#[tauri::command]
pub fn pandoc_status(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
) -> AppResult<Option<PandocStatus>> {
    let settings = settings_store.get(&app)?;
    let override_path = settings.pandoc_path;
    let Some(pandoc_path) = find_pandoc_full(if override_path.is_empty() {
        None
    } else {
        Some(&override_path)
    }) else {
        return Ok(None);
    };

    let output = make_command(&pandoc_path)
        .arg("--version")
        .output()
        .map_err(|e| AppError::new("pandoc_exec_failed", format!("执行 pandoc 失败：{e}")))?;

    if !output.status.success() {
        return Ok(None);
    }

    // 第一行形如 "pandoc 3.10"
    let first_line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("")
        .to_owned();
    let version = first_line
        .strip_prefix("pandoc ")
        .unwrap_or(&first_line)
        .trim()
        .to_owned();

    Ok(Some(PandocStatus {
        path: pandoc_path.to_string_lossy().into_owned(),
        version,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocxResult {
    pub path: String,
}

#[derive(Debug)]
struct PandocExportOptions {
    reference_doc: Option<PathBuf>,
    extra_args: Vec<String>,
    table_of_contents: bool,
    number_sections: bool,
}

/// 把 Pandoc 内置 reference.docx 导出为可编辑副本。
#[tauri::command]
pub async fn export_pandoc_default_template(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    output_path: String,
) -> AppResult<ExportDocxResult> {
    let settings = settings_store.get(&app)?;
    let pandoc_path = find_pandoc_full(if settings.pandoc_path.is_empty() {
        None
    } else {
        Some(&settings.pandoc_path)
    })
    .ok_or_else(|| {
        AppError::new(
            "pandoc_not_found",
            "未找到 pandoc，请先安装或在设置中指定路径",
        )
    })?;
    let output_path_for_task = output_path.clone();

    crate::commands::blocking(move || {
        run_export_default_template(&pandoc_path, Path::new(&output_path_for_task))
    })
    .await?;

    Ok(ExportDocxResult { path: output_path })
}

fn run_export_default_template(pandoc_path: &Path, output_path: &Path) -> AppResult<()> {
    let result = make_command(pandoc_path)
        .args(["--print-default-data-file", "reference.docx"])
        .output()
        .map_err(|error| {
            AppError::new(
                "pandoc_exec_failed",
                format!("读取 Pandoc 默认模板失败：{error}"),
            )
        })?;
    if !result.status.success() {
        return Err(AppError::new(
            "pandoc_template_export_failed",
            format!(
                "导出 Pandoc 默认模板失败：{}",
                String::from_utf8_lossy(&result.stderr)
            ),
        ));
    }
    std::fs::write(output_path, result.stdout)
        .map_err(|error| AppError::io("写入默认 Word 模板失败", error))
}

/// 把 Markdown 文本（通过 stdin）用 pandoc 转换为 docx，然后后处理字体。
///
/// - markdown：要导出的 Markdown 原文
/// - doc_dir：文档所在目录（用于解析相对路径图片），未保存文件传 null
/// - output_path：目标 .docx 绝对路径（由前端 save 对话框决定）
#[tauri::command]
pub async fn export_docx(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    markdown: String,
    doc_dir: Option<String>,
    output_path: String,
) -> AppResult<ExportDocxResult> {
    let settings = settings_store.get(&app)?;
    let override_path = settings.pandoc_path.clone();
    let pandoc_path = find_pandoc_full(if override_path.is_empty() {
        None
    } else {
        Some(&override_path)
    })
    .ok_or_else(|| {
        AppError::new(
            "pandoc_not_found",
            "未找到 pandoc，请先安装或在设置中指定路径",
        )
    })?;

    let reference_doc = if settings.pandoc_reference_doc.trim().is_empty() {
        None
    } else {
        let path = PathBuf::from(settings.pandoc_reference_doc.trim());
        if !path.is_file()
            || !path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("docx"))
        {
            return Err(AppError::new(
                "pandoc_reference_doc_invalid",
                "自定义 Word 模板不存在或不是 .docx 文件",
            ));
        }
        Some(path)
    };
    let options = PandocExportOptions {
        reference_doc,
        extra_args: parse_pandoc_args(&settings.pandoc_export_args)?,
        table_of_contents: settings.pandoc_toc,
        number_sections: settings.pandoc_number_sections,
    };
    let normalize_fonts = settings.pandoc_normalize_fonts;

    let output = PathBuf::from(&output_path);

    // 在 spawn_blocking 里执行同步 IO，避免阻塞 Tauri 异步运行时
    let pandoc_path2 = pandoc_path.clone();
    let markdown2 = markdown.clone();
    let doc_dir2 = doc_dir.clone();
    let output_path2 = output_path.clone();

    crate::commands::blocking(move || {
        run_export_docx(
            &pandoc_path2,
            &markdown2,
            doc_dir2.as_deref(),
            &output_path2,
            &options,
        )
    })
    .await?;

    // 后处理：归一化字体
    if normalize_fonts {
        normalize_docx_fonts(&output)?;
    }

    Ok(ExportDocxResult { path: output_path })
}

fn run_export_docx(
    pandoc_path: &Path,
    markdown: &str,
    doc_dir: Option<&str>,
    output_path: &str,
    options: &PandocExportOptions,
) -> AppResult<()> {
    use std::io::Write;

    let mut cmd = make_command(pandoc_path);
    cmd.args(["-f", "gfm+tex_math_dollars", "-t", "docx"]);
    if let Some(reference_doc) = &options.reference_doc {
        cmd.arg(format!(
            "--reference-doc={}",
            reference_doc.to_string_lossy()
        ));
    }
    if options.table_of_contents {
        cmd.arg("--toc");
    }
    if options.number_sections {
        cmd.arg("--number-sections");
    }
    cmd.args(&options.extra_args);
    cmd.args(["-o", output_path])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    // 让 pandoc 以文档目录为 cwd，相对路径图片才能正确嵌入
    if let Some(dir) = doc_dir {
        cmd.current_dir(dir);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::new("pandoc_spawn_failed", format!("启动 pandoc 失败：{e}")))?;

    // 写 stdin
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown.as_bytes()).map_err(|e| {
            AppError::new(
                "pandoc_stdin_failed",
                format!("写入 pandoc 标准输入失败：{e}"),
            )
        })?;
        // stdin 关闭后 pandoc 才开始处理
    }

    let result = child
        .wait_with_output()
        .map_err(|e| AppError::new("pandoc_wait_failed", format!("等待 pandoc 完成失败：{e}")))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).into_owned();
        return Err(AppError::new(
            "pandoc_export_failed",
            format!("pandoc 导出失败：{stderr}"),
        ));
    }

    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocxResult {
    pub markdown_path: String,
}

/// 把 docx 文件用 pandoc 转换为 GFM Markdown，返回生成的 .md 文件绝对路径。
///
/// - docx_path：源 docx 绝对路径
/// - media_subdir：提取媒体文件的子目录名（相对 docx 所在目录），如 "assets"
#[tauri::command]
pub async fn import_docx(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    docx_path: String,
    media_subdir: String,
) -> AppResult<ImportDocxResult> {
    let settings = settings_store.get(&app)?;
    let override_path = settings.pandoc_path.clone();
    let pandoc_path = find_pandoc_full(if override_path.is_empty() {
        None
    } else {
        Some(&override_path)
    })
    .ok_or_else(|| {
        AppError::new(
            "pandoc_not_found",
            "未找到 pandoc，请先安装或在设置中指定路径",
        )
    })?;
    let extra_args = parse_pandoc_args(&settings.pandoc_import_args)?;

    // 文件选择器只会授权用户选中的 docx。Pandoc 随后创建的 Markdown
    // 和媒体目录是新路径，需要显式加入 Tauri scope，前端才能立即打开。
    let source_path = PathBuf::from(&docx_path);
    let media_dir = source_path
        .parent()
        .map(|parent| parent.join(&media_subdir));

    let result = crate::commands::blocking(move || {
        run_import_docx(&pandoc_path, &docx_path, &media_subdir, &extra_args)
    })
    .await?;

    app.fs_scope()
        .allow_file(&result.markdown_path)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    app.asset_protocol_scope()
        .allow_file(&result.markdown_path)
        .map_err(|error| AppError::new("scope_failed", error.to_string()))?;

    if let Some(media_dir) = media_dir.filter(|path| path.is_dir()) {
        app.fs_scope()
            .allow_directory(&media_dir, true)
            .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
        app.asset_protocol_scope()
            .allow_directory(&media_dir, true)
            .map_err(|error| AppError::new("scope_failed", error.to_string()))?;
    }

    Ok(result)
}

fn run_import_docx(
    pandoc_path: &Path,
    docx_path: &str,
    media_subdir: &str,
    extra_args: &[String],
) -> AppResult<ImportDocxResult> {
    let docx = PathBuf::from(docx_path);
    let cwd = docx
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "无法确定 docx 文件所在目录"))?;

    let docx_stem = docx
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let docx_file_name = docx
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    // 生成不冲突的输出文件名：先试 <stem>.md，再试 <stem> 2.md / <stem> 3.md ...
    let out_name = pick_output_name(cwd, &docx_stem);
    let out_path = cwd.join(&out_name);

    let mut cmd = make_command(pandoc_path);
    cmd.args([
        &docx_file_name,
        "-f",
        "docx",
        // Milkdown 不支持 Pandoc 为合并单元格、带尺寸图片生成的原始 HTML。
        // 关闭 GFM 的 raw_html 扩展后，Pandoc 会把复杂表格降级为管道表格，
        // 并把图片写成标准 Markdown 图片，导入结果才能在编辑器里正常展示。
        "-t",
        "gfm-raw_html",
        "--wrap=none",
        "--markdown-headings=atx",
        &format!("--extract-media={media_subdir}"),
    ]);
    cmd.args(extra_args);
    cmd.args(["-o", &out_name])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let result = cmd
        .output()
        .map_err(|e| AppError::new("pandoc_spawn_failed", format!("启动 pandoc 失败：{e}")))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).into_owned();
        return Err(AppError::new(
            "pandoc_import_failed",
            format!("pandoc 导入失败：{stderr}"),
        ));
    }

    Ok(ImportDocxResult {
        markdown_path: out_path.to_string_lossy().into_owned(),
    })
}

/// 在 dir 里找一个不冲突的 <stem>.md 文件名（stem.md / stem 2.md / stem 3.md ...）
fn pick_output_name(dir: &Path, stem: &str) -> String {
    let base = format!("{stem}.md");
    if !dir.join(&base).exists() {
        return base;
    }
    for n in 2u32.. {
        let candidate = format!("{stem} {n}.md");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    // 几乎不可能到这里
    format!("{stem}-out.md")
}

// ── Windows 隐藏控制台窗口 ───────────────────────────────────────────────────

fn make_command(program: &Path) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    // Windows 上 GUI 应用启动子进程默认会弹出黑色控制台窗口，用 CREATE_NO_WINDOW 抑制
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

// ── docx 字体后处理 ──────────────────────────────────────────────────────────

/// 读取 output_path 处的 docx（zip），改写 word/styles.xml 和 word/theme/theme1.xml
/// 中的字体，使其符合项目规范字体，然后原路写回。
///
/// 为什么在 Rust 里后处理而不用 --reference-doc？
/// 因为 pandoc 版本之间的 reference-doc 格式有差异，且不想携带额外资源文件。
/// 直接改 zip 内容，对最终产物无条件保证字体正确。
pub fn normalize_docx_fonts(path: &Path) -> AppResult<()> {
    // 读取整个 zip 进内存
    let zip_bytes = std::fs::read(path).map_err(|e| AppError::io("读取 docx 文件失败", e))?;

    let mut archive = zip::ZipArchive::new(Cursor::new(&zip_bytes))
        .map_err(|e| AppError::new("docx_zip_open_failed", format!("打开 docx zip 失败：{e}")))?;

    // 把所有条目读进内存（名称 → 字节）
    let mut entries: Vec<(String, Vec<u8>, zip::CompressionMethod)> = Vec::new();
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| {
            AppError::new("docx_zip_read_failed", format!("读取 zip 条目失败：{e}"))
        })?;
        let name = file.name().to_owned();
        let compression = file.compression();
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buf).map_err(|e| {
            AppError::new("docx_zip_read_failed", format!("读取 zip 内容失败：{e}"))
        })?;
        entries.push((name, buf, compression));
    }
    drop(archive);

    // 改写目标条目
    for (name, data, _) in &mut entries {
        if name == "word/styles.xml" {
            let xml = String::from_utf8_lossy(data).into_owned();
            let patched = patch_styles_xml(&xml);
            *data = patched.into_bytes();
        } else if name == "word/theme/theme1.xml" {
            let xml = String::from_utf8_lossy(data).into_owned();
            let patched = patch_theme_xml(&xml);
            *data = patched.into_bytes();
        }
    }

    // 写回原路径
    let mut out = Cursor::new(Vec::new());
    {
        let mut zw = zip::ZipWriter::new(&mut out);
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data, _) in &entries {
            zw.start_file(name, options).map_err(|e| {
                AppError::new("docx_zip_write_failed", format!("写入 zip 条目失败：{e}"))
            })?;
            zw.write_all(data).map_err(|e| {
                AppError::new("docx_zip_write_failed", format!("写入 zip 内容失败：{e}"))
            })?;
        }
        zw.finish().map_err(|e| {
            AppError::new("docx_zip_write_failed", format!("完成 zip 写入失败：{e}"))
        })?;
    }

    std::fs::write(path, out.into_inner()).map_err(|e| AppError::io("写回 docx 文件失败", e))?;

    Ok(())
}

// ── styles.xml 改写 ──────────────────────────────────────────────────────────

/// 根据 styleId 判断字体分类。
enum FontClass {
    Heading,
    Code,
    Body, // 正文及其余样式
}

fn classify_style(style_id: &str) -> FontClass {
    match style_id {
        "Heading1" | "Heading2" | "Heading3" | "Heading4" | "Heading5" | "Heading6"
        | "Heading1Char" | "Heading2Char" | "Heading3Char" | "Heading4Char" | "Heading5Char"
        | "Heading6Char" | "Title" | "TitleChar" | "Subtitle" | "SubtitleChar" => {
            FontClass::Heading
        }
        "SourceCode" | "VerbatimChar" => FontClass::Code,
        _ => FontClass::Body,
    }
}

/// 构造 w:rFonts 属性字符串（不含主题引用属性）。
fn make_r_fonts(ea: &str, latin: &str) -> String {
    format!(
        r#"w:ascii="{latin}" w:hAnsi="{latin}" w:eastAsia="{ea}" w:cs="{latin}""#,
        latin = latin,
        ea = ea,
    )
}

/// 改写 word/styles.xml 的完整字体规范。
///
/// 策略（字符串处理，避免引入 XML 解析 crate）：
/// 1. 先改写 docDefaults/rPrDefault 里的 w:rFonts（正文兜底）
/// 2. 逐 <w:style> 块按 styleId 映射替换/插入 w:rFonts
/// 3. 删除 asciiTheme/hAnsiTheme/eastAsiaTheme/cstheme 属性
pub fn patch_styles_xml(xml: &str) -> String {
    // 第一步：改写 docDefaults 里的 rPrDefault rFonts
    let xml = patch_doc_defaults(xml);
    // 第二步：逐 style 块改写
    patch_style_blocks(&xml)
}

/// 改写 <w:docDefaults>...</w:docDefaults> 里 rPrDefault 内的 rFonts。
fn patch_doc_defaults(xml: &str) -> String {
    // 找 docDefaults 块
    let Some(start) = xml.find("<w:docDefaults") else {
        return xml.to_owned();
    };
    let Some(end_tag) = xml[start..].find("</w:docDefaults>") else {
        return xml.to_owned();
    };
    let end = start + end_tag + "</w:docDefaults>".len();

    let defaults_block = &xml[start..end];
    let patched_defaults =
        replace_or_insert_r_fonts_in_rpr(defaults_block, FONT_BODY_EA, FONT_BODY_LATIN);

    format!("{}{}{}", &xml[..start], patched_defaults, &xml[end..])
}

/// 逐个 <w:style ...>...</w:style> 块按分类改写 w:rFonts。
fn patch_style_blocks(xml: &str) -> String {
    let mut result = String::with_capacity(xml.len() + 512);
    let mut rest = xml;

    while let Some(block_start) = rest.find("<w:style ") {
        // 把 block_start 之前的内容直接 push
        result.push_str(&rest[..block_start]);
        rest = &rest[block_start..];

        // 找到 </w:style>
        let Some(block_end_rel) = rest.find("</w:style>") else {
            // 没有结束标签，保留剩余内容原样
            result.push_str(rest);
            return result;
        };
        let block_end = block_end_rel + "</w:style>".len();
        let block = &rest[..block_end];

        // 提取 w:styleId 属性值
        let style_id = extract_attr(block, "w:styleId").unwrap_or_default();
        let class = classify_style(style_id);

        let patched_block = match class {
            FontClass::Heading => {
                let block =
                    replace_or_insert_r_fonts_in_rpr(block, FONT_HEADING_EA, FONT_BODY_LATIN);
                // Pandoc 默认 reference.docx 给 Heading 1–5 使用 accent1 主题色，
                // 仅替换字体不会移除这层蓝色。标题颜色显式写黑，避免受主题影响。
                replace_or_insert_color_in_rpr(&block, "000000")
            }
            FontClass::Code => {
                replace_or_insert_r_fonts_in_rpr(block, FONT_BODY_EA, FONT_CODE_LATIN)
            }
            FontClass::Body => {
                // 正文：如果有 <w:rFonts> 就替换；没有就不插入（靠 docDefaults 兜底）
                if block.contains("<w:rFonts") {
                    replace_r_fonts(block, FONT_BODY_EA, FONT_BODY_LATIN)
                } else {
                    block.to_owned()
                }
            }
        };

        result.push_str(&patched_block);
        rest = &rest[block_end..];
    }

    // 尾部剩余内容
    result.push_str(rest);
    result
}

/// 在给定 XML 片段的 <w:rPr> 内替换或插入 <w:rFonts>。
/// 用于 docDefaults 和标题/代码类样式（需要保证有 rFonts）。
fn replace_or_insert_r_fonts_in_rpr(xml: &str, ea: &str, latin: &str) -> String {
    let fonts_tag = format!(r#"<w:rFonts {attrs}/>"#, attrs = make_r_fonts(ea, latin),);

    if xml.contains("<w:rFonts") {
        // 已有 rFonts：替换整个标签（包含属性）
        replace_r_fonts(xml, ea, latin)
    } else if let Some(rpr_end) = xml.find("</w:rPr>") {
        // rPr 存在但没有 rFonts：在 </w:rPr> 前插入
        let mut out = xml[..rpr_end].to_owned();
        out.push_str(&fonts_tag);
        out.push_str(&xml[rpr_end..]);
        out
    } else if let Some(rpr_start) = xml.find("<w:rPr>") {
        // 空 <w:rPr></w:rPr>（无属性版本）
        let after = rpr_start + "<w:rPr>".len();
        let mut out = xml[..after].to_owned();
        out.push_str(&fonts_tag);
        out.push_str(&xml[after..]);
        out
    } else {
        // 连 rPr 都没有：不插入（避免破坏结构）
        xml.to_owned()
    }
}

/// 替换片段内所有 <w:rFonts ...> 的属性，并删除主题引用属性。
fn replace_r_fonts(xml: &str, ea: &str, latin: &str) -> String {
    let new_attrs = make_r_fonts(ea, latin);
    let mut result = String::with_capacity(xml.len());
    let mut rest = xml;

    while let Some(tag_start) = rest.find("<w:rFonts") {
        result.push_str(&rest[..tag_start]);
        rest = &rest[tag_start..];

        // 找到标签结尾 />（pandoc 生成的 rFonts 是自闭合标签）
        let Some(tag_end) = rest.find("/>") else {
            result.push_str(rest);
            return result;
        };
        let tag_end = tag_end + "/>".len();

        // 写替换后的标签
        result.push_str(&format!("<w:rFonts {new_attrs}/>"));
        rest = &rest[tag_end..];
    }

    result.push_str(rest);
    result
}

/// 在样式的运行属性里替换或插入显式文字颜色，并移除 themeColor/themeShade。
fn replace_or_insert_color_in_rpr(xml: &str, color: &str) -> String {
    let color_tag = format!(r#"<w:color w:val="{color}"/>"#);

    if xml.contains("<w:color") {
        let mut result = String::with_capacity(xml.len());
        let mut rest = xml;
        while let Some(tag_start) = rest.find("<w:color") {
            result.push_str(&rest[..tag_start]);
            rest = &rest[tag_start..];
            let Some(tag_end) = rest.find("/>") else {
                result.push_str(rest);
                return result;
            };
            result.push_str(&color_tag);
            rest = &rest[tag_end + 2..];
        }
        result.push_str(rest);
        result
    } else if let Some(rpr_end) = xml.rfind("</w:rPr>") {
        format!("{}{}{}", &xml[..rpr_end], color_tag, &xml[rpr_end..])
    } else {
        xml.to_owned()
    }
}

/// 从 XML 片段里提取指定属性值（简单字符串扫描，够用于机器生成的 XML）。
fn extract_attr<'a>(xml: &'a str, attr: &str) -> Option<&'a str> {
    let needle = format!("{attr}=\"");
    let start = xml.find(&needle)? + needle.len();
    let end = xml[start..].find('"')?;
    Some(&xml[start..start + end])
}

// ── theme1.xml 改写 ──────────────────────────────────────────────────────────

/// 改写 word/theme/theme1.xml：
/// - majorFont 的 <a:latin typeface> 设 Calibri，<a:ea typeface> 设 黑体
/// - minorFont 的 <a:latin typeface> 设 Calibri，<a:ea typeface> 设 宋体
pub fn patch_theme_xml(xml: &str) -> String {
    let xml = set_theme_font(xml, "majorFont", "a:latin", FONT_BODY_LATIN);
    let xml = set_theme_font(&xml, "majorFont", "a:ea", FONT_HEADING_EA);
    let xml = set_theme_font(&xml, "minorFont", "a:latin", FONT_BODY_LATIN);
    set_theme_font(&xml, "minorFont", "a:ea", FONT_BODY_EA)
}

/// 在 <a:xxx> ... </a:xxx> 块内，把 <tag_name typeface="..."> 的值设为 typeface_value。
fn set_theme_font(xml: &str, parent_tag: &str, child_tag: &str, typeface_value: &str) -> String {
    let open = format!("<a:{parent_tag}>");
    let close = format!("</a:{parent_tag}>");
    let Some(start) = xml.find(&open) else {
        return xml.to_owned();
    };
    let Some(end_rel) = xml[start..].find(&close) else {
        return xml.to_owned();
    };
    let end = start + end_rel + close.len();

    let block = &xml[start..end];

    // 在 block 里找 <child_tag typeface="...">
    let tag_open = format!("<{child_tag} ");
    let patched_block = if let Some(t_start) = block.find(&tag_open) {
        let t_rest = &block[t_start..];
        let t_end = t_rest.find('>').map(|i| i + 1).unwrap_or(t_rest.len());
        let old_tag = &t_rest[..t_end];

        // 替换 typeface 属性值
        let new_tag = replace_typeface_attr(old_tag, typeface_value);
        format!("{}{}{}", &block[..t_start], new_tag, &t_rest[t_end..])
    } else {
        block.to_owned()
    };

    format!("{}{}{}", &xml[..start], patched_block, &xml[end..])
}

/// 替换 XML 标签字符串里的 typeface="..." 属性值。
fn replace_typeface_attr(tag: &str, value: &str) -> String {
    const NEEDLE: &str = "typeface=\"";
    if let Some(start) = tag.find(NEEDLE) {
        let attr_start = start + NEEDLE.len();
        if let Some(end_rel) = tag[attr_start..].find('"') {
            let end = attr_start + end_rel;
            return format!("{}{}{}", &tag[..attr_start], value, &tag[end..]);
        }
    }
    // 没有 typeface 属性则追加
    let insert_at = tag.len().saturating_sub(1); // 在 '>' 前
    format!("{} typeface=\"{}\"", &tag[..insert_at], value)
}

// ── 单元测试 ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── 纯字符串 fixture 测试（不依赖 pandoc）─────────────────────────────────

    /// 模拟 pandoc 生成的最小 styles.xml
    const FIXTURE_STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="TimesNewRoman" w:hAnsi="TimesNewRoman" w:eastAsia="TimesNewRoman" w:cs="TimesNewRoman" w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial" w:asciiTheme="majorHAnsi"/>
      <w:color w:themeColor="accent1" w:themeShade="BF" w:val="0F4761"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:rPr>
      <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>
    </w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="SourceCode">
    <w:rPr>
      <w:rFonts w:ascii="Courier" w:hAnsi="Courier" w:eastAsia="Courier" w:cs="Courier"/>
    </w:rPr>
  </w:style>
</w:styles>"#;

    const FIXTURE_THEME: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:fontScheme>
      <a:majorFont>
        <a:latin typeface="Cambria"/>
        <a:ea typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface=""/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>"#;

    #[test]
    fn styles_xml_heading_gets_hei_ti() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        // Heading1 里应出现黑体
        assert!(
            patched.contains("黑体"),
            "Heading 样式应包含黑体，实际：\n{patched}"
        );
    }

    #[test]
    fn styles_xml_heading_color_is_explicit_black() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        let heading_start = patched.find("w:styleId=\"Heading1\"").unwrap();
        let heading_end = heading_start
            + patched[heading_start..].find("</w:style>").unwrap()
            + "</w:style>".len();
        let heading = &patched[heading_start..heading_end];
        assert!(
            heading.contains(r#"<w:color w:val="000000"/>"#),
            "Heading 样式应显式为黑色，实际：\n{heading}"
        );
        assert!(
            !heading.contains("themeColor"),
            "Heading 样式不应继续继承主题色，实际：\n{heading}"
        );
    }

    #[test]
    fn styles_xml_code_gets_consolas() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        assert!(
            patched.contains("Consolas"),
            "SourceCode 样式应包含 Consolas，实际：\n{patched}"
        );
    }

    #[test]
    fn styles_xml_body_gets_song_ti() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        assert!(
            patched.contains("宋体"),
            "正文/docDefaults 应包含宋体，实际：\n{patched}"
        );
    }

    #[test]
    fn styles_xml_no_theme_refs() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        // asciiTheme 等主题引用属性应已被删除
        // （因为我们整体替换了 <w:rFonts> 标签，只保留四个显式属性）
        assert!(
            !patched.contains("asciiTheme"),
            "不应含有 asciiTheme，实际：\n{patched}"
        );
    }

    #[test]
    fn styles_xml_doc_defaults_song_ti() {
        let patched = patch_styles_xml(FIXTURE_STYLES);
        // docDefaults 里应写入宋体
        let dd_start = patched.find("<w:docDefaults").unwrap();
        let dd_end = patched.find("</w:docDefaults>").unwrap() + "</w:docDefaults>".len();
        let dd = &patched[dd_start..dd_end];
        assert!(dd.contains("宋体"), "docDefaults 应含宋体，实际：\n{dd}");
    }

    #[test]
    fn theme_xml_gets_correct_fonts() {
        let patched = patch_theme_xml(FIXTURE_THEME);
        assert!(
            patched.contains("黑体"),
            "majorFont ea 应为黑体，实际：\n{patched}"
        );
        assert!(
            patched.contains("宋体"),
            "minorFont ea 应为宋体，实际：\n{patched}"
        );
    }

    #[test]
    fn custom_args_support_quotes_without_using_a_shell() {
        let args = parse_pandoc_args(
            r#"--metadata title="季度 报告" --resource-path '/tmp/my assets' --fail-if-warnings"#,
        )
        .expect("参数应能解析");
        assert_eq!(
            args,
            [
                "--metadata",
                "title=季度 报告",
                "--resource-path",
                "/tmp/my assets",
                "--fail-if-warnings"
            ]
        );
    }

    #[test]
    fn custom_args_reject_app_managed_flags() {
        for raw in [
            "-o other.docx",
            "--output=other.docx",
            "--reference-doc=other.docx",
            "--extract-media=elsewhere",
            "-tdocx",
        ] {
            let error = parse_pandoc_args(raw).expect_err("应用管理的参数应被拒绝");
            assert_eq!(error.code, "pandoc_args_reserved");
        }
    }

    #[test]
    fn custom_args_reject_unclosed_quotes() {
        let error = parse_pandoc_args("--metadata 'title=未闭合").expect_err("未闭合引号应被拒绝");
        assert_eq!(error.code, "pandoc_args_invalid");
    }

    // ── 集成测试：需要真实 pandoc（不存在则跳过）──────────────────────────────

    #[test]
    fn export_and_normalize_with_real_pandoc() {
        let pandoc = match find_pandoc_full(None) {
            Some(p) => p,
            None => {
                eprintln!("skip: pandoc not found");
                return;
            }
        };

        let md = "# 标题一\n\n正文 **加粗** `code`\n\n```\ncode block\n```\n";
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let out = dir.path().join("test_out.docx");

        // 导出
        let options = PandocExportOptions {
            reference_doc: None,
            extra_args: Vec::new(),
            table_of_contents: false,
            number_sections: false,
        };
        run_export_docx(&pandoc, md, None, &out.to_string_lossy(), &options)
            .expect("export_docx 应成功");
        assert!(out.exists(), "docx 文件应存在");

        // 归一化字体
        normalize_docx_fonts(&out).expect("normalize 应成功");

        // 解包验证
        let bytes = std::fs::read(&out).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut styles_buf = Vec::new();
        archive
            .by_name("word/styles.xml")
            .unwrap()
            .read_to_end(&mut styles_buf)
            .unwrap();
        let styles = String::from_utf8_lossy(&styles_buf);
        assert!(styles.contains("宋体"), "styles.xml 应含宋体");
        assert!(styles.contains("黑体"), "styles.xml 应含黑体");
        assert!(!styles.contains("asciiTheme="), "不应含 asciiTheme=");
        let heading_start = styles.find("w:styleId=\"Heading1\"").unwrap();
        let heading_end = heading_start
            + styles[heading_start..].find("</w:style>").unwrap()
            + "</w:style>".len();
        let heading = &styles[heading_start..heading_end];
        assert!(heading.contains(r#"<w:color w:val="000000"/>"#));
        assert!(!heading.contains("themeColor"));
    }

    #[test]
    fn exports_editable_default_reference_doc() {
        let pandoc = match find_pandoc_full(None) {
            Some(path) => path,
            None => {
                eprintln!("skip: pandoc not found");
                return;
            }
        };
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let output = dir.path().join("reference.docx");
        run_export_default_template(&pandoc, &output).expect("默认模板应能导出");

        let bytes = std::fs::read(output).expect("默认模板应可读");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("模板应为有效 docx");
        assert!(archive.by_name("word/styles.xml").is_ok());
    }

    #[test]
    fn import_flattens_merged_docx_table_to_gfm() {
        let pandoc = match find_pandoc_full(None) {
            Some(p) => p,
            None => {
                eprintln!("skip: pandoc not found");
                return;
            }
        };

        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let html = dir.path().join("merged.html");
        let docx = dir.path().join("merged.docx");
        std::fs::write(
            &html,
            r#"<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td colspan="2">合并</td><td>值</td></tr></table>"#,
        )
        .unwrap();

        let status = make_command(&pandoc)
            .args([
                html.as_os_str(),
                std::ffi::OsStr::new("-f"),
                std::ffi::OsStr::new("html"),
                std::ffi::OsStr::new("-t"),
                std::ffi::OsStr::new("docx"),
                std::ffi::OsStr::new("-o"),
                docx.as_os_str(),
            ])
            .status()
            .expect("应能启动 pandoc");
        assert!(status.success(), "生成测试 docx 应成功");

        let imported = run_import_docx(&pandoc, &docx.to_string_lossy(), "assets", &[])
            .expect("导入 docx 应成功");
        let markdown = std::fs::read_to_string(imported.markdown_path).unwrap();
        assert!(
            markdown.contains("| A"),
            "应生成 GFM 管道表格：\n{markdown}"
        );
        assert!(markdown.contains("合并"));
        assert!(
            !markdown.contains("<table"),
            "不应残留原始 HTML：\n{markdown}"
        );
    }
}
