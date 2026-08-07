/// Pandoc 集成命令：检测 pandoc 路径、导出 docx、导入 docx。
///
/// 设计原则：
/// - macOS GUI 应用从 Finder 启动时 PATH 不含 /opt/homebrew/bin，
///   因此先按平台候选路径逐个探测，最后才尝试 PATH。
/// - normalize_docx_fonts 对 pandoc 生成的 docx 后处理，把 word/styles.xml
///   和 word/theme/theme1.xml 里的字体归一化为指定规范，不依赖 pandoc 版本。
use crate::commands::app::open_path_with_default_app;
use crate::domain::academic_layout::AcademicLayout;
use crate::domain::error::{AppError, AppResult};
use crate::infrastructure::{docx_xml, settings::SettingsStore, workspace};
use serde::Serialize;
use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
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
const PANDOC_STATUS_TIMEOUT: Duration = Duration::from_secs(10);
const PANDOC_JOB_TIMEOUT: Duration = Duration::from_secs(120);

fn join_pipe(
    handle: Option<thread::JoinHandle<std::io::Result<Vec<u8>>>>,
    context: &str,
) -> AppResult<Vec<u8>> {
    match handle {
        Some(handle) => handle
            .join()
            .map_err(|_| AppError::new("pandoc_pipe_failed", format!("{context}线程异常退出")))?
            .map_err(|error| AppError::io(context, error)),
        None => Ok(Vec::new()),
    }
}

fn wait_for_output(mut child: Child, timeout: Duration, context: &str) -> AppResult<Output> {
    let stdout = child.stdout.take().map(|mut pipe| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.read_to_end(&mut bytes)?;
            Ok(bytes)
        })
    });
    let stderr = child.stderr.take().map(|mut pipe| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            pipe.read_to_end(&mut bytes)?;
            Ok(bytes)
        })
    });
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| AppError::new("pandoc_wait_failed", format!("{context}：{error}")))?
        {
            return Ok(Output {
                status,
                stdout: join_pipe(stdout, "读取 Pandoc 标准输出失败")?,
                stderr: join_pipe(stderr, "读取 Pandoc 错误输出失败")?,
            });
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let status = child.wait().map_err(|error| {
                AppError::new(
                    "pandoc_wait_failed",
                    format!("终止超时的 {context} 失败：{error}"),
                )
            })?;
            let _ = join_pipe(stdout, "读取 Pandoc 标准输出失败");
            let _ = join_pipe(stderr, "读取 Pandoc 错误输出失败");
            return Err(AppError::new(
                "pandoc_timeout",
                format!(
                    "{context}超过 {} 秒，已终止进程（{status}）",
                    timeout.as_secs()
                ),
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn command_output(mut command: Command, timeout: Duration, context: &str) -> AppResult<Output> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = command
        .spawn()
        .map_err(|error| AppError::new("pandoc_spawn_failed", format!("{context}：{error}")))?;
    wait_for_output(child, timeout, context)
}

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
    let mut command = make_command(Path::new("pandoc"));
    command.arg("--version");
    let ok = command_output(command, PANDOC_STATUS_TIMEOUT, "检测 Pandoc")
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
    let mut command = make_command(Path::new("pandoc"));
    command.arg("--version");
    let ok = command_output(command, PANDOC_STATUS_TIMEOUT, "检测 Pandoc")
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

    let mut command = make_command(&pandoc_path);
    command.arg("--version");
    let output = command_output(command, PANDOC_STATUS_TIMEOUT, "执行 Pandoc")?;

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

/// docx 生成之后、原子替换目标文件之前要做的后处理。三个真实导出与预览
/// 导出两条路径共用同一份，分开传会让调用点变成一串分不清含义的 bool。
#[derive(Debug, Clone)]
struct DocxPostProcessing {
    normalize_fonts: bool,
    apply_academic_layout: bool,
    layout: AcademicLayout,
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

    let normalize_fonts = settings.pandoc_normalize_fonts;
    let apply_academic_layout = settings.pandoc_academic_layout;
    let layout = settings.academic_layout.clone();
    crate::commands::blocking(move || {
        run_export_default_template(
            &pandoc_path,
            Path::new(&output_path_for_task),
            normalize_fonts,
            apply_academic_layout,
            &layout,
        )
    })
    .await?;

    Ok(ExportDocxResult { path: output_path })
}

fn run_export_default_template(
    pandoc_path: &Path,
    output_path: &Path,
    normalize_fonts: bool,
    apply_academic_layout: bool,
    layout: &AcademicLayout,
) -> AppResult<()> {
    let mut command = make_command(pandoc_path);
    command.args(["--print-default-data-file", "reference.docx"]);
    let result = command_output(command, PANDOC_JOB_TIMEOUT, "读取 Pandoc 默认模板")?;
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
        .map_err(|error| AppError::io("写入默认 Word 模板失败", error))?;
    // 导出的模板要和实际导出结果长得一样，所以跟着同一个开关走。
    if apply_academic_layout {
        apply_academic_layout_to_docx(output_path, normalize_fonts, layout)
    } else if normalize_fonts {
        normalize_docx_fonts(output_path)
    } else {
        Ok(())
    }
}

/// 解析并校验设置里的自定义 Word 模板路径；未设置时返回 `None`（走内置模板）。
/// `export_docx` 和 `preview_academic_docx` 共用——后者也要在预览里如实反映
/// "自定义模板 + 论文排版参数"这个组合，不能自己单独一套判断。
fn resolve_reference_doc(
    app: &AppHandle,
    reference_doc_setting: &str,
) -> AppResult<Option<PathBuf>> {
    let trimmed = reference_doc_setting.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let path = PathBuf::from(trimmed);
    workspace::ensure_allowed(app, &path)?;
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
    Ok(Some(path))
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
    workspace::ensure_write_allowed(&app, Path::new(&output_path))?;
    if let Some(dir) = doc_dir.as_deref() {
        workspace::ensure_allowed(&app, Path::new(dir))?;
    }
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

    let reference_doc = resolve_reference_doc(&app, &settings.pandoc_reference_doc)?;
    let options = PandocExportOptions {
        reference_doc,
        extra_args: parse_pandoc_args(&settings.pandoc_export_args)?,
        table_of_contents: settings.pandoc_toc,
        number_sections: settings.pandoc_number_sections,
    };
    let post = DocxPostProcessing {
        normalize_fonts: settings.pandoc_normalize_fonts,
        apply_academic_layout: settings.pandoc_academic_layout,
        layout: settings.academic_layout.clone(),
    };

    // 在 spawn_blocking 里执行 Pandoc、字体后处理和最终原子替换，避免阻塞
    // Tauri 异步运行时，也避免失败时把半成品留在用户选择的目标路径。
    let pandoc_path2 = pandoc_path.clone();
    let markdown2 = markdown.clone();
    let doc_dir2 = doc_dir.clone();
    let output_path2 = output_path.clone();

    crate::commands::blocking(move || {
        run_export_docx_atomic(
            &pandoc_path2,
            &markdown2,
            doc_dir2.as_deref(),
            Path::new(&output_path2),
            &options,
            &post,
        )
    })
    .await?;

    Ok(ExportDocxResult { path: output_path })
}

/// 论文排版预览：把当前文档按给定的排版参数导出成一份临时 docx，交给系统
/// 默认程序（Word/Pages/…）打开，供用户在真实渲染下核对效果，改完再回来调。
///
/// 与 `export_docx` 的关键差异：
/// - `layout` 由调用方直接传入，不从持久化设置读——用户很可能还在拖滑块，
///   没点保存就想先看看效果，这是这个命令存在的全部意义。
/// - 目标路径由本命令自己在系统临时目录里选定，不接受前端传入的任意路径：
///   预览用途不需要那份自由度，还能省一次「另存为」对话框。
/// - `apply_academic_layout` 恒为 true：点「预览效果」这个动作本身就是想看
///   参数生效的样子，不管持久化设置里那个总开关当前是否勾选。
///
/// 会读取 `pandoc_reference_doc`（如果设置了）：真实导出现在允许"自定义模板 +
/// 论文排版"组合生效，预览也要如实反映这个组合，而不是永远只演示内置模板。
#[tauri::command]
pub async fn preview_academic_docx(
    app: AppHandle,
    settings_store: State<'_, SettingsStore>,
    markdown: String,
    layout: AcademicLayout,
) -> AppResult<()> {
    let mut layout = layout;
    layout.sanitize();
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

    let reference_doc = resolve_reference_doc(&app, &settings.pandoc_reference_doc)?;
    let options = PandocExportOptions {
        reference_doc,
        extra_args: Vec::new(),
        table_of_contents: false,
        number_sections: false,
    };
    let post = DocxPostProcessing {
        normalize_fonts: settings.pandoc_normalize_fonts,
        apply_academic_layout: true,
        layout,
    };

    crate::commands::blocking(move || {
        let mut last_error = None;
        for output_path in preview_output_candidates() {
            match run_export_docx_atomic(
                &pandoc_path,
                &markdown,
                None,
                &output_path,
                &options,
                &post,
            ) {
                Ok(()) => return open_path_with_default_app(&output_path),
                // 最常见的失败原因：固定文件名还被上一次预览打开的 Word 占着，
                // 覆盖/改名失败。换一个带时间戳的名字重试，而不是让用户先手动
                // 关掉旧预览才能看到新的。
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| AppError::new("preview_docx_failed", "生成预览文档失败")))
    })
    .await
}

/// 预览文档的候选输出路径：固定名在前（重复预览时直接覆盖，不在临时目录堆
/// 文件），带时间戳的备用名在后（固定名被占用时的退路）。
fn preview_output_candidates() -> [PathBuf; 2] {
    let dir = std::env::temp_dir();
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    [
        dir.join("Xiangzi MD 论文排版预览.docx"),
        dir.join(format!("Xiangzi MD 论文排版预览 {millis}.docx")),
    ]
}

/// `layout` 在 `apply_academic_layout` 为 false 或使用了自定义 reference.docx
/// 时不生效，但签名上始终要求传入——调用方（真实导出、预览导出）本来就总是
/// 手头有一份 AcademicLayout，不值得为了省一个引用而拆成两个函数。
fn run_export_docx_atomic(
    pandoc_path: &Path,
    markdown: &str,
    doc_dir: Option<&str>,
    output_path: &Path,
    options: &PandocExportOptions,
    post: &DocxPostProcessing,
) -> AppResult<()> {
    let parent = output_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "Word 导出路径没有父目录"))?;
    let temporary = tempfile::Builder::new()
        .prefix(".xmd-word-export-")
        .suffix(".docx")
        .tempfile_in(parent)
        .map_err(|error| AppError::io("创建 Word 导出临时文件失败", error))?
        .into_temp_path();
    let temporary_string = temporary.to_string_lossy().into_owned();

    run_export_docx(pandoc_path, markdown, doc_dir, &temporary_string, options)?;
    // 论文排版参数独立于是否选了自定义 reference.docx：pandoc 无论从内置模板
    // 还是自定义模板生成 docx，输出里的命名样式（BodyText/Heading1-6/Title/…）
    // 都是同一套 ID，只是外观来自不同的模板——在这些样式上打补丁对两种情况
    // 都成立，所以用户可以选"自定义模板 + 论文排版"的组合，而不是二选一。
    if post.apply_academic_layout {
        apply_academic_layout_to_docx(&temporary, post.normalize_fonts, &post.layout)?;
    } else if post.normalize_fonts {
        normalize_docx_fonts(&temporary)?;
    }
    temporary
        .persist(output_path)
        .map_err(|error| AppError::io("保存 Word 导出文件失败", error.error))?;
    Ok(())
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

    let result = wait_for_output(child, PANDOC_JOB_TIMEOUT, "Pandoc Word 导出")?;

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
    crate::domain::safe_name::validate_item_name(&media_subdir)?;
    let source_path = PathBuf::from(&docx_path);
    workspace::ensure_allowed(&app, &source_path)?;
    let source_dir = source_path
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "无法确定 docx 文件所在目录"))?;
    // 导入会在源 docx 同级创建 Markdown 和媒体目录。只有已经由系统选择器授权的
    // 源文件才能触发，并且授权严格停在它的直接父目录。
    workspace::authorize_directory(&app, source_dir)?;
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

    let child = cmd
        .spawn()
        .map_err(|e| AppError::new("pandoc_spawn_failed", format!("启动 pandoc 失败：{e}")))?;
    let result = wait_for_output(child, PANDOC_JOB_TIMEOUT, "Pandoc Word 导入")?;

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
    rewrite_docx_parts(path, None, true)
}

