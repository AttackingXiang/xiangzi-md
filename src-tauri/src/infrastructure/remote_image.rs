use crate::domain::error::{AppError, AppResult};
use reqwest::{blocking::Client, redirect::Policy, StatusCode, Url};
use std::{
    io::Read,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};

const MAX_REMOTE_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;

fn public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || ip == Ipv4Addr::BROADCAST
        || octets[0] == 0
        || octets[0] >= 240
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)))
}

fn public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return public_ipv4(ipv4);
    }
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_ipv4(ip),
        IpAddr::V6(ip) => public_ipv6(ip),
    }
}

fn validate_and_resolve(url: &Url) -> AppResult<(String, Vec<SocketAddr>)> {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::new(
            "remote_image_url_invalid",
            "远程图片仅支持无凭据的 HTTPS 地址",
        ));
    }
    let host = url
        .host_str()
        .filter(|host| !host.eq_ignore_ascii_case("localhost") && !host.ends_with(".local"))
        .ok_or_else(|| AppError::new("remote_image_url_invalid", "远程图片主机无效"))?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| AppError::new("remote_image_dns_failed", error.to_string()))?
        .collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return Err(AppError::new(
            "remote_image_host_blocked",
            "远程图片地址指向本机或私有网络",
        ));
    }
    Ok((host.to_owned(), addresses))
}

pub fn fetch(url: &str) -> AppResult<Vec<u8>> {
    let mut current = Url::parse(url)
        .map_err(|error| AppError::new("remote_image_url_invalid", error.to_string()))?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let (host, addresses) = validate_and_resolve(&current)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(15))
            .redirect(Policy::none())
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|error| AppError::new("remote_image_client_failed", error.to_string()))?;
        let response = client
            .get(current.clone())
            .header(reqwest::header::ACCEPT, "image/*")
            .send()
            .map_err(|error| AppError::new("remote_image_fetch_failed", error.to_string()))?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(AppError::new(
                    "remote_image_redirect_limit",
                    "远程图片重定向次数过多",
                ));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    AppError::new("remote_image_redirect_invalid", "远程图片重定向地址无效")
                })?;
            current = current.join(location).map_err(|error| {
                AppError::new("remote_image_redirect_invalid", error.to_string())
            })?;
            continue;
        }
        if response.status() != StatusCode::OK {
            return Err(AppError::new(
                "remote_image_http_error",
                format!("远程图片返回 HTTP {}", response.status().as_u16()),
            ));
        }
        let image_content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().starts_with("image/"));
        if !image_content_type {
            return Err(AppError::new(
                "remote_image_type_invalid",
                "远程地址返回的不是图片",
            ));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_REMOTE_IMAGE_BYTES)
        {
            return Err(AppError::new(
                "remote_image_too_large",
                "远程图片超过 20 MB",
            ));
        }
        let mut bytes = Vec::with_capacity(512 * 1024);
        response
            .take(MAX_REMOTE_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| AppError::io("读取远程图片失败", error))?;
        if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
            return Err(AppError::new(
                "remote_image_too_large",
                "远程图片超过 20 MB",
            ));
        }
        return Ok(bytes);
    }
    Err(AppError::new(
        "remote_image_fetch_failed",
        "远程图片加载失败",
    ))
}

#[cfg(test)]
mod tests {
    use super::{public_ip, validate_and_resolve};
    use reqwest::Url;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn blocks_private_loopback_and_link_local_addresses() {
        for ip in [
            IpAddr::V4(Ipv4Addr::LOCALHOST),
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            IpAddr::V4(Ipv4Addr::new(169, 254, 1, 2)),
            IpAddr::V6(Ipv6Addr::LOCALHOST),
        ] {
            assert!(!public_ip(ip), "accepted private address {ip}");
        }
        assert!(public_ip(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    #[test]
    fn rejects_insecure_or_credentialed_remote_urls_before_network_access() {
        for url in ["http://example.com/a.png", "https://user@example.com/a.png"] {
            assert!(validate_and_resolve(&Url::parse(url).expect("test url")).is_err());
        }
    }
}
