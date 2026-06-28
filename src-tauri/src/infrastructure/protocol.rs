use percent_encoding::percent_decode_str;
use std::{fs, path::PathBuf};
use tauri::{http, Manager, Runtime};

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
                        .map(PathBuf::from),
                );
            }
        }
    }

    for path in candidates {
        if !context
            .app_handle()
            .asset_protocol_scope()
            .is_allowed(&path)
        {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
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
        .status(http::StatusCode::NOT_FOUND)
        .header(http::header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(b"Not Found".to_vec())
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}
