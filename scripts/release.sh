#!/bin/bash

# Chrome 扩展打包脚本

set -e

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# 从 manifest.json 读取版本号
VERSION=$(grep -o '"version": *"[^"]*"' manifest.json | grep -o '[0-9.]*')

if [ -z "$VERSION" ]; then
  echo "Error: 无法从 manifest.json 读取版本号"
  exit 1
fi

# 输出文件名
OUTPUT_NAME="immersive-learning-v${VERSION}.zip"
OUTPUT_PATH="$PROJECT_DIR/$OUTPUT_NAME"

echo "正在打包 Immersive Learning v${VERSION}..."

# 删除旧的打包文件（如果存在）
rm -f "$OUTPUT_PATH"

# 打包，排除不需要的文件
zip -r "$OUTPUT_PATH" . \
  -x "*.git*" \
  -x "*.DS_Store" \
  -x "scripts/*" \
  -x "*.zip" \
  -x "node_modules/*" \
  -x "*.md" \
  -x ".github/*"

echo "打包完成: $OUTPUT_NAME"
echo "文件大小: $(du -h "$OUTPUT_PATH" | cut -f1)"
