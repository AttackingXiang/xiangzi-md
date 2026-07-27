use super::blocking;
use crate::domain::error::{AppError, AppResult};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, time::Duration};
use tauri::{AppHandle, Manager};

const THEME_HOST: &str = "xz.xzfast.top";
const THEME_PATH_PREFIX: &str = "/themes/";
const MAX_THEME_BYTES: u64 = 512 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInstallRequest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub color_scheme: String,
    pub source_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemeManifest {
    id: String,
    name: String,
    version: String,
    author: String,
    color_scheme: String,
    source_url: String,
    installed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTheme {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub color_scheme: String,
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
        Err(AppError::new("theme_id_invalid", "主题 ID 无效"))
    }
}

fn validate_metadata(request: &ThemeInstallRequest) -> AppResult<()> {
    validate_id(&request.id)?;
    if request.name.trim().is_empty() || request.name.chars().count() > 80 {
        return Err(AppError::new("theme_name_invalid", "主题名称无效"));
    }
    if request.version.trim().is_empty() || request.version.len() > 32 {
        return Err(AppError::new("theme_version_invalid", "主题版本无效"));
    }
    if request.author.trim().is_empty() || request.author.chars().count() > 80 {
        return Err(AppError::new("theme_author_invalid", "主题作者无效"));
    }
    if !matches!(request.color_scheme.as_str(), "light" | "dark") {
        return Err(AppError::new(
            "theme_color_scheme_invalid",
            "主题明暗模式无效",
        ));
    }
    Ok(())
}

fn validate_source_url(raw: &str) -> AppResult<Url> {
    let url =
        Url::parse(raw).map_err(|error| AppError::new("theme_url_invalid", error.to_string()))?;
    let valid = url.scheme() == "https"
        && url.host_str() == Some(THEME_HOST)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().starts_with(THEME_PATH_PREFIX)
        && url.path().ends_with(".css");
    if valid {
        Ok(url)
    } else {
        Err(AppError::new(
            "theme_source_not_allowed",
            "只允许从 Xiangzi MD 官方主题站安装 CSS",
        ))
    }
}

fn validate_css(css: &str) -> AppResult<()> {
    if css.trim().is_empty() || css.len() as u64 > MAX_THEME_BYTES {
        return Err(AppError::new(
            "theme_css_invalid",
            "主题 CSS 为空或超过 512 KiB",
        ));
    }
    let compact = css
        .chars()
        .filter(|character| {
            !character.is_ascii_whitespace() && *character != '\'' && *character != '"'
        })
        .collect::<String>()
        .to_ascii_lowercase();
    let forbidden = [
        "@import",
        "url(http:",
        "url(https:",
        "url(//",
        "javascript:",
        "expression(",
        "-moz-binding",
    ];
    if forbidden.iter().any(|needle| compact.contains(needle)) {
        return Err(AppError::new(
            "theme_css_unsafe",
            "主题 CSS 包含远程资源或不安全表达式",
        ));
    }
    if !css.contains("--xmd-") && !css.contains(".xmd-") {
        return Err(AppError::new(
            "theme_contract_missing",
            "主题没有使用 Xiangzi MD 主题契约",
        ));
    }
    Ok(())
}

fn themes_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("themes"))
        .map_err(|error| AppError::new("theme_path_failed", error.to_string()))
}

