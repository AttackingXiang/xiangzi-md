use super::blocking;
use crate::{
    domain::{
        error::{AppError, AppResult},
        models::PathResult,
    },
    infrastructure::workspace,
};
use image::{codecs::jpeg::JpegEncoder, ImageBuffer, Rgba};
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, State};
use tempfile::NamedTempFile;

const MAX_PNG_RAW_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_JPEG_RAW_BYTES: u64 = 512 * 1024 * 1024;

fn raster_chunk_payload(bytes: &[u8]) -> AppResult<(&str, &[u8])> {
    let id_length = bytes.first().copied().unwrap_or_default() as usize;
    if id_length == 0 || bytes.len() < id_length + 1 {
        return Err(AppError::new(
            "raster_chunk_invalid",
            "导出图片分片缺少任务标识",
        ));
    }
    let id = std::str::from_utf8(&bytes[1..=id_length])
        .map_err(|_| AppError::new("raster_chunk_invalid", "导出图片分片的任务标识编码无效"))?;
    Ok((id, &bytes[id_length + 1..]))
}

#[derive(Clone, Copy)]
enum RasterFormat {
    Png,
    Jpeg,
}

impl RasterFormat {
    fn parse(value: &str) -> AppResult<Self> {
        match value {
            "png" => Ok(Self::Png),
            "jpeg" => Ok(Self::Jpeg),
            _ => Err(AppError::new("导出格式无效", "仅支持 PNG 和 JPEG 图片")),
        }
    }
}

struct RasterSession {
    output_path: PathBuf,
    width: u32,
    height: u32,
    format: RasterFormat,
    expected_bytes: u64,
    written_bytes: u64,
    raw: NamedTempFile,
}

struct RasterExportInner {
    next_id: AtomicU64,
    sessions: Mutex<HashMap<String, RasterSession>>,
}

#[derive(Clone)]
pub struct RasterExportStore {
    inner: Arc<RasterExportInner>,
}

impl Default for RasterExportStore {
    fn default() -> Self {
        Self {
            inner: Arc::new(RasterExportInner {
                next_id: AtomicU64::new(1),
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }
}

impl RasterExportStore {
    fn begin(
        &self,
        output_path: String,
        width: u32,
        height: u32,
        format: &str,
    ) -> AppResult<String> {
        if width == 0 || height == 0 {
            return Err(AppError::new("导出尺寸无效", "导出图片宽高必须大于 0"));
        }
        let format = RasterFormat::parse(format)?;
        let expected_bytes = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| AppError::new("导出尺寸过大", "导出图片像素数溢出"))?;
        let max_bytes = match format {
            RasterFormat::Png => MAX_PNG_RAW_BYTES,
            RasterFormat::Jpeg => {
                if width > u16::MAX.into() || height > u16::MAX.into() {
                    return Err(AppError::new(
                        "jpeg_size_limit",
                        "JPEG 宽高不能超过 65535 像素，请改用 PNG",
                    ));
                }
                MAX_JPEG_RAW_BYTES
            }
        };
        if expected_bytes > max_bytes {
            return Err(AppError::new(
                "raster_export_too_large",
                match format {
                    RasterFormat::Png => "导出图片原始像素超过 8 GB 安全上限",
                    RasterFormat::Jpeg => "JPEG 原始像素超过 512 MB，请改用 PNG",
                },
            ));
        }

        let id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        let session = RasterSession {
            output_path: PathBuf::from(output_path),
            width,
            height,
            format,
            expected_bytes,
            written_bytes: 0,
            raw: NamedTempFile::new()
                .map_err(|error| AppError::io("创建导出像素临时文件失败", error))?,
        };
        self.inner
            .sessions
            .lock()
            .map_err(|_| AppError::new("导出状态异常", "导出状态锁已损坏"))?
            .insert(id.clone(), session);
        Ok(id)
    }

    fn append(&self, id: &str, bytes: &[u8]) -> AppResult<()> {
        let mut sessions = self
            .inner
            .sessions
            .lock()
            .map_err(|_| AppError::new("导出状态异常", "导出状态锁已损坏"))?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| AppError::new("导出任务不存在", "导出任务已结束或已取消"))?;
        let next = session
            .written_bytes
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| AppError::new("导出数据过大", "导出像素数据溢出"))?;
        if next > session.expected_bytes {
            return Err(AppError::new(
                "raster_data_overflow",
                "收到的导出像素超过预期尺寸",
            ));
        }
        session
            .raw
            .write_all(bytes)
            .map_err(|error| AppError::io("写入导出像素失败", error))?;
        session.written_bytes = next;
        Ok(())
    }

    fn take(&self, id: &str) -> AppResult<RasterSession> {
        self.inner
            .sessions
            .lock()
            .map_err(|_| AppError::new("导出状态异常", "导出状态锁已损坏"))?
            .remove(id)
            .ok_or_else(|| AppError::new("导出任务不存在", "导出任务已结束或已取消"))
    }

    fn cancel(&self, id: &str) -> AppResult<()> {
        let _ = self.take(id)?;
        Ok(())
    }
}

