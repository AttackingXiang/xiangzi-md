# Xiangzi MD 发布流程

本文档描述当前 GitHub Release、Gitee 镜像和桌面自动更新的标准发版流程。

## 1. 发版前准备

确保工作区位于 `main`，并同步远端：

```bash
git fetch origin --prune --tags
git status --short --branch
```

确认准备发布的代码、文档和图片都已纳入版本控制，不要混入临时文件。

### 更新版本号

以下五处版本必须完全一致：

- `package.json` 的 `version`
- `package-lock.json` 顶层及根 package 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`
- `src-tauri/Cargo.toml` 的 `[package].version`
- `src-tauri/Cargo.lock` 中 `name = "xiangzi-md"` package 的 `version`

不要修改 Cargo.lock 中其他依赖的版本。

### 本地质量门禁

```bash
npm ci
npm run check
npm run rust:check
```

`npm run check` 包含 Prettier、ESLint、前端测试、类型检查和 Vite 构建；
`npm run rust:check` 包含 rustfmt、Clippy 和 Rust 测试。任何一步失败都不要打 tag。

## 2. 提交并推送 main

建议把功能、CI 和版本升级分成语义清晰的提交：

```bash
git add -A
git commit -m "feat: ..."
git commit -m "chore(release): bump version to X.Y.Z"
git push origin main
```

推送 main 会触发：

- `CI`：版本一致性、前端检查、macOS/Windows Rust 检查
- `Sync to Gitee`：同步 main 和受管分支到 Gitee

推荐等待 main CI 成功后再打 tag。Release workflow 还会重新执行正式发布门禁，避免发布未经验证的代码。

## 3. 创建并推送 annotated tag

将发布说明写入文件，避免 shell 转义和 Git 清理以 `#` 开头的 Markdown 标题：

```bash
cat >/tmp/xiangzi-release-notes.md <<'EOF'
## 本次更新

### 新功能

- ...

### 修复

- ...
EOF

git tag --cleanup=verbatim -a vX.Y.Z -F /tmp/xiangzi-release-notes.md
git push origin vX.Y.Z
```

tag 必须满足 `vX.Y.Z` 格式，版本必须与五处应用版本一致，且 tag 指向的提交必须属于 `origin/main`。不要移动或强制覆盖已经发布的 tag。

## 4. 自动发布流水线

推送 tag 后会触发以下流程。

### Release Desktop

1. `Resolve release version`：校验 tag、五处版本和 main 祖先关系，生成发布说明。
2. `Release gate`：macOS 和 Windows 并行执行前端与 Rust 门禁。
3. `Build`：macOS Universal 和 Windows x64 并行构建、签名，生成校验和、SBOM、attestation，并上传 7 天保留的临时 Actions Artifact。
4. `Publish unified GitHub Release`：等待两个平台完成，验证完整产物集，生成唯一的跨平台 `latest.json`，创建 GitHub Release 并统一上传所有附件。

最终 `latest.json` 必须包含：

- `darwin-aarch64`
- `darwin-x86_64`
- `darwin-aarch64-app`
- `darwin-x86_64-app`
- `windows-x86_64`
- `windows-x86_64-nsis`

### Sync to Gitee

同步当前 tag 和受管分支。若 Gitee 已存在解析到同一提交的 tag，则按幂等成功处理；若同名 tag 指向不同提交，则拒绝覆盖。

### Publish Gitee Release

Release Desktop 成功后自动触发：

1. 确保 Gitee tag 和 Release 存在。
2. Windows 与 macOS 两个 job 并行上传附件。
3. 已存在的同名附件自动跳过。
4. 单次大文件上传最长 30 分钟，失败后再尝试一次。
5. 两个平台成功后统一更新 Gitee `updater/latest.json`。

## 5. 发版后验证

在 GitHub Actions 中确认以下流程成功：

- `CI`
- `Sync to Gitee`
- `Release Desktop`
- `Publish Gitee Release`

检查 GitHub Release：

- DMG、EXE、`.app.tar.gz` 和两个 `.sig` 齐全
- 两份 SHA256SUMS 和两份 SBOM 齐全
- `latest.json` 版本正确且包含六个平台键

检查 Gitee Release：

- macOS、Windows 安装包和 updater 包齐全
- `updater` 分支的 `latest.json` 已更新到当前版本

已安装客户端继续读取以下固定地址，无需重新安装：

- `https://github.com/AttackingXiang/xiangzi-md/releases/latest/download/latest.json`
- `https://gitee.com/tlqgyx/xiangzi-md/raw/updater/latest.json`

## 6. 失败修复

### GitHub Release 构建或汇总失败

在 `Release Desktop` 选择 **Run workflow**，输入现有 tag，并开启 `force`。修复运行会重新构建并用 `--clobber` 更新同名 Release 附件。

### Gitee 附件上传失败

在 `Publish Gitee Release` 选择 **Run workflow**，输入现有 tag。工作流会跳过已经存在的附件，只补传缺失文件；修复旧版本时不会把 updater 降级。

### 禁止操作

- 不要强制覆盖公开发布的 GitHub/Gitee tag。
- 不要手工修改 updater 签名或 `latest.json` 中的签名值。
- 不要更换 `TAURI_SIGNING_PRIVATE_KEY`，除非同时设计客户端密钥迁移方案。
- 不要在任一质量门禁失败时继续发布。
