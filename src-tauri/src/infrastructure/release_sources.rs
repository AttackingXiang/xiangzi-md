use crate::domain::error::{AppError, AppResult};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Duration;

/// Owner/repo pair the updater endpoints in `tauri.conf.json` already point
/// at for the "latest" check; version rollback reuses the same repositories.
pub const GITHUB_REPO: &str = "AttackingXiang/xiangzi-md";
pub const GITEE_REPO: &str = "tlqgyx/xiangzi-md";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseSource {
    GitHub,
    Gitee,
}

/// One published release, normalized from either host's API shape.
pub struct ReleaseInfo {
    pub tag_name: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
    pub prerelease: bool,
    pub draft: bool,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

#[derive(Debug, Deserialize)]
struct GiteeRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    created_at: Option<String>,
    prerelease: bool,
}

fn http_client() -> AppResult<Client> {
    Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("xiangzi-md/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| AppError::new("release_list_client_failed", error.to_string()))
}

fn fetch_github_releases() -> AppResult<Vec<ReleaseInfo>> {
    let response = http_client()?
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=30"
        ))
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .map_err(|error| AppError::new("release_list_fetch_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "release_list_http_error",
            format!("HTTP {}", response.status().as_u16()),
        ));
    }
    let releases = response
        .json::<Vec<GithubRelease>>()
        .map_err(|error| AppError::new("release_list_parse_failed", error.to_string()))?;
    Ok(releases
        .into_iter()
        .map(|release| ReleaseInfo {
            tag_name: release.tag_name,
            name: release.name,
            body: release.body,
            published_at: release.published_at,
            prerelease: release.prerelease,
            draft: release.draft,
        })
        .collect())
}

fn fetch_gitee_releases() -> AppResult<Vec<ReleaseInfo>> {
    let response = http_client()?
        .get(format!(
            "https://gitee.com/api/v5/repos/{GITEE_REPO}/releases?per_page=30"
        ))
        .send()
        .map_err(|error| AppError::new("release_list_fetch_failed", error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "release_list_http_error",
            format!("HTTP {}", response.status().as_u16()),
        ));
    }
    let releases = response
        .json::<Vec<GiteeRelease>>()
        .map_err(|error| AppError::new("release_list_parse_failed", error.to_string()))?;
    Ok(releases
        .into_iter()
        .map(|release| ReleaseInfo {
            tag_name: release.tag_name,
            name: release.name,
            body: release.body,
            published_at: release.created_at,
            prerelease: release.prerelease,
            draft: false,
        })
        .collect())
}

/// Live lookup, deliberately never cached: the operator can remove a release
/// from either host at any time, and a stale local list would offer a
/// version that no longer downloads. Tries GitHub first (the primary host)
/// and falls back to the Gitee mirror when GitHub cannot be reached — the
/// same order the configured updater endpoints already use for "latest".
pub fn fetch_releases() -> AppResult<(ReleaseSource, Vec<ReleaseInfo>)> {
    match fetch_github_releases() {
        Ok(releases) => Ok((ReleaseSource::GitHub, releases)),
        Err(_) => fetch_gitee_releases().map(|releases| (ReleaseSource::Gitee, releases)),
    }
}
