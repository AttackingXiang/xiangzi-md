use super::blocking;
use crate::domain::error::{AppError, AppResult};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

const EFFECT_HOST: &str = "xz.xzfast.top";
const EFFECT_PATH_PREFIX: &str = "/focus-effects/";
const MAX_EFFECT_BYTES: u64 = 128 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFocusEffectInstallRequest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub effect: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchFocusEffectManifest {
    id: String,
    name: String,
    version: String,
    author: String,
    effect: String,
    source_url: String,
    installed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSearchFocusEffect {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub effect: String,
    pub css_path: String,
}

fn validate_id(id: &str) -> AppResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !id.starts_with('-')
        && !id.ends_with('-');
    if valid {
        Ok(())
    } else {
        Err(AppError::new("focus_effect_id_invalid", "焦点动画 ID 无效"))
    }
}

fn validate_effect(effect: &str) -> AppResult<()> {
    if matches!(effect, "sparkle" | "ring" | "confetti" | "shatter") {
        Ok(())
    } else {
        Err(AppError::new(
            "focus_effect_type_invalid",
            "焦点动画类型无效",
        ))
    }
}

fn validate_metadata(request: &SearchFocusEffectInstallRequest) -> AppResult<()> {
    validate_id(&request.id)?;
    validate_effect(&request.effect)?;
    if request.name.trim().is_empty() || request.name.chars().count() > 80 {
        return Err(AppError::new(
            "focus_effect_name_invalid",
            "焦点动画名称无效",
        ));
    }
    if request.version.trim().is_empty() || request.version.len() > 32 {
        return Err(AppError::new(
            "focus_effect_version_invalid",
            "焦点动画版本无效",
        ));
    }
    if request.author.trim().is_empty() || request.author.chars().count() > 80 {
        return Err(AppError::new(
            "focus_effect_author_invalid",
            "焦点动画作者无效",
        ));
    }
    Ok(())
}

fn validate_source_url(raw: &str) -> AppResult<Url> {
    let url = Url::parse(raw)
        .map_err(|error| AppError::new("focus_effect_url_invalid", error.to_string()))?;
    let valid = url.scheme() == "https"
        && url.host_str() == Some(EFFECT_HOST)
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with(EFFECT_PATH_PREFIX)
        && url.path().ends_with(".css");
    if valid {
        Ok(url)
    } else {
        Err(AppError::new(
            "focus_effect_source_not_allowed",
            "只允许从 Xiangzi MD 官方站安装搜索焦点动画",
        ))
    }
}

fn compact_css(css: &str) -> String {
    css.chars()
        .filter(|character| {
            !character.is_ascii_whitespace() && *character != '\'' && *character != '"'
        })
        .collect::<String>()
        .to_ascii_lowercase()
}

fn strip_css_comments(css: &str) -> AppResult<String> {
    let mut output = Vec::with_capacity(css.len());
    let bytes = css.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"/*") {
            let Some(end) = bytes[index + 2..]
                .windows(2)
                .position(|window| window == b"*/")
            else {
                return Err(AppError::new(
                    "focus_effect_css_invalid",
                    "焦点动画 CSS 注释未闭合",
                ));
            };
            index += end + 4;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output)
        .map_err(|error| AppError::new("focus_effect_css_invalid", error.to_string()))
}

fn validate_top_level_rules(css: &str, effect: &str) -> AppResult<()> {
    let css = strip_css_comments(css)?;
    let mut depth = 0_u32;
    let mut prelude = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let expected_keyframes = format!("@keyframesxmd-focus-{effect}");
    for character in css.chars() {
        if let Some(active_quote) = quote {
            if depth == 0 {
                prelude.push(character);
            }
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }
        if character == '\'' || character == '"' {
            quote = Some(character);
            if depth == 0 {
                prelude.push(character);
            }
            continue;
        }
        match character {
            '{' => {
                if depth == 0 {
                    let compact = compact_css(prelude.trim());
                    let valid_keyframes = compact == expected_keyframes;
                    let valid_selectors = !compact.starts_with('@')
                        && compact.split(',').all(|selector| {
                            let base = ".xmd-focus-effect";
                            let effect_selector = format!("{base}[data-effect={effect}]");
                            matches!(
                                selector,
                                ".xmd-focus-effect"
                                    | ".xmd-focus-effect::before"
                                    | ".xmd-focus-effect::after"
                            ) || selector == effect_selector
                                || selector == format!("{effect_selector}::before")
                                || selector == format!("{effect_selector}::after")
                        });
                    if !valid_keyframes && !valid_selectors {
                        return Err(AppError::new(
                            "focus_effect_css_scope_invalid",
                            "焦点动画 CSS 只能修改焦点动画图层",
                        ));
                    }
                    prelude.clear();
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    return Err(AppError::new(
                        "focus_effect_css_invalid",
                        "焦点动画 CSS 大括号不匹配",
                    ));
                }
                depth -= 1;
                if depth == 0 {
                    prelude.clear();
                }
            }
            ';' if depth == 0 => {
                if !prelude.trim().is_empty() {
                    return Err(AppError::new(
                        "focus_effect_css_scope_invalid",
                        "焦点动画 CSS 包含不允许的顶层规则",
                    ));
                }
            }
            _ if depth == 0 => prelude.push(character),
            _ => {}
        }
    }
    if depth != 0 || quote.is_some() || !prelude.trim().is_empty() {
        return Err(AppError::new(
            "focus_effect_css_invalid",
            "焦点动画 CSS 结构不完整",
        ));
    }
    Ok(())
}