fn encode_png(app: &AppHandle, mut session: RasterSession) -> AppResult<PathResult> {
    session
        .raw
        .as_file_mut()
        .seek(SeekFrom::Start(0))
        .map_err(|error| AppError::io("读取导出像素失败", error))?;
    workspace::write_streamed_file(app, &session.output_path, |output| {
        let mut encoder = png::Encoder::new(output, session.width, session.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| {
            AppError::new("png_encode_failed", format!("PNG 编码失败：{error}"))
        })?;
        {
            let mut stream = writer
                .stream_writer_with_size(256 * 1024)
                .map_err(|error| {
                    AppError::new("png_encode_failed", format!("PNG 编码失败：{error}"))
                })?;
            std::io::copy(session.raw.as_file_mut(), &mut stream)
                .map_err(|error| AppError::io("流式写入 PNG 失败", error))?;
            stream.finish().map_err(|error| {
                AppError::new("png_encode_failed", format!("PNG 编码失败：{error}"))
            })?;
        }
        writer
            .finish()
            .map_err(|error| AppError::new("png_encode_failed", format!("PNG 编码失败：{error}")))
    })
}

fn encode_jpeg(app: &AppHandle, mut session: RasterSession) -> AppResult<PathResult> {
    session
        .raw
        .as_file_mut()
        .seek(SeekFrom::Start(0))
        .map_err(|error| AppError::io("读取导出像素失败", error))?;
    let mut pixels = Vec::with_capacity(session.expected_bytes as usize);
    session
        .raw
        .read_to_end(&mut pixels)
        .map_err(|error| AppError::io("读取 JPEG 像素失败", error))?;
    let image = ImageBuffer::<Rgba<u8>, Vec<u8>>::from_raw(session.width, session.height, pixels)
        .ok_or_else(|| AppError::new("jpeg_pixels_invalid", "JPEG 像素数据与尺寸不匹配"))?;
    workspace::write_streamed_file(app, &session.output_path, |output| {
        JpegEncoder::new_with_quality(output, 92)
            .encode_image(&image)
            .map_err(|error| AppError::new("jpeg_encode_failed", format!("JPEG 编码失败：{error}")))
    })
}

fn finish_raster(app: &AppHandle, session: RasterSession) -> AppResult<PathResult> {
    if session.written_bytes != session.expected_bytes {
        return Err(AppError::new(
            "raster_data_incomplete",
            format!(
                "导出像素不完整：应为 {} 字节，实际为 {} 字节",
                session.expected_bytes, session.written_bytes
            ),
        ));
    }
    match session.format {
        RasterFormat::Png => encode_png(app, session),
        RasterFormat::Jpeg => encode_jpeg(app, session),
    }
}

#[tauri::command]
pub async fn begin_raster_export(
    store: State<'_, RasterExportStore>,
    output_path: String,
    width: u32,
    height: u32,
    format: String,
) -> AppResult<String> {
    let store = store.inner().clone();
    blocking(move || store.begin(output_path, width, height, &format)).await
}

#[tauri::command]
pub async fn append_raster_export(
    store: State<'_, RasterExportStore>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<()> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err(AppError::new("导出数据无效", "导出像素必须使用二进制传输")),
    };
    // WebView2 may strip application-defined headers from Tauri's custom IPC
    // protocol. Carry the small session id in the raw body so Windows and
    // WebKit use exactly the same transport.
    let (session_id, pixels) = raster_chunk_payload(&bytes)?;
    let session_id = session_id.to_owned();
    let pixels = pixels.to_vec();
    let store = store.inner().clone();
    blocking(move || store.append(&session_id, &pixels)).await
}

#[tauri::command]
pub async fn finish_raster_export(
    app: AppHandle,
    store: State<'_, RasterExportStore>,
    session_id: String,
) -> AppResult<PathResult> {
    let store = store.inner().clone();
    blocking(move || finish_raster(&app, store.take(&session_id)?)).await
}

#[tauri::command]
pub async fn cancel_raster_export(
    store: State<'_, RasterExportStore>,
    session_id: String,
) -> AppResult<()> {
    let store = store.inner().clone();
    blocking(move || store.cancel(&session_id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_jpeg_dimensions_outside_the_format_limit() {
        let store = RasterExportStore::default();
        let error = store
            .begin("/tmp/too-tall.jpg".into(), 100, 70_000, "jpeg")
            .expect_err("oversized jpeg must fail");
        assert_eq!(error.code, "jpeg_size_limit");
    }

    #[test]
    fn refuses_more_rgba_bytes_than_the_declared_dimensions() {
        let store = RasterExportStore::default();
        let id = store
            .begin("/tmp/a.png".into(), 1, 1, "png")
            .expect("session");
        let error = store
            .append(&id, &[0; 5])
            .expect_err("one RGBA pixel is four bytes");
        assert_eq!(error.code, "raster_data_overflow");
        store.cancel(&id).expect("cancel");
    }

    #[test]
    fn decodes_session_id_from_raw_chunk_body() {
        let (id, pixels) = raster_chunk_payload(&[3, b'a', b'b', b'c', 1, 2, 3]).expect("chunk");
        assert_eq!(id, "abc");
        assert_eq!(pixels, &[1, 2, 3]);

        let error = raster_chunk_payload(&[4, b'a']).expect_err("truncated id must fail");
        assert_eq!(error.code, "raster_chunk_invalid");
    }
}
