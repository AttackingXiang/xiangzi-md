# 更新签名与发布

## 信任模型

客户端内置 updater 公钥，按 GitHub、Gitee 的顺序读取 `latest.json`。网络错误、非 2xx 或无效 manifest 会继续尝试下一个端点；下载完成后必须通过签名校验才能安装。不能关闭签名校验。

私钥不在仓库中。当前开发机私钥位于 `~/.tauri/xiangzi-md.key`，权限应为 `0600`；公钥位于 `~/.tauri/xiangzi-md.key.pub`，其内容已写入 `src-tauri/tauri.conf.json`。

## GitHub Actions Secret

首次发布前，在仓库 Actions Secret 中创建：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件的完整内容；
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：当前密钥无密码，可不创建或设置为空；
- `GITEE_PRIVATE_KEY`、`GITEE_TOKEN`：沿用源码镜像与 Gitee Release 的现有凭据。

GitHub CLI 登录后可执行：

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/xiangzi-md.key
```

不要把私钥复制到 issue、提交、workflow 参数或普通日志中。

## 发布流程

1. 同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 运行 `npm run check`、`npm run rust:check` 和签名本地构建。
3. 推送包含新版本号的 `main`。`Release Desktop` 只在远端不存在对应 `v<version>` 标签时发布。
4. GitHub 构建 macOS Universal DMG、Windows x64 NSIS、updater archive、签名和 `latest.json`。
5. `Publish Gitee Release` 同步标签与全部附件，将 manifest 中的下载地址改写为 Gitee 地址，并发布到 `updater` 分支。

## 轮换与恢复

私钥丢失或疑似泄露时立即生成新密钥，并在同一个版本发布周期内同时更新客户端公钥和 GitHub Secret。旧客户端无法信任新私钥签发的更新，因此必须保留一次由旧私钥签发、内置新公钥的桥接版本；若旧私钥已经不可用，只能要求用户手动安装新版本。
