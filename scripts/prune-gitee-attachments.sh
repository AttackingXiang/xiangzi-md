#!/usr/bin/env bash
# 修剪 Gitee release 附件，保留最新 KEEP 个版本，删除更早版本的全部附件，
# 以免仓库附件总量撞上 Gitee 的 1GB 配额（超配额后新附件一律被拒，返回
# {"message":"验证失败：文件大小已超出仓库附件配额：1 GB"}）。
#
# 环境变量：
#   GITEE_TOKEN  必填，具备仓库写权限的令牌
#   GITEE_REPO   选填，owner/repo，默认 tlqgyx/xiangzi-md
#   KEEP         选填，保留最新多少个版本，默认 10
#   DRY_RUN      选填，true 时只打印将删除的内容而不实际删除，默认 false
set -euo pipefail

: "${GITEE_TOKEN:?需要 GITEE_TOKEN}"
GITEE_REPO="${GITEE_REPO:-tlqgyx/xiangzi-md}"
KEEP="${KEEP:-10}"
DRY_RUN="${DRY_RUN:-false}"
API="https://gitee.com/api/v5/repos/${GITEE_REPO}"

gitee_curl() {
  curl -H "Authorization: Bearer ${GITEE_TOKEN}" \
    --silent --show-error --retry 4 --retry-all-errors \
    --connect-timeout 20 --max-time 60 "$@"
}

# 1) 分页拉取全部 release，收集 {id, tag}
releases="$(mktemp)"
page=1
while :; do
  resp="$(gitee_curl --fail "${API}/releases?page=${page}&per_page=100&direction=desc")"
  n="$(printf '%s' "${resp}" | jq 'length')"
  [ "${n}" -eq 0 ] && break
  printf '%s' "${resp}" | jq -c '.[] | {id, tag: .tag_name}' >> "${releases}"
  [ "${n}" -lt 100 ] && break
  page=$((page + 1))
done

# 2) 只在符合 vX.Y.Z 的版本里，按 semver 选出要保留的最新 KEEP 个 tag
keep_tags="$(jq -r '.tag' "${releases}" \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$' \
  | sort -V | tail -n "${KEEP}")"
echo "保留最新 ${KEEP} 个版本："
printf '%s\n' "${keep_tags}" | sed 's/^/  /'
echo "DRY_RUN=${DRY_RUN}"

# 3) 遍历所有 release，不在保留集里的删除其全部附件
deleted=0
while IFS= read -r line; do
  id="$(printf '%s' "${line}" | jq -r '.id')"
  tag="$(printf '%s' "${line}" | jq -r '.tag')"
  if printf '%s\n' "${keep_tags}" | grep -qxF "${tag}"; then
    continue
  fi
  files="$(gitee_curl --fail "${API}/releases/${id}/attach_files?per_page=100")"
  count="$(printf '%s' "${files}" | jq 'length')"
  [ "${count}" -eq 0 ] && continue
  echo "版本 ${tag} (release ${id})：${count} 个附件"
  while IFS=$'\t' read -r aid name; do
    if [ "${DRY_RUN}" = "true" ]; then
      echo "  [dry-run] 将删除 ${name} (id=${aid})"
    else
      gitee_curl --fail -X DELETE "${API}/releases/${id}/attach_files/${aid}" >/dev/null
      echo "  已删除 ${name}"
      deleted=$((deleted + 1))
    fi
  done < <(printf '%s' "${files}" | jq -r '.[] | [.id, .name] | @tsv')
done < "${releases}"

rm -f "${releases}"
if [ "${DRY_RUN}" = "true" ]; then
  echo "这是 dry-run，未实际删除；确认无误后将 DRY_RUN 设为 false 再运行。"
else
  echo "完成，共删除 ${deleted} 个附件。"
fi