fn validate_css(css: &str, effect: &str) -> AppResult<()> {
    if css.trim().is_empty() || css.len() as u64 > MAX_EFFECT_BYTES {
        return Err(AppError::new(
            "focus_effect_css_invalid",
            "焦点动画 CSS 为空或超过 128 KiB",
        ));
    }
    // CSS comments are removed before tokenization. Check the same normalized
    // source the browser will interpret so `u/**/rl(...)` cannot bypass the
    // external-resource denylist.
    let uncommented = strip_css_comments(css)?;
    let compact = compact_css(&uncommented);
    let forbidden = [
        "@import",
        "url(",
        "image-set(",
        "src(",
        "http:",
        "https:",
        "data:",
        "file:",
        "javascript:",
        "expression(",
        "-moz-binding",
        "@font-face",
        "behavior:",
        "\\",
        "position:",
        "inset:",
        "top:",
        "right:",
        "bottom:",
        "left:",
        "width:",
        "height:",
        "z-index:",
        "pointer-events:",
        "display:",
        "visibility:",
    ];
    if forbidden.iter().any(|needle| compact.contains(needle)) {
        return Err(AppError::new(
            "focus_effect_css_unsafe",
            "焦点动画 CSS 包含外部资源或不安全表达式",
        ));
    }
    validate_top_level_rules(css, effect)?;
    let required_keyframe = format!("@keyframesxmd-focus-{effect}");
    if !compact.contains(&required_keyframe) || !compact.contains(".xmd-focus-effect") {
        return Err(AppError::new(
            "focus_effect_contract_missing",
            "焦点动画没有实现 Xiangzi MD 动画契约",
        ));
    }
    Ok(())
}

fn effects_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("search-focus-effects"))
        .map_err(|error| AppError::new("focus_effect_path_failed", error.to_string()))
}

