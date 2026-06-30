use percent_encoding::percent_decode_str;
use std::{fs, path::PathBuf};
use tauri::{http, Manager, Runtime};

const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ASSET_CANDIDATES: usize = 33;

fn asset_size_allowed(size: u64) -> bool {
    size <= MAX_ASSET_BYTES
}

pub fn handle_xmd<R: Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let cors_origin = request
        .headers()
        .get(http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .filter(|origin| {
            matches!(
                *origin,
                "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost" | "null"
            )
        })
        .map(str::to_owned);
    let primary = percent_decode_str(request.uri().path().trim_start_matches('/'))
        .decode_utf8_lossy()
        .into_owned();
    let mut candidates = vec![PathBuf::from(primary)];

    if let Some(query) = request.uri().query() {
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if key == "alts" {
                candidates.extend(
                    value
                        .lines()
                        .filter(|line| !line.is_empty())
                        .take(MAX_ASSET_CANDIDATES.saturating_sub(1))
                        .map(PathBuf::from),
                );
            }
        }
    }

    let mut oversized = false;
    for path in candidates.into_iter().take(MAX_ASSET_CANDIDATES) {
        if !context
            .app_handle()
            .asset_protocol_scope()
            .is_allowed(&path)
        {
            continue;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        if !asset_size_allowed(metadata.len()) {
            oversized = true;
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            if !asset_size_allowed(bytes.len() as u64) {
                oversized = true;
                continue;
            }
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let mut builder = http::Response::builder()
                .status(http::StatusCode::OK)
                .header(http::header::CONTENT_TYPE, mime.essence_str())
                .header("X-Content-Type-Options", "nosniff");
            if let Some(origin) = cors_origin.as_deref() {
                builder = builder.header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            }
            let response = builder.body(bytes);
            if let Ok(response) = response {
                return response;
            }
        }
    }

    http::Response::builder()
        .status(if oversized {
            http::StatusCode::PAYLOAD_TOO_LARGE
        } else {
            http::StatusCode::NOT_FOUND
        })
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(if oversized {
            b"Asset Too Large".to_vec()
        } else {
            b"Not Found".to_vec()
        })
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::{asset_size_allowed, MAX_ASSET_BYTES};

    #[test]
    fn rejects_assets_larger_than_the_protocol_budget() {
        assert!(asset_size_allowed(MAX_ASSET_BYTES));
        assert!(!asset_size_allowed(MAX_ASSET_BYTES + 1));
    }
}