/// 给一份 pandoc 生成的 docx 打上论文排版补丁。
///
/// 不区分这份 docx 是从内置模板还是自定义 reference.docx 转换来的——pandoc
/// 输出里的命名样式 ID 是固定的一套（BodyText/Heading1-6/Title/…），补丁只
/// 改这些样式的属性，同样适用于两种来源。调用方：真实导出（可能带自定义
/// 模板）、导出可编辑模板副本（永远是内置模板）。
fn apply_academic_layout_to_docx(
    path: &Path,
    normalize_fonts: bool,
    layout: &AcademicLayout,
) -> AppResult<()> {
    rewrite_docx_parts(path, Some(layout), normalize_fonts)
}

/// 读取并改写 docx 中的样式、主题、页面设置和内置页脚 XML。
/// `layout` 为 Some 时套用论文排版（样式 + 页面设置 + 页脚），None 时只做字体规范化。
fn rewrite_docx_parts(
    path: &Path,
    layout: Option<&AcademicLayout>,
    normalize_fonts: bool,
) -> AppResult<()> {
    let apply_academic_styles = layout.is_some();
    let apply_page_layout = layout.is_some();
    // 页码页脚是可以单独关掉的一项（layout.page_number_footer），跟纸张/页边距
    // 分开判断——那两项没有单独开关，只要套论文排版就总是生效。
    let apply_page_number = layout.is_some_and(|value| value.page_number_footer);
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

    let footer_plan = apply_page_number.then(|| plan_footer(&entries));

    // 改写目标条目
    for (name, data, _) in &mut entries {
        if name == "word/styles.xml" {
            let xml = String::from_utf8_lossy(data).into_owned();
            let xml = if apply_academic_styles {
                patch_academic_styles_xml(
                    &xml,
                    layout.expect("apply_academic_styles 蕴含 layout 存在"),
                )
            } else {
                xml
            };
            let patched = if normalize_fonts {
                patch_styles_xml(&xml)
            } else {
                xml
            };
            *data = patched.into_bytes();
        } else if normalize_fonts && name == "word/theme/theme1.xml" {
            let xml = String::from_utf8_lossy(data).into_owned();
            let patched = patch_theme_xml(&xml);
            *data = patched.into_bytes();
        } else if apply_page_layout && name == "word/document.xml" {
            let xml = String::from_utf8_lossy(data).into_owned();
            let xml = patch_document_page_layout(
                &xml,
                footer_plan.as_ref().map(|plan| plan.rel_id.as_str()),
                layout.expect("apply_page_layout 蕴含 layout 存在"),
            );
            let patched =
                patch_list_paragraphs(&xml, layout.expect("apply_page_layout 蕴含 layout 存在"));
            *data = patched.into_bytes();
        } else if let (Some(plan), "word/_rels/document.xml.rels") =
            (footer_plan.as_ref(), name.as_str())
        {
            let xml = String::from_utf8_lossy(data).into_owned();
            let patched = patch_document_relationships(&xml, &plan.rel_id, plan.target());
            *data = patched.into_bytes();
        } else if let (Some(plan), "[Content_Types].xml") = (footer_plan.as_ref(), name.as_str()) {
            let xml = String::from_utf8_lossy(data).into_owned();
            let patched = patch_content_types(&xml, &plan.part_name);
            *data = patched.into_bytes();
        }
    }

    // plan_footer 挑的是空闲部件名，所以这里一定是新增而不是覆盖已有页脚。
    if let Some(plan) = &footer_plan {
        entries.push((
            plan.part_name.clone(),
            DEFAULT_FOOTER_XML.as_bytes().to_vec(),
            zip::CompressionMethod::Deflated,
        ));
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

const DEFAULT_FOOTER_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>"#;

/// 页码页脚要写进哪个部件、用哪个关系 ID。
struct FooterPlan {
    /// zip 内的部件路径，例如 `word/footer1.xml`。
    part_name: String,
    /// `word/_rels/document.xml.rels` 里的关系 ID。
    rel_id: String,
}

impl FooterPlan {
    /// 关系里的 `Target` 是相对 `word/` 的文件名。
    fn target(&self) -> &str {
        self.part_name
            .strip_prefix("word/")
            .unwrap_or(&self.part_name)
    }
}

/// 为页码页脚挑一个不冲突的部件名和关系 ID。
///
/// 刻意不复用模板自带的 footer：模板里的页脚是模板作者的内容（常放单位名称、
/// logo），直接覆盖会毁掉它；而反过来复用它的关系 ID，等于用户勾了「居中页码」
/// 却什么都没发生。所以另起一个空闲部件名，让这个开关始终说到做到，模板原有
/// 的页脚部件仍原样留在包里。
///
/// pandoc 内置模板不带页脚，这里会照旧选中 `word/footer1.xml` + `rIdFooter1`，
/// 所以默认导出的产物一个字节都不变。
fn plan_footer(entries: &[(String, Vec<u8>, zip::CompressionMethod)]) -> FooterPlan {
    let part_name = (1..=99)
        .map(|index| format!("word/footer{index}.xml"))
        .find(|candidate| !entries.iter().any(|(name, _, _)| name == candidate))
        .unwrap_or_else(|| "word/footer1.xml".into());

    let rels = entries
        .iter()
        .find(|(name, _, _)| name == "word/_rels/document.xml.rels")
        .map(|(_, data, _)| String::from_utf8_lossy(data).into_owned())
        .unwrap_or_default();
    let rel_id = (1..=99)
        .map(|index| format!("rIdFooter{index}"))
        .find(|candidate| !rels.contains(&format!(r#"Id="{candidate}""#)))
        .unwrap_or_else(|| "rIdFooter1".into());

    FooterPlan { part_name, rel_id }
}

/// 为文档增加 A4 页面、约 2.5 cm 页边距和默认页码页脚。
/// 定位文档级（body 末尾的那一个）`w:sectPr`。
///
/// 不能直接取第一个：文档里有分节符时，靠前的 `w:sectPr` 是段落级的
/// （包在 `w:pPr` 里），页面设置写到那上面只会改到其中一节。文档级的那个
/// 永远是 body 的最后一个子元素，所以从后往前找。
fn body_section_start(xml: &str) -> Option<usize> {
    let body_end = xml.rfind("</w:body>").unwrap_or(xml.len());
    let mut offset = 0;
    let mut found = None;
    while let Some(relative) = find_word_tag_start(&xml[offset..], "<w:sectPr") {
        let start = offset + relative;
        if start >= body_end {
            break;
        }
        // 段落级的 sectPr 一定位于某个 w:pPr 内部，文档级的不是。
        let enclosing_paragraph_properties = xml[..start]
            .rfind("<w:pPr")
            .is_some_and(|ppr| xml[ppr..start].find("</w:pPr>").is_none());
        if !enclosing_paragraph_properties {
            found = Some(start);
        }
        offset = start + "<w:sectPr".len();
    }
    found
}

/// `footer_rel_id` 为 `None` 时表示 `layout.page_number_footer` 关闭：只套用
/// 纸张/页边距，不插入页码页脚引用（那两项没有单独开关，只要套论文排版就
/// 总是生效）。
fn patch_document_page_layout(
    xml: &str,
    footer_rel_id: Option<&str>,
    layout: &AcademicLayout,
) -> String {
    let (page_width, page_height) = layout.paper.dimensions_twips();
    let margin = layout.margin();
    let page_size = format!(r#"<w:pgSz w:w="{page_width}" w:h="{page_height}"/>"#);
    // header/footer 距边 708 缇（约 1.25cm）是 Word 的默认距离，跟着页边距走
    // 反而会让页眉页脚贴到正文，所以保持固定。
    let page_margins = format!(
        r#"<w:pgMar w:top="{margin}" w:right="{margin}" w:bottom="{margin}" w:left="{margin}" w:header="708" w:footer="708" w:gutter="0"/>"#
    );
    let footer_reference = footer_rel_id
        .map(|id| format!(r#"<w:footerReference w:type="default" r:id="{id}"/>"#))
        .unwrap_or_default();

    let Some(section_start) = body_section_start(xml) else {
        return xml.to_owned();
    };
    let Some(span) = docx_xml::find_element(&xml[section_start..], "w:sectPr") else {
        return xml.to_owned();
    };
    let section_end = section_start + span.outer.end;
    let mut section = xml[section_start..section_end].to_owned();

    // CT_SectPr（ECMA-376）规定的子元素顺序节选：footerReference 在
    // footnotePr/endnotePr 之前，pgSz/pgMar 在它们之后、pgNumType 等更靠后的
    // 属性之前。这张表把这几个位置都列全，而不是只列会被插入的三个标签——
    // 否则自定义模板如果带着 footnotePr 这类我们不插入、但顺序上排在中间的
    // 元素，pgSz/pgMar 会因为"锚点不认识它"被错误地插到它前面。
    const ORDER: &[&str] = &[
        "w:footerReference",
        "w:footnotePr",
        "w:endnotePr",
        "w:pgSz",
        "w:pgMar",
        "w:pgNumType",
        "w:formProt",
        "w:textDirection",
        "w:bidi",
        "w:rtlGutter",
        "w:docGrid",
    ];
    if footer_rel_id.is_some() {
        section = docx_xml::upsert_self_child(
            &section,
            "w:sectPr",
            "w:footerReference",
            &footer_reference,
            ORDER,
        );
    }
    section = docx_xml::upsert_self_child(&section, "w:sectPr", "w:pgSz", &page_size, ORDER);
    section = docx_xml::upsert_self_child(&section, "w:sectPr", "w:pgMar", &page_margins, ORDER);

    format!(
        "{}{}{}",
        &xml[..section_start],
        section,
        &xml[section_end..]
    )
}

/// 列表段落使用 Compact 样式，但其行距应与正文统一为 1.5 倍；
/// 直接写入含 w:numPr 的段落，避免同时改变表格单元格的紧凑行距。
fn patch_list_paragraphs(xml: &str, layout: &AcademicLayout) -> String {
    let body_line = layout.body_line();
    let list_spacing =
        format!(r#"<w:spacing w:before="0" w:after="0" w:line="{body_line}" w:lineRule="auto"/>"#);
    let mut result = String::with_capacity(xml.len() + 256);
    let mut rest = xml;

    while let Some(relative_start) = find_word_tag_start(rest, "<w:p") {
        result.push_str(&rest[..relative_start]);
        rest = &rest[relative_start..];
        let Some(relative_end) = rest.find("</w:p>") else {
            result.push_str(rest);
            return result;
        };
        let paragraph_end = relative_end + "</w:p>".len();
        let paragraph = &rest[..paragraph_end];
        let patched = if paragraph.contains("<w:numPr") {
            upsert_in_paragraph_ppr(paragraph, "w:spacing", &list_spacing)
        } else {
            paragraph.to_owned()
        };
        result.push_str(&patched);
        rest = &rest[paragraph_end..];
    }

    result.push_str(rest);
    result
}

/// 为页脚部件登记一条关系。`target` 是相对 `word/` 的文件名。
fn patch_document_relationships(xml: &str, footer_rel_id: &str, target: &str) -> String {
    // 按关系 ID 判重而不是按 Target：模板自带的页脚有它自己的 Target，我们写的
    // 是另一个部件，两者本来就应该共存。
    if xml.contains(&format!(r#"Id="{footer_rel_id}""#)) {
        return xml.to_owned();
    }
    let relationship = format!(
        r#"<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Id="{footer_rel_id}" Target="{target}"/>"#
    );
    let Some(insert_at) = xml.rfind("</Relationships>") else {
        return xml.to_owned();
    };
    format!("{}{}{}", &xml[..insert_at], relationship, &xml[insert_at..])
}

/// 为页脚部件登记 content type。`part_name` 是 zip 内路径，如 `word/footer1.xml`。
fn patch_content_types(xml: &str, part_name: &str) -> String {
    let part = format!("/{part_name}");
    if xml.contains(&format!(r#"PartName="{part}""#)) {
        return xml.to_owned();
    }
    let footer_override = format!(
        r#"<Override PartName="{part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>"#
    );
    let Some(insert_at) = xml.rfind("</Types>") else {
        return xml.to_owned();
    };
    format!(
        "{}{}{}",
        &xml[..insert_at],
        footer_override,
        &xml[insert_at..]
    )
}

// ── styles.xml 改写 ──────────────────────────────────────────────────────────

/// 为内置 reference.docx 增加一套中文论文常用的排版样式。
///
/// 这里只处理论文直接使用的样式：题名、作者信息、摘要、正文标题、题注、
/// 参考文献和默认表格线。代码、引用、脚注、目录等其他 Pandoc 样式保持原样。
pub fn patch_academic_styles_xml(xml: &str, layout: &AcademicLayout) -> String {
    let mut xml = xml.to_owned();

    // 由排版参数导出的几段属性值。取值和单位换算见 domain::academic_layout；
    // 这里一律用数字插值，不做字符串拼接式的"找位置再塞进去"——参数一旦来自
    // 用户设置，拼接就是让非法值溜进 XML 的地方。
    let body_line = layout.body_line();
    let body_spacing =
        format!(r#"<w:spacing w:before="0" w:after="0" w:line="{body_line}" w:lineRule="auto"/>"#);
    let abstract_spacing = format!(
        r#"<w:spacing w:before="0" w:after="120" w:line="{body_line}" w:lineRule="auto"/>"#
    );
    let body_indent = format!(r#"<w:ind w:firstLine="{}"/>"#, layout.first_line_indent());
    let bibliography_hanging = layout.bibliography_hanging();
    let bibliography_indent =
        format!(r#"<w:ind w:left="{bibliography_hanging}" w:hanging="{bibliography_hanging}"/>"#);

    // 普通正文：宋体小四（字体由 normalize_docx_fonts 按开关决定），1.5 倍行距，
    // 首行缩进两个汉字符。标题和题注会显式清除这个缩进。
    for style_id in ["BodyText", "FirstParagraph"] {
        xml = patch_style_block_by_id(&xml, style_id, |block| {
            patch_paragraph_style(
                block,
                &ParagraphStyle {
                    spacing: Some(&body_spacing),
                    indent: Some(&body_indent),
                    size: Some(layout.body_size()),
                    ..ParagraphStyle::default()
                },
            )
        });
    }

    // Compact 是列表和表格单元格常用的父样式。明确清除正文首行缩进，
    // 并保留其原有的紧凑单倍行距，避免正文规则向这些非正文结构传播。
    xml = patch_style_block_by_id(&xml, "Compact", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(
                    r#"<w:spacing w:before="36" w:after="36" w:line="240" w:lineRule="auto"/>"#,
                ),
                indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                ..ParagraphStyle::default()
            },
        )
    });
    // BlockText 已经有左右缩进，但需要显式保留原来的单倍行距。
    xml = patch_style_block_by_id(&xml, "BlockText", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(
                    r#"<w:spacing w:before="100" w:after="100" w:line="240" w:lineRule="auto"/>"#,
                ),
                indent: Some(r#"<w:ind w:firstLine="0" w:left="480" w:right="480"/>"#),
                ..ParagraphStyle::default()
            },
        )
    });

    // 题名、作者、日期和副标题居中；题名使用小二号量级（18pt）。
    xml = patch_style_block_by_id(&xml, "Title", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(
                    r#"<w:spacing w:before="0" w:after="160" w:line="240" w:lineRule="auto"/>"#,
                ),
                indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                alignment: Some(r#"<w:jc w:val="center"/>"#),
                size: Some(layout.title_size()),
                bold: Some(true),
                ..ParagraphStyle::default()
            },
        )
    });
    xml = patch_style_block_by_id(&xml, "TitleChar", |block| {
        patch_run_style(block, Some(layout.title_size()), Some(true), None)
    });
    for style_id in ["Subtitle", "Author", "Date"] {
        xml = patch_style_block_by_id(&xml, style_id, |block| {
            patch_paragraph_style(
                block,
                &ParagraphStyle {
                    spacing: Some(
                        r#"<w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/>"#,
                    ),
                    indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                    alignment: Some(r#"<w:jc w:val="center"/>"#),
                    size: Some(layout.body_size()),
                    ..ParagraphStyle::default()
                },
            )
        });
    }
    xml = patch_style_block_by_id(&xml, "SubtitleChar", |block| {
        patch_run_style(block, Some(layout.body_size()), None, None)
    });

    // 摘要标题加粗居中，摘要正文使用小四号并保持段落间距。
    xml = patch_style_block_by_id(&xml, "AbstractTitle", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(
                    r#"<w:spacing w:before="240" w:after="80" w:line="240" w:lineRule="auto"/>"#,
                ),
                indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                alignment: Some(r#"<w:jc w:val="center"/>"#),
                size: Some(layout.body_size()),
                bold: Some(true),
                ..ParagraphStyle::default()
            },
        )
    });
    xml = patch_style_block_by_id(&xml, "Abstract", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(&abstract_spacing),
                indent: Some(&body_indent),
                size: Some(layout.body_size()),
                ..ParagraphStyle::default()
            },
        )
    });

    // 正文标题统一黑色、加粗并左对齐，保留 Pandoc 的 1–6 级标题结构。
    for (level, style_id, before, after) in [
        (1, "Heading1", 240, 120),
        (2, "Heading2", 180, 80),
        (3, "Heading3", 120, 60),
        (4, "Heading4", 120, 60),
        (5, "Heading5", 120, 60),
        (6, "Heading6", 120, 60),
    ] {
        let size = layout.heading_size(level);
        let body_line = layout.body_line();
        let spacing = format!(
            r#"<w:spacing w:before="{before}" w:after="{after}" w:line="{body_line}" w:lineRule="auto"/>"#
        );
        xml = patch_style_block_by_id(&xml, style_id, |block| {
            let block = patch_paragraph_style(
                block,
                &ParagraphStyle {
                    spacing: Some(&spacing),
                    indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                    alignment: Some(r#"<w:jc w:val="left"/>"#),
                    size: Some(size),
                    bold: Some(true),
                    ..ParagraphStyle::default()
                },
            );
            replace_or_insert_color_in_rpr(&block, "000000")
        });
        let char_style_id = format!("{style_id}Char");
        xml = patch_style_block_by_id(&xml, &char_style_id, |block| {
            let block = patch_run_style(block, Some(size), Some(true), None);
            replace_or_insert_color_in_rpr(&block, "000000")
        });
    }

    // 表题、图题和其他题注使用五号、居中、非斜体；表题位于表上方，图题位于图下方
    // 的位置由 Pandoc/Word 的题注段落顺序决定。
    for style_id in ["Caption", "TableCaption", "ImageCaption"] {
        xml = patch_style_block_by_id(&xml, style_id, |block| {
            patch_paragraph_style(
                block,
                &ParagraphStyle {
                    spacing: Some(
                        r#"<w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>"#,
                    ),
                    indent: Some(r#"<w:ind w:firstLine="0" w:left="0" w:right="0"/>"#),
                    alignment: Some(r#"<w:jc w:val="center"/>"#),
                    size: Some(layout.caption_size()),
                    italic: Some(false),
                    ..ParagraphStyle::default()
                },
            )
        });
    }

    // 参考文献使用五号、单倍行距，并采用两个汉字符的悬挂缩进。
    xml = patch_style_block_by_id(&xml, "Bibliography", |block| {
        patch_paragraph_style(
            block,
            &ParagraphStyle {
                spacing: Some(
                    r#"<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>"#,
                ),
                indent: Some(&bibliography_indent),
                alignment: Some(r#"<w:jc w:val="left"/>"#),
                size: Some(layout.bibliography_size()),
                ..ParagraphStyle::default()
            },
        )
    });

    let xml = if layout.three_line_table {
        patch_table_style(&xml)
    } else {
        xml
    };
    if layout.code_block_bordered {
        patch_code_block_border(&xml)
    } else {
        xml
    }
}

/// `<w:style>` 直接子元素的相对顺序（CT_Style，ECMA-376 节选）：pPr 在 rPr 之前。
/// 只列这份代码实际会新建的两个标签，不是完整 schema。
const STYLE_CHILD_ORDER: &[&str] = &["w:pPr", "w:rPr"];

/// `<w:pPr>` 直接子元素的相对顺序（CT_PPr 节选）：pBdr、wordWrap 在前，
/// spacing/ind/jc 在后。跨 `patch_code_block_border`/`patch_paragraph_style`/
/// `patch_list_paragraphs` 共用同一张表，而不是各自维护一份——这正是这次重写
/// 想要的效果：OOXML 顺序知识只在一个地方维护。
const PPR_CHILD_ORDER: &[&str] = &["w:pBdr", "w:wordWrap", "w:spacing", "w:ind", "w:jc"];

/// `<w:rPr>` 直接子元素的相对顺序（CT_RPr 节选）：rFonts 最先，然后 b/i，
/// 然后 color，最后 sz/szCs。字体规范化（`patch_style_blocks`）和论文排版
/// （`patch_paragraph_style`/`patch_run_style`）都会在同一个 rPr 上插入内容，
/// 且论文排版先跑一遍——共用这张表两边的插入才能正确交错，而不是各按各的
/// 顺序表各自追加、最终顺序取决于谁先跑。
const RPR_CHILD_ORDER: &[&str] = &["w:rFonts", "w:b", "w:i", "w:color", "w:sz", "w:szCs"];

/// 在 `block`（一份完整的 `<w:style>...</w:style>`）的 `w:pPr` 里插入/替换一个
/// 子元素；`w:pPr` 整个不存在就连它一起按 [`STYLE_CHILD_ORDER`] 新建。
fn upsert_in_style_ppr(block: &str, tag: &str, fragment: &str) -> String {
    let Some(style) = docx_xml::find_element(block, "w:style") else {
        return block.to_owned();
    };
    match docx_xml::find_direct_child(block, &style, "w:pPr") {
        Some(ppr) => docx_xml::upsert_ordered_child(block, &ppr, tag, fragment, PPR_CHILD_ORDER),
        None => {
            let fresh = format!("<w:pPr>{fragment}</w:pPr>");
            docx_xml::upsert_ordered_child(block, &style, "w:pPr", &fresh, STYLE_CHILD_ORDER)
        }
    }
}

/// 同 [`upsert_in_style_ppr`]，作用在 `w:rPr` 上。
fn upsert_in_style_rpr(block: &str, tag: &str, fragment: &str) -> String {
    let Some(style) = docx_xml::find_element(block, "w:style") else {
        return block.to_owned();
    };
    match docx_xml::find_direct_child(block, &style, "w:rPr") {
        Some(rpr) => docx_xml::upsert_ordered_child(block, &rpr, tag, fragment, RPR_CHILD_ORDER),
        None => {
            let fresh = format!("<w:rPr>{fragment}</w:rPr>");
            docx_xml::upsert_ordered_child(block, &style, "w:rPr", &fresh, STYLE_CHILD_ORDER)
        }
    }
}

/// `<w:p>` 直接子元素的相对顺序（CT_P 节选）：pPr 必须排在正文内容（w:r 等）
/// 之前。
const PARAGRAPH_CHILD_ORDER: &[&str] = &["w:pPr", "w:r"];

/// 同 [`upsert_in_style_ppr`]，作用在一份完整的 `<w:p>...</w:p>` 段落上；
/// pPr 不存在时按 [`PARAGRAPH_CHILD_ORDER`] 新建，插在第一个 `w:r` 之前。
fn upsert_in_paragraph_ppr(paragraph: &str, tag: &str, fragment: &str) -> String {
    let Some(p) = docx_xml::find_element(paragraph, "w:p") else {
        return paragraph.to_owned();
    };
    match docx_xml::find_direct_child(paragraph, &p, "w:pPr") {
        Some(ppr) => {
            docx_xml::upsert_ordered_child(paragraph, &ppr, tag, fragment, PPR_CHILD_ORDER)
        }
        None => {
            let fresh = format!("<w:pPr>{fragment}</w:pPr>");
            docx_xml::upsert_ordered_child(paragraph, &p, "w:pPr", &fresh, PARAGRAPH_CHILD_ORDER)
        }
    }
}

/// 给代码块的 SourceCode 段落样式加一圈细边框，对应 layout.code_block_bordered。
fn patch_code_block_border(xml: &str) -> String {
    const BORDER: &str = r#"<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="4" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="4" w:color="000000"/></w:pBdr>"#;
    patch_style_block_by_id(xml, "SourceCode", |block| {
        upsert_in_style_ppr(block, "w:pBdr", BORDER)
    })
}

/// 对指定 styleId 的 XML 块执行一次局部改写；不存在时保持原样。
fn patch_style_block_by_id<F>(xml: &str, style_id: &str, patch: F) -> String
where
    F: FnOnce(&str) -> String,
{
    let Some(style) = docx_xml::find_element_by_attr(xml, "w:style", "w:styleId", style_id) else {
        return xml.to_owned();
    };
    let patched = patch(&xml[style.outer.clone()]);
    format!(
        "{}{}{}",
        &xml[..style.outer.start],
        patched,
        &xml[style.outer.end..]
    )
}

/// 改写段落样式的段落属性和运行属性。
/// 一个段落样式要改写的属性；`None` 表示保持原样。
///
/// 用具名字段而不是一串位置参数：调用处清一色是
/// `None, Some(24), None, None`，读的人根本看不出哪个 None 是对齐、哪个是斜体，
/// 而且加一个属性就要把每个调用点都改一遍。
#[derive(Default)]
struct ParagraphStyle<'a> {
    spacing: Option<&'a str>,
    indent: Option<&'a str>,
    alignment: Option<&'a str>,
    size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
}

fn patch_paragraph_style(block: &str, style: &ParagraphStyle) -> String {
    let mut block = block.to_owned();
    if let Some(spacing) = style.spacing {
        block = upsert_in_style_ppr(&block, "w:spacing", spacing);
    }
    if let Some(indent) = style.indent {
        block = upsert_in_style_ppr(&block, "w:ind", indent);
    }
    if let Some(alignment) = style.alignment {
        block = upsert_in_style_ppr(&block, "w:jc", alignment);
    }
    patch_run_style(&block, style.size, style.bold, style.italic)
}

/// 改写运行属性中的字号、粗体和斜体；未指定的属性保持原样。
fn patch_run_style(
    block: &str,
    size: Option<u32>,
    bold: Option<bool>,
    italic: Option<bool>,
) -> String {
    let mut block = block.to_owned();
    if let Some(size) = size {
        let size_tag = format!(r#"<w:sz w:val="{size}"/>"#);
        let size_cs_tag = format!(r#"<w:szCs w:val="{size}"/>"#);
        block = upsert_in_style_rpr(&block, "w:sz", &size_tag);
        block = upsert_in_style_rpr(&block, "w:szCs", &size_cs_tag);
    }
    if let Some(bold) = bold {
        let tag = if bold {
            r#"<w:b/>"#
        } else {
            r#"<w:b w:val="0"/>"#
        };
        block = upsert_in_style_rpr(&block, "w:b", tag);
    }
    if let Some(italic) = italic {
        let tag = if italic {
            r#"<w:i/>"#
        } else {
            r#"<w:i w:val="0"/>"#
        };
        block = upsert_in_style_rpr(&block, "w:i", tag);
    }
    block
}

/// 查找完整的 w:xxx 标签，避免把 w:sz 当成 w:szCs 的前缀。
///
/// 仍在用：`body_section_start`/`patch_list_paragraphs` 需要在整份文档里逐个
/// 找同名标签的所有出现位置（"下一个 `<w:sectPr`""下一个 `<w:p`"），这是
/// "找同一种标签的所有出现"，不是 [`docx_xml`] 那套"找一个元素、看它的直接
/// 子元素"要解决的问题，两者不能互相替代。
fn find_word_tag_start(xml: &str, needle: &str) -> Option<usize> {
    let mut offset = 0;
    while let Some(relative) = xml[offset..].find(needle) {
        let start = offset + relative;
        let next = xml.as_bytes().get(start + needle.len()).copied();
        if matches!(next, Some(b' ' | b'/' | b'>')) {
            return Some(start);
        }
        offset = start + needle.len();
    }
    None
}

/// 没有 `w:tblPr` 就什么都不做——不像 `patch_code_block_border` 那样连容器
/// 一起新建；Table 样式目前的已知形态里 tblPr 恒存在，保持这个限制而不是无
/// 依据地猜一个插入位置。
fn patch_table_style(xml: &str) -> String {
    const BORDERS: &str = r#"<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>"#;
    patch_style_block_by_id(xml, "Table", |block| {
        let Some(tbl_pr) = docx_xml::find_element(block, "w:tblPr") else {
            return block.to_owned();
        };
        docx_xml::upsert_ordered_child(block, &tbl_pr, "w:tblBorders", BORDERS, &["w:tblBorders"])
    })
}

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
    let Some(defaults) = docx_xml::find_element(xml, "w:docDefaults") else {
        return xml.to_owned();
    };
    let patched_defaults = replace_or_insert_r_fonts_in_rpr(
        &xml[defaults.outer.clone()],
        FONT_BODY_EA,
        FONT_BODY_LATIN,
    );

    format!(
        "{}{}{}",
        &xml[..defaults.outer.start],
        patched_defaults,
        &xml[defaults.outer.end..]
    )
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
    // 已有 rFonts：只是替换属性值，不涉及子元素顺序——不在这次重写的目标范围
    // 内，保留原来"遍历替换每一处"的写法（`w:rPrChange` 这类修订标记理论上会
    // 让同一个片段里出现不止一个 rFonts，原逻辑早就考虑到了这一点）。
    if xml.contains("<w:rFonts") {
        return replace_r_fonts(xml, ea, latin);
    }
    // 没有 rFonts：要么插进已有的 rPr，要么 rPr 整个不存在就不插入——原来的写法
    // 只认得"非自闭合、已有内容"和"非自闭合、完全空标签"两种 rPr 形态，真遇到
    // `<w:rPr/>` 自闭合会被误判成"没有 rPr"，静默漏加字体。
    let fonts_tag = format!(r#"<w:rFonts {}/>"#, make_r_fonts(ea, latin));
    let Some(rpr) = docx_xml::find_element(xml, "w:rPr") else {
        return xml.to_owned();
    };
    docx_xml::upsert_ordered_child(xml, &rpr, "w:rFonts", &fonts_tag, RPR_CHILD_ORDER)
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

    // 已有 color：只是替换属性值，跟 replace_or_insert_r_fonts_in_rpr 里替换
    // 已有 rFonts 是同一类操作，同样不涉及子元素顺序，不在这次重写范围内。
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
        return result;
    }

    // 没有 color：插进 rPr 里，按 RPR_CHILD_ORDER 排在正确位置——这是一次真正
    // 的子元素插入，跟 rFonts 那边是同一类问题。
    let Some(rpr) = docx_xml::find_element(xml, "w:rPr") else {
        return xml.to_owned();
    };
    docx_xml::upsert_ordered_child(xml, &rpr, "w:color", &color_tag, RPR_CHILD_ORDER)
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
///
/// 这一族（连同 `set_theme_font`/`replace_typeface_attr`）没有迁移到
/// `docx_xml`：它们只替换已经存在的标签上的一个属性值，找不到就直接放弃，
/// 从不插入新元素，所以不存在子元素顺序的问题——不是这次重写要解决的那类
/// 场景，迁移不会带来任何实际收益。
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
    use crate::domain::academic_layout::PaperSize;

    #[cfg(unix)]
    #[test]
    fn terminates_a_command_that_exceeds_its_deadline() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 2"]);
        let error = command_output(command, Duration::from_millis(20), "超时测试")
            .expect_err("command must time out");
        assert_eq!(error.code, "pandoc_timeout");
    }

    // ── 纯字符串 fixture 测试（不依赖 pandoc）─────────────────────────────────

    /// 模拟 pandoc 生成的最小 styles.xml
    /// 见 academic_styles_output_is_unchanged_for_default_layout。
    ///
    /// 这个值在 docx_xml 重写时有意更新过一次：旧的手写补丁逻辑只会"在已有内容
    /// 末尾追加"或"原地替换"，从不重新排列已有的兄弟元素，所以 FIXTURE 里 Title
    /// 预先写好的 `<w:jc>`、Heading1 预先写好的 `<w:color>` 会保持在它们原来（不
    /// 符合 CT_PPr/CT_RPr 顺序）的位置上，新插入的 spacing/ind/b 只能追加在它们
    /// 后面。新的 `upsert_ordered_child` 会按声明的 order 表正确地把新插入的元素
    /// 排到已有元素之间，而不是无脑追加到最后——这是一处真实的顺序修正，不是
    /// 误改；具体证据见 patch_paragraph_style/patch_run_style 的重写。
    const GOLDEN_ACADEMIC_STYLES_HASH: u64 = 7600489230930714727;

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

    const FIXTURE_ACADEMIC_STYLES: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:pPr><w:jc w:val="left"/></w:pPr>
    <w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal"><w:pPr /><w:rPr /></w:style>
  <w:style w:type="paragraph" w:styleId="BodyText">
    <w:pPr><w:spacing w:before="180" w:after="180"/></w:pPr>
    <w:rPr />
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:pPr><w:spacing w:before="360" w:after="80"/></w:pPr>
    <w:rPr><w:sz w:val="40"/><w:color w:val="0F4761"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Bibliography"><w:pPr /></w:style>
  <w:style w:type="character" w:styleId="SourceCode">
    <w:rPr><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="table" w:styleId="Table">
    <w:tblPr><w:tblInd w:w="0" w:type="dxa"/></w:tblPr>
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

    /// FIXTURE_STYLES 里每个样式都已经带着 rFonts/color，从没真正跑过"这两个
    /// 标签压根不存在，需要新插入"这条路径——包括曾经会被误判成"没有 rPr"、
    /// 静默漏加字体的 `<w:rPr/>` 自闭合写法。
    #[test]
    fn inserts_r_fonts_and_color_when_the_style_has_neither() {
        const NO_FONTS: &str = r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:rPr/></w:style></w:styles>"#;
        let patched = patch_styles_xml(NO_FONTS);
        assert!(
            patched.contains("黑体"),
            "Heading1 的 rPr 是自闭合的，也应该正确插入黑体：\n{patched}"
        );
        assert!(
            patched.contains(r#"<w:color w:val="000000"/>"#),
            "同一个自闭合 rPr 也应该正确插入显式黑色：\n{patched}"
        );
        // rFonts 必须排在 color 前面（CT_RPr 顺序），不能是插入顺序颠倒的产物。
        assert!(patched.find("rFonts").unwrap() < patched.find("w:color").unwrap());
    }

    /// 排版重构的验收基准：默认参数下产出的 XML 必须与重构前逐字节一致。
    /// 哈希变了就说明改动泄漏到了输出上——这一步只允许换实现，不允许换结果。
    #[test]
    fn academic_styles_output_is_unchanged_for_default_layout() {
        use std::hash::{Hash, Hasher};
        let patched =
            patch_academic_styles_xml(FIXTURE_ACADEMIC_STYLES, &AcademicLayout::default());
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        patched.hash(&mut hasher);
        assert_eq!(
            hasher.finish(),
            GOLDEN_ACADEMIC_STYLES_HASH,
            "默认排版的输出发生了变化"
        );
    }

    /// 与上面的黄金哈希互为补充：那条保证默认值不变，这条保证参数不是摆设。
    /// 少了它，把 layout 接错线（比如漏传、传了但没用）也测不出来。
    #[test]
    fn layout_values_reach_the_generated_xml() {
        let layout = AcademicLayout {
            body_font_pt: 10.5,
            body_line_height: 2.0,
            first_line_indent_chars: 4.0,
            margin_mm: 20.0,
            paper: PaperSize::Letter,
            title_font_pt: 22.0,
            ..AcademicLayout::default()
        };

        let styles = patch_academic_styles_xml(FIXTURE_ACADEMIC_STYLES, &layout);
        // 10.5pt -> 21 半磅；2.0 倍 -> w:line="480"；4 个 10.5pt 字符 -> 840 缇
        assert!(styles.contains(r#"<w:sz w:val="21"/>"#));
        assert!(styles.contains(r#"w:line="480""#));
        assert!(styles.contains(r#"<w:ind w:firstLine="840"/>"#));
        assert!(
            styles.contains(r#"<w:sz w:val="44"/>"#),
            "题名 22pt 应写作 44 半磅"
        );
        assert!(!styles.contains(r#"w:line="360""#), "不应残留默认行距");

        let document =
            r#"<w:document><w:body><w:sectPr><w:footnotePr /></w:sectPr></w:body></w:document>"#;
        let page = patch_document_page_layout(document, Some("rIdFooter1"), &layout);
        // Letter = 12240 x 15840 缇；20mm = 1134 缇
        assert!(page.contains(r#"<w:pgSz w:w="12240" w:h="15840"/>"#));
        assert!(page.contains(r#"w:top="1134""#));
    }

    #[test]
    fn academic_styles_patch_paper_styles_only() {
        let patched =
            patch_academic_styles_xml(FIXTURE_ACADEMIC_STYLES, &AcademicLayout::default());
        assert!(patched.contains(r#"<w:sz w:val="36"/>"#));
        assert!(patched
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>"#));
        assert!(patched.contains(r#"<w:ind w:left="480" w:hanging="480"/>"#));
        assert!(patched.contains(r#"<w:color w:val="000000"/>"#));
        assert!(
            patched.contains(r#"<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>"#)
        );

        // 代码等非论文排版样式不应被这一步改写。
        assert!(patched.contains(r#"w:styleId="SourceCode"#));
        assert!(patched.contains(r#"<w:sz w:val="22"/>"#));
    }

    /// 真实 pandoc 输出里 SourceCode 是段落样式（见 patch_code_block_border 的
    /// 文档注释），FIXTURE_ACADEMIC_STYLES 里那份是字符样式、没有 pPr——只够测
    /// 字体替换，不够测边框插入的位置正确性，所以这里单独构造一份贴近真实
    /// 结构的样式片段。
    const FIXTURE_SOURCE_CODE_STYLE: &str = r#"<w:style w:type="paragraph" w:customStyle="1" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:link w:val="VerbatimChar"/><w:pPr><w:wordWrap w:val="off"/></w:pPr></w:style>"#;

    #[test]
    fn code_block_border_is_off_by_default_and_on_when_enabled() {
        let off = patch_academic_styles_xml(
            FIXTURE_SOURCE_CODE_STYLE,
            &AcademicLayout {
                code_block_bordered: false,
                ..AcademicLayout::default()
            },
        );
        assert!(!off.contains("w:pBdr"), "默认不应该给代码块加框");

        let on = patch_academic_styles_xml(
            FIXTURE_SOURCE_CODE_STYLE,
            &AcademicLayout {
                code_block_bordered: true,
                ..AcademicLayout::default()
            },
        );
        let border_at = on.find("<w:pBdr>").expect("开启后应插入 pBdr");
        let word_wrap_at = on.find("<w:wordWrap").expect("wordWrap 应该还在");
        assert!(
            border_at < word_wrap_at,
            "pBdr 必须排在 wordWrap 之前，顺序错了 Word 可能要求修复文档"
        );
    }

    /// 自定义模板里的 SourceCode 可能压根没有 pPr，只有 rPr——现在允许
    /// "自定义模板 + 标准格式"组合，这份 styles.xml 一样会被打补丁，所以新建的
    /// pPr 必须插在 rPr 之前，否则 w:style 子元素顺序违规，Word 会提示修复文档。
    #[test]
    fn code_block_border_keeps_style_child_order_without_an_existing_ppr() {
        const NO_PPR: &str = r#"<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="BodyText"/><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>"#;
        let patched = patch_academic_styles_xml(
            NO_PPR,
            &AcademicLayout {
                code_block_bordered: true,
                ..AcademicLayout::default()
            },
        );
        let ppr_at = patched.find("<w:pPr>").expect("应当新建 pPr");
        let rpr_at = patched.find("<w:rPr>").expect("原有 rPr 应该还在");
        assert!(ppr_at < rpr_at, "OOXML 要求 w:style 里 pPr 排在 rPr 之前");
        assert!(patched.contains("<w:pBdr>"), "边框应当落在新建的 pPr 里");
    }

    #[test]
    fn three_line_table_can_be_turned_off_independently() {
        // 关掉三线表时，Table 样式应该保持原样——之前这个字段完全没被读取，
        // 不管开关状态都会加边框；这条测试锁死"关了就真的不加"。
        let patched = patch_academic_styles_xml(
            FIXTURE_ACADEMIC_STYLES,
            &AcademicLayout {
                three_line_table: false,
                ..AcademicLayout::default()
            },
        );
        assert!(
            !patched.contains("tblBorders"),
            "关闭三线表后不应该出现三线表边框"
        );
    }

    #[test]
    fn page_number_footer_toggle_only_controls_the_footer_reference() {
        let document = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:sectPr><w:footnotePr /></w:sectPr></w:body></w:document>"#;
        let layout = AcademicLayout::default();

        let without_footer = patch_document_page_layout(document, None, &layout);
        assert!(
            !without_footer.contains("footerReference"),
            "关闭页码后不应该插入 footerReference"
        );
        // 纸张和页边距没有单独开关，页码开关不应该影响它们。
        assert!(without_footer.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));

        let with_footer = patch_document_page_layout(document, Some("rIdFooter1"), &layout);
        assert!(with_footer.contains(r#"<w:footerReference w:type="default" r:id="rIdFooter1"/>"#));
    }

    fn zip_entry(name: &str, body: &str) -> (String, Vec<u8>, zip::CompressionMethod) {
        (
            name.to_owned(),
            body.as_bytes().to_vec(),
            zip::CompressionMethod::Deflated,
        )
    }

    /// 模板自带页脚时，页码要另起一个部件，不能复用模板那一个。
    ///
    /// 复用它的关系 ID 会让「居中页码」勾了却毫无效果（sectPr 指回模板自己的
    /// 页脚），而直接覆盖那个部件又会毁掉模板作者放在页脚里的内容。
    #[test]
    fn page_number_footer_does_not_hijack_a_template_owned_footer() {
        let rels = r#"<Relationships><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>"#;
        let entries = vec![
            zip_entry("word/_rels/document.xml.rels", rels),
            zip_entry("word/footer1.xml", "<w:ftr>模板自己的页脚</w:ftr>"),
        ];

        let plan = plan_footer(&entries);
        assert_eq!(plan.part_name, "word/footer2.xml", "不应写回模板的页脚部件");
        assert_eq!(plan.target(), "footer2.xml");
        assert_ne!(plan.rel_id, "rId7", "不应复用模板页脚的关系 ID");

        // 新关系和模板原有关系共存，content type 也得给新部件补上。
        let patched_rels = patch_document_relationships(rels, &plan.rel_id, plan.target());
        assert!(patched_rels.contains(r#"Id="rId7""#));
        assert!(patched_rels.contains(r#"Target="footer2.xml""#));
        let types = patch_content_types(r#"<Types></Types>"#, &plan.part_name);
        assert!(types.contains(r#"PartName="/word/footer2.xml""#));
    }

    /// 内置模板不带页脚，取值必须还是 footer1/rIdFooter1——默认导出的产物
    /// 不能因为上面那条「避让模板页脚」的逻辑而改变。
    #[test]
    fn footer_plan_keeps_the_builtin_names_when_no_footer_exists() {
        let entries = vec![zip_entry(
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId1" Target="styles.xml"/></Relationships>"#,
        )];
        let plan = plan_footer(&entries);
        assert_eq!(plan.part_name, "word/footer1.xml");
        assert_eq!(plan.rel_id, "rIdFooter1");
    }

    #[test]
    fn default_document_gets_a4_margins_and_page_number_reference() {
        let document = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:sectPr><w:footnotePr /></w:sectPr></w:body></w:document>"#;
        let patched =
            patch_document_page_layout(document, Some("rIdFooter1"), &AcademicLayout::default());
        assert!(patched.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
        assert!(patched.contains(
            r#"<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>"#
        ));
        assert!(patched.contains(r#"<w:footerReference w:type="default" r:id="rIdFooter1"/>"#));
        assert!(patched.find("footerReference").unwrap() < patched.find("pgSz").unwrap());
        assert!(patched.find("pgSz").unwrap() < patched.find("pgMar").unwrap());

        let rels =
            r#"<Relationships><Relationship Id="rId1" Target="styles.xml"/></Relationships>"#;
        let rels = patch_document_relationships(rels, "rIdFooter1", "footer1.xml");
        assert!(rels.contains(
            r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer""#
        ));
        assert!(rels.contains(r#"Target="footer1.xml""#));

        let types = r#"<Types></Types>"#;
        let types = patch_content_types(types, "word/footer1.xml");
        assert!(types.contains(r#"PartName="/word/footer1.xml""#));
        assert!(DEFAULT_FOOTER_XML.contains("PAGE"));
    }

    #[test]
    fn list_paragraphs_get_body_line_spacing_without_changing_table_cells() {
        let document = r#"<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Compact"/><w:numPr><w:numId w:val="1001"/></w:numPr><w:spacing w:line="240"/></w:pPr><w:r><w:t>列表</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:pPr><w:pStyle w:val="Compact"/><w:spacing w:line="240"/></w:pPr><w:r><w:t>表格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let patched = patch_list_paragraphs(document, &AcademicLayout::default());
        let list_start = patched.find("<w:numPr").unwrap();
        let list_end = patched[list_start..].find("</w:p>").unwrap() + list_start;
        let list = &patched[..list_end];
        assert!(list
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>"#));

        let table_start = patched.find("<w:t>表格").unwrap();
        let table_container_start = patched.find("<w:tbl").unwrap();
        let table_cell = &patched[table_container_start..table_start];
        assert!(!table_cell.contains(r#"w:line="360""#));
    }

    #[test]
    fn page_layout_targets_the_document_section_not_a_paragraph_one() {
        // 段落级 sectPr（包在 w:pPr 里）代表分节符，页面设置必须落到 body 末尾那一个。
        let document = concat!(
            r#"<w:document><w:body>"#,
            r#"<w:p><w:pPr><w:sectPr><w:pgSz w:w="1" w:h="2"/></w:sectPr></w:pPr></w:p>"#,
            r#"<w:sectPr><w:pgSz w:w="3" w:h="4"/></w:sectPr>"#,
            r#"</w:body></w:document>"#
        );
        let patched =
            patch_document_page_layout(document, Some("rIdFooter1"), &AcademicLayout::default());

        let paragraph_end = patched.find("</w:pPr>").expect("段落属性应保留");
        assert!(patched[..paragraph_end].contains(r#"<w:pgSz w:w="1" w:h="2"/>"#));
        assert!(!patched[..paragraph_end].contains("footerReference"));
        assert!(patched[paragraph_end..].contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
        assert!(patched[paragraph_end..].contains("footerReference"));
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

    #[test]
    fn failed_word_export_preserves_existing_destination_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let output = dir.path().join("existing.docx");
        std::fs::write(&output, b"existing document").expect("写入已有文件失败");
        let options = PandocExportOptions {
            reference_doc: None,
            extra_args: Vec::new(),
            table_of_contents: false,
            number_sections: false,
        };

        let post = DocxPostProcessing {
            normalize_fonts: false,
            apply_academic_layout: false,
            layout: AcademicLayout::default(),
        };
        let error = run_export_docx_atomic(
            &dir.path().join("missing-pandoc"),
            "# title",
            None,
            &output,
            &options,
            &post,
        )
        .expect_err("不存在的 Pandoc 应导出失败");

        assert_eq!(error.code, "pandoc_spawn_failed");
        assert_eq!(
            std::fs::read(&output).expect("读取已有文件失败"),
            b"existing document"
        );
        let leftovers = std::fs::read_dir(dir.path())
            .expect("读取临时目录失败")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".xmd-word-export-")
            })
            .count();
        assert_eq!(leftovers, 0, "失败后不应残留 Word 导出临时文件");
    }

    #[test]
    fn preview_candidates_are_distinct_and_land_in_the_temp_dir() {
        let candidates = preview_output_candidates();
        let dir = std::env::temp_dir();
        assert_eq!(candidates[0].parent(), Some(dir.as_path()));
        assert_eq!(candidates[1].parent(), Some(dir.as_path()));
        // 固定名必须是可预测的，方便重复预览时覆盖同一个文件；备用名必须
        // 和固定名不同，否则"占用时退回一个新名字"这条逻辑就是摆设。
        assert_ne!(candidates[0], candidates[1]);
        assert_eq!(
            candidates[0].file_name().and_then(|name| name.to_str()),
            Some("Xiangzi MD 论文排版预览.docx")
        );
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

        let md = "# 标题一\n\n正文 **加粗** `code`\n\n- 列表一\n- 列表二\n\n```\ncode block\n```\n";
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let out = dir.path().join("test_out.docx");
        std::fs::write(&out, b"previous export").expect("创建已有目标文件失败");

        // 导出到临时文件、归一化字体并原子替换目标
        let options = PandocExportOptions {
            reference_doc: None,
            extra_args: Vec::new(),
            table_of_contents: false,
            number_sections: false,
        };
        let post = DocxPostProcessing {
            normalize_fonts: true,
            apply_academic_layout: true,
            layout: AcademicLayout::default(),
        };
        run_export_docx_atomic(&pandoc, md, None, &out, &options, &post)
            .expect("export_docx 应成功");
        assert!(out.exists(), "docx 文件应存在");

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
        assert!(styles.contains(
            r#"<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>"#
        ));
        assert!(styles.contains(r#"<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>"#));
        let heading_start = styles.find("w:styleId=\"Heading1\"").unwrap();
        let heading_end = heading_start
            + styles[heading_start..].find("</w:style>").unwrap()
            + "</w:style>".len();
        let heading = &styles[heading_start..heading_end];
        assert!(heading.contains(r#"<w:color w:val="000000"/>"#));
        assert!(heading.contains(r#"<w:sz w:val="32"/>"#));
        assert!(!heading.contains("themeColor"));

        let source_code_start = styles.find("w:styleId=\"VerbatimChar\"").unwrap();
        let source_code_end = source_code_start
            + styles[source_code_start..].find("</w:style>").unwrap()
            + "</w:style>".len();
        let source_code = &styles[source_code_start..source_code_end];
        assert!(
            source_code.contains("Consolas"),
            "代码样式应继续使用 Consolas"
        );

        let mut document_buf = Vec::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_end(&mut document_buf)
            .unwrap();
        let document = String::from_utf8_lossy(&document_buf);
        assert!(document.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
        assert!(document.contains(
            r#"<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>"#
        ));
        assert!(document.contains(r#"<w:footerReference w:type="default" r:id="rIdFooter1"/>"#));
        assert!(document
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>"#));

        let mut rels_buf = Vec::new();
        archive
            .by_name("word/_rels/document.xml.rels")
            .unwrap()
            .read_to_end(&mut rels_buf)
            .unwrap();
        let rels = String::from_utf8_lossy(&rels_buf);
        assert!(rels.contains(r#"Target="footer1.xml""#));

        let mut footer_buf = Vec::new();
        archive
            .by_name("word/footer1.xml")
            .unwrap()
            .read_to_end(&mut footer_buf)
            .unwrap();
        let footer = String::from_utf8_lossy(&footer_buf);
        assert!(footer.contains("PAGE"));

        let mut types_buf = Vec::new();
        archive
            .by_name("[Content_Types].xml")
            .unwrap()
            .read_to_end(&mut types_buf)
            .unwrap();
        let types = String::from_utf8_lossy(&types_buf);
        assert!(types.contains(r#"PartName="/word/footer1.xml""#));
    }

    /// 用户明确要求的组合："自定义模板 + 论文排版参数"必须一起生效，不是
    /// 二选一。之前的实现里 `reference_doc.is_some()` 会整个跳过论文排版补丁，
    /// 只做字体规范化；这条测试锁死新行为：即使走的是自定义模板，补丁也要
    /// 落到输出的 styles.xml/document.xml 上。
    #[test]
    fn academic_layout_applies_on_top_of_a_custom_reference_doc() {
        let pandoc = match find_pandoc_full(None) {
            Some(path) => path,
            None => {
                eprintln!("skip: pandoc not found");
                return;
            }
        };
        let dir = tempfile::tempdir().expect("创建临时目录失败");

        // 拿 pandoc 自己的默认模板充当"自定义模板"——只是为了有一个真实、
        // 结构合法的 reference.docx 可用，不代表它真的是内置模板。
        let custom_template = dir.path().join("custom-reference.docx");
        let mut extract = make_command(&pandoc);
        extract.args(["--print-default-data-file", "reference.docx"]);
        let extracted = command_output(extract, PANDOC_JOB_TIMEOUT, "读取模板失败")
            .expect("提取参考模板应成功");
        std::fs::write(&custom_template, extracted.stdout).expect("写入自定义模板失败");

        let out = dir.path().join("with-custom-template.docx");
        let options = PandocExportOptions {
            reference_doc: Some(custom_template),
            extra_args: Vec::new(),
            table_of_contents: false,
            number_sections: false,
        };
        let post = DocxPostProcessing {
            normalize_fonts: false,
            apply_academic_layout: true,
            layout: AcademicLayout::default(),
        };
        run_export_docx_atomic(
            &pandoc,
            "# 标题\n\n正文段落。\n",
            None,
            &out,
            &options,
            &post,
        )
        .expect("带自定义模板的导出应成功");

        let bytes = std::fs::read(&out).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut styles_buf = Vec::new();
        archive
            .by_name("word/styles.xml")
            .unwrap()
            .read_to_end(&mut styles_buf)
            .unwrap();
        let styles = String::from_utf8_lossy(&styles_buf);
        // 论文排版的行距补丁应该出现——证明没有因为设了 reference_doc 就被跳过。
        assert!(styles
            .contains(r#"<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>"#));

        let mut document_buf = Vec::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_end(&mut document_buf)
            .unwrap();
        let document = String::from_utf8_lossy(&document_buf);
        // 页面设置（A4 + 页边距）同样应该应用到自定义模板生成的输出上。
        assert!(document.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
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
        run_export_default_template(&pandoc, &output, true, true, &AcademicLayout::default())
            .expect("默认模板应能导出");

        let bytes = std::fs::read(output).expect("默认模板应可读");
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("模板应为有效 docx");
        let mut styles_buf = Vec::new();
        archive
            .by_name("word/styles.xml")
            .expect("模板应包含 styles.xml")
            .read_to_end(&mut styles_buf)
            .expect("读取 styles.xml 失败");
        let styles = String::from_utf8_lossy(&styles_buf);
        assert!(styles.contains(r#"<w:sz w:val="36"/>"#));
        assert!(styles.contains(r#"<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>"#));

        let mut document_buf = Vec::new();
        archive
            .by_name("word/document.xml")
            .expect("模板应包含 document.xml")
            .read_to_end(&mut document_buf)
            .expect("读取 document.xml 失败");
        let document = String::from_utf8_lossy(&document_buf);
        assert!(document.contains(r#"<w:pgSz w:w="11906" w:h="16838"/>"#));
        assert!(document.contains(r#"<w:footerReference w:type="default" r:id="rIdFooter1"/>"#));
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
