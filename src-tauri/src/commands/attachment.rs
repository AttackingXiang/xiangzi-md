use super::blocking;
use crate::{
    domain::error::{AppError, AppResult},
    infrastructure::{attachment, settings::SettingsStore},
};
use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResult {
    rel_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentMetadata {
    doc_dir: String,
    doc_name: String,
    vault_root: Option<String>,
    file_name: String,
}

fn decode_attachment_metadata(encoded: &str) -> AppResult<AttachmentMetadata> {
    let decoded = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|_| AppError::new("attachment_metadata_invalid", "附件元数据编码无效"))?;
    serde_json::from_str(&decoded)
        .map_err(|error| AppError::new("attachment_metadata_invalid", error.to_string()))
}

#[tauri::command]
pub async fn save_attachment(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<AttachmentResult> {
    let encoded = request
        .headers()
        .get("x-xmd-attachment")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::new("attachment_metadata_missing", "缺少附件元数据"))?;
    let metadata = decode_attachment_metadata(encoded)?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => {
            attachment::validate_attachment_size(data.len())?;
            data.clone()
        }
        _ => {
            return Err(AppError::new(
                "attachment_body_invalid",
                "附件必须使用二进制传输",
            ));
        }
    };
    let settings = store.get(&app)?;
    blocking(move || {
        let vault = metadata.vault_root.as_ref().map(PathBuf::from);
        attachment::save_attachment(
            &app,
            &settings,
            &PathBuf::from(metadata.doc_dir),
            &metadata.doc_name,
            vault.as_deref(),
            &metadata.file_name,
            &data,
        )
        .map(|rel_path| AttachmentResult { rel_path })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::decode_attachment_metadata;

    #[test]
    fn decodes_unicode_attachment_metadata_from_the_raw_ipc_header() {
        let encoded = "%7B%22docDir%22%3A%22%2Fnotes%22%2C%22docName%22%3A%22%E6%96%87%E6%A1%A3.md%22%2C%22vaultRoot%22%3Anull%2C%22fileName%22%3A%22%E5%9B%BE%E7%89%87.png%22%7D";
        let metadata = decode_attachment_metadata(encoded).expect("valid attachment metadata");
        assert_eq!(metadata.doc_dir, "/notes");
        assert_eq!(metadata.doc_name, "文档.md");
        assert_eq!(metadata.vault_root, None);
        assert_eq!(metadata.file_name, "图片.png");
    }
}
