use percent_encoding::percent_decode_str;
use std::{fs, path::PathBuf};
use tauri::{http, Manager, Runtime};

pub fn handle_xmd<R: Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
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
            let response = http::Response::builder()
                .status(http::StatusCode::OK)
                .header(http::header::CONTENT_TYPE, mime.essence_str())
                .header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(bytes);
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