fn install_effect(
    app: AppHandle,
    request: SearchFocusEffectInstallRequest,
) -> AppResult<InstalledSearchFocusEffect> {
    validate_metadata(&request)?;
    let source_url = validate_source_url(&request.source_url)?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("xiangzi-md/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::new("focus_effect_client_failed", error.to_string()))?;
    let response = client
        .get(source_url)
        .send()
        .map_err(|error| AppError::new("focus_effect_download_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "focus_effect_download_http_error",
            format!("焦点动画下载失败：HTTP {}", response.status().as_u16()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_EFFECT_BYTES)
    {
        return Err(AppError::new(
            "focus_effect_too_large",
            "焦点动画超过 128 KiB",
        ));
    }
    // Content-Length is optional and cannot be trusted as the only size gate.
    // Read at most one byte beyond the limit so a streaming response can never
    // make this small marketplace asset grow memory without bound.
    let mut bytes = Vec::with_capacity(MAX_EFFECT_BYTES as usize + 1);
    response
        .take(MAX_EFFECT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| AppError::new("focus_effect_download_failed", error.to_string()))?;
    if bytes.len() as u64 > MAX_EFFECT_BYTES {
        return Err(AppError::new(
            "focus_effect_too_large",
            "焦点动画超过 128 KiB",
        ));
    }
    let css = std::str::from_utf8(&bytes)
        .map_err(|error| AppError::new("focus_effect_encoding_invalid", error.to_string()))?;
    validate_css(css, &request.effect)?;

    let directory = effects_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| AppError::io("创建焦点动画目录失败", error))?;
    let css_path = directory.join(format!("{}.css", request.id));
    let manifest_path = directory.join(format!("{}.json", request.id));
    fs::write(&css_path, css).map_err(|error| AppError::io("保存焦点动画 CSS 失败", error))?;
    let installed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let manifest = SearchFocusEffectManifest {
        id: request.id,
        name: request.name.trim().to_string(),
        version: request.version.trim().to_string(),
        author: request.author.trim().to_string(),
        effect: request.effect,
        source_url: request.source_url,
        installed_at,
    };
    let json = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| AppError::new("focus_effect_manifest_failed", error.to_string()))?;
    fs::write(manifest_path, json).map_err(|error| AppError::io("保存焦点动画信息失败", error))?;

    Ok(InstalledSearchFocusEffect {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        effect: manifest.effect,
        css_path: css_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn install_search_focus_effect_from_url(
    app: AppHandle,
    request: SearchFocusEffectInstallRequest,
) -> AppResult<InstalledSearchFocusEffect> {
    blocking(move || install_effect(app, request)).await
}

#[tauri::command]
pub async fn list_installed_search_focus_effects(
    app: AppHandle,
) -> AppResult<Vec<InstalledSearchFocusEffect>> {
    blocking(move || {
        let directory = effects_dir(&app)?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(AppError::io("读取焦点动画目录失败", error)),
        };
        let mut effects = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read(&path) else { continue };
            let Ok(manifest) = serde_json::from_slice::<SearchFocusEffectManifest>(&raw) else {
                continue;
            };
            if validate_id(&manifest.id).is_err() || validate_effect(&manifest.effect).is_err() {
                continue;
            }
            let css_path = directory.join(format!("{}.css", manifest.id));
            if !css_path.is_file() {
                continue;
            }
            effects.push(InstalledSearchFocusEffect {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                author: manifest.author,
                effect: manifest.effect,
                css_path: css_path.to_string_lossy().into_owned(),
            });
        }
        effects.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(effects)
    })
    .await
}

#[tauri::command]
pub async fn remove_installed_search_focus_effect(app: AppHandle, id: String) -> AppResult<()> {
    blocking(move || {
        validate_id(&id)?;
        let directory = effects_dir(&app)?;
        for extension in ["css", "json"] {
            let path = directory.join(format!("{id}.{extension}"));
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(AppError::io("删除焦点动画失败", error)),
            }
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{validate_css, validate_effect, validate_id, validate_source_url};

    #[test]
    fn accepts_official_effect_urls_only() {
        assert!(
            validate_source_url("https://xz.xzfast.top/focus-effects/aurora-pulse.css").is_ok()
        );
        assert!(
            validate_source_url("http://xz.xzfast.top/focus-effects/aurora-pulse.css").is_err()
        );
        assert!(validate_source_url("https://example.com/focus-effects/a.css").is_err());
        assert!(validate_source_url("https://xz.xzfast.top/themes/a.css").is_err());
    }

    #[test]
    fn validates_ids_effect_types_and_css_contract() {
        assert!(validate_id("aurora-pulse").is_ok());
        assert!(validate_id("../effect").is_err());
        assert!(validate_effect("ring").is_ok());
        assert!(validate_effect("off").is_err());
        assert!(validate_css(
            ".xmd-focus-effect { border-color: cyan; } @keyframes xmd-focus-ring { to { opacity: 0; } }",
            "ring"
        )
        .is_ok());
        assert!(validate_css(
            ".xmd-focus-effect { background: url(https://example.com/a.png); } @keyframes xmd-focus-ring { to { opacity: 0; } }",
            "ring"
        )
        .is_err());
        assert!(validate_css(
            ".xmd-focus-effect { background: u/**/rl(https://example.com/a.png); } @keyframes xmd-focus-ring { to { opacity: 0; } }",
            "ring"
        )
        .is_err());
        assert!(validate_css("body { color: red; }", "ring").is_err());
        assert!(validate_css(
            "body { color: red; } .xmd-focus-effect { color: red; } @keyframes xmd-focus-ring { to { opacity: 0; } }",
            "ring"
        )
        .is_err());
        assert!(validate_css(
            ".xmd-focus-effect { position: fixed; inset: 0; pointer-events: auto; } @keyframes xmd-focus-ring { to { opacity: 0; } }",
            "ring"
        )
        .is_err());
        assert!(validate_css(
            ".xmd-focus-effect { color: red; } @keyframes xmd-focus-sparkle { to { opacity: 0; } }",
            "ring"
        )
        .is_err());
    }
}