fn install_theme(app: AppHandle, request: ThemeInstallRequest) -> AppResult<InstalledTheme> {
    validate_metadata(&request)?;
    let source_url = validate_source_url(&request.source_url)?;
    let client = Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("xiangzi-md/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::new("theme_client_failed", error.to_string()))?;
    let response = client
        .get(source_url)
        .send()
        .map_err(|error| AppError::new("theme_download_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "theme_download_http_error",
            format!("主题下载失败：HTTP {}", response.status().as_u16()),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_THEME_BYTES)
    {
        return Err(AppError::new("theme_too_large", "主题超过 512 KiB"));
    }
    let bytes = response
        .bytes()
        .map_err(|error| AppError::new("theme_download_failed", error.to_string()))?;
    if bytes.len() as u64 > MAX_THEME_BYTES {
        return Err(AppError::new("theme_too_large", "主题超过 512 KiB"));
    }
    let css = std::str::from_utf8(&bytes)
        .map_err(|error| AppError::new("theme_encoding_invalid", error.to_string()))?;
    validate_css(css)?;

    let directory = themes_dir(&app)?;
    fs::create_dir_all(&directory).map_err(|error| AppError::io("创建主题目录失败", error))?;
    let css_path = directory.join(format!("{}.css", request.id));
    let manifest_path = directory.join(format!("{}.json", request.id));
    fs::write(&css_path, css).map_err(|error| AppError::io("保存主题 CSS 失败", error))?;
    let installed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let manifest = ThemeManifest {
        id: request.id,
        name: request.name.trim().to_string(),
        version: request.version.trim().to_string(),
        author: request.author.trim().to_string(),
        color_scheme: request.color_scheme,
        source_url: request.source_url,
        installed_at,
    };
    let json = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| AppError::new("theme_manifest_failed", error.to_string()))?;
    fs::write(manifest_path, json).map_err(|error| AppError::io("保存主题信息失败", error))?;

    Ok(InstalledTheme {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        author: manifest.author,
        color_scheme: manifest.color_scheme,
        css_path: css_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn install_theme_from_url(
    app: AppHandle,
    request: ThemeInstallRequest,
) -> AppResult<InstalledTheme> {
    blocking(move || install_theme(app, request)).await
}

#[tauri::command]
pub async fn list_installed_themes(app: AppHandle) -> AppResult<Vec<InstalledTheme>> {
    blocking(move || {
        let directory = themes_dir(&app)?;
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(AppError::io("读取主题目录失败", error)),
        };
        let mut themes = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let Ok(raw) = fs::read(&path) else { continue };
            let Ok(manifest) = serde_json::from_slice::<ThemeManifest>(&raw) else {
                continue;
            };
            if validate_id(&manifest.id).is_err() {
                continue;
            }
            let css_path = directory.join(format!("{}.css", manifest.id));
            if !css_path.is_file() {
                continue;
            }
            themes.push(InstalledTheme {
                id: manifest.id,
                name: manifest.name,
                version: manifest.version,
                author: manifest.author,
                color_scheme: manifest.color_scheme,
                css_path: css_path.to_string_lossy().into_owned(),
            });
        }
        themes.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(themes)
    })
    .await
}

#[tauri::command]
pub async fn remove_installed_theme(app: AppHandle, id: String) -> AppResult<()> {
    blocking(move || {
        validate_id(&id)?;
        let directory = themes_dir(&app)?;
        for extension in ["css", "json"] {
            let path = directory.join(format!("{id}.{extension}"));
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(AppError::io("删除主题失败", error)),
            }
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::{validate_css, validate_id, validate_source_url};

    #[test]
    fn accepts_official_theme_urls_only() {
        assert!(validate_source_url("https://xz.xzfast.top/themes/morandi.css").is_ok());
        assert!(validate_source_url("http://xz.xzfast.top/themes/morandi.css").is_err());
        assert!(validate_source_url("https://example.com/themes/morandi.css").is_err());
        assert!(validate_source_url("https://xz.xzfast.top/download/morandi.css").is_err());
    }

    #[test]
    fn validates_theme_ids_and_css_contract() {
        assert!(validate_id("morandi-light").is_ok());
        assert!(validate_id("../theme").is_err());
        assert!(validate_css(":root { --xmd-document-text: #333; }").is_ok());
        assert!(validate_css("@import url(https://example.com/theme.css);").is_err());
        assert!(
            validate_css(":root { --xmd-image: url(\"https://example.com/a.png\"); }").is_err()
        );
        assert!(validate_css("body { color: red; }").is_err());
    }
}
