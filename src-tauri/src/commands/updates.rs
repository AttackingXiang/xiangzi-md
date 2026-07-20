use super::blocking;
use crate::domain::error::{AppError, AppResult};
use crate::infrastructure::release_sources::{self, ReleaseSource, GITEE_REPO, GITHUB_REPO};
use serde::Serialize;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseSummary {
    pub tag: String,
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub is_current: bool,
    /// Which host this list actually came from — the primary host may be
    /// unreachable for some users, in which case this reports the mirror.
    pub source: &'static str,
}

/// Lists published releases so Settings can offer installing (rolling back
/// to, or repairing onto) any version still hosted there. Never cached: the
/// operator can remove a release at any time (see project notes), so a stale
/// local list could offer a version that no longer downloads. Falls back
/// from GitHub to the Gitee mirror when GitHub cannot be reached, same as
/// the configured "latest" updater endpoints already do.
#[tauri::command]
pub async fn list_release_versions() -> AppResult<Vec<ReleaseSummary>> {
    let current_version = env!("CARGO_PKG_VERSION");
    let (source, releases) = blocking(release_sources::fetch_releases).await?;
    let source = match source {
        ReleaseSource::GitHub => "github",
        ReleaseSource::Gitee => "gitee",
    };
    Ok(releases
        .into_iter()
        .filter(|release| !release.draft)
        .filter_map(|release| {
            let version = release.tag_name.strip_prefix('v')?.to_string();
            let is_current = version == current_version;
            let name = release
                .name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| release.tag_name.clone());
            Some(ReleaseSummary {
                tag: release.tag_name,
                version,
                name,
                notes: release.body.unwrap_or_default(),
                published_at: release.published_at,
                prerelease: release.prerelease,
                is_current,
                source,
            })
        })
        .collect())
}

/// Same shape as the updater plugin's own (private) `Metadata` response, so
/// the frontend can hand it straight to `@tauri-apps/plugin-updater`'s
/// `Update` class and reuse its `download`/`install` calls unchanged.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

fn validate_tag(tag: &str) -> AppResult<()> {
    let valid = tag.len() <= 64
        && tag.strip_prefix('v').is_some_and(|rest| {
            !rest.is_empty()
                && rest
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::new("invalid_release_tag", "版本标签无效"))
    }
}

fn release_tag_url(repo: &str, tag: &str) -> AppResult<url::Url> {
    url::Url::parse(&format!(
        "https://{host}/{repo}/releases/download/{tag}/latest.json",
        host = if repo == GITEE_REPO {
            "gitee.com"
        } else {
            "github.com"
        },
    ))
    .map_err(|error| AppError::new("invalid_release_tag", error.to_string()))
}

/// Points the updater at one specific release tag instead of the configured
/// "latest" endpoints, so Settings can install any version — older or newer
/// — that is still published. Every release already carries its own signed
/// `latest.json` on both hosts (`.github/workflows/release.yml` and
/// `publish-gitee-release.yml`), so this reuses the exact same
/// signature-verified download/install path as a normal update, trying
/// GitHub first and falling back to the Gitee mirror on failure — the
/// updater plugin already walks a multi-endpoint list this way.
#[tauri::command]
pub async fn check_release_version(
    webview: Webview,
    tag: String,
) -> AppResult<Option<ReleaseUpdateMetadata>> {
    validate_tag(&tag)?;
    let endpoints = vec![
        release_tag_url(GITHUB_REPO, &tag)?,
        release_tag_url(GITEE_REPO, &tag)?,
    ];

    let updater = webview
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|error| AppError::new("updater_build_failed", error.to_string()))?
        .version_comparator(|current, release| release.version != current)
        .build()
        .map_err(|error| AppError::new("updater_build_failed", error.to_string()))?;

    let update = updater
        .check()
        .await
        .map_err(|error| AppError::new("release_check_failed", error.to_string()))?;

    Ok(update.map(|update| ReleaseUpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: None,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}
