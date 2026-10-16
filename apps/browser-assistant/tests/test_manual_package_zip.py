"""
人工发布辅助包 ZIP 生成与导出单元测试
验证：
1. generate_package_zip_stream 生成合法 ZIP 文件流
2. ZIP 包内 README.md 包含完整 Markdown 指引、核对清单、标题与话题
3. content.txt 包含完整正文内容
4. metadata.json 为合法 JSON 并包含关键结构化字段
5. images/ 目录包含正确的按序素材与清单文件
"""
import io
import json
import zipfile
from src.server import generate_package_zip_stream
from src.models import MediaItem


def test_generate_manual_package_zip_content():
    channel = "XIAOHONGSHU"
    title = "小红书爆款图文实战指南"
    body = "这是完整正文内容，包含痛点挖掘、方案展开与促动呼吁。\n第二段：真实落地数据。"
    tags = ["小红书运营", "AI生产力", "GEO实战"]
    media_items = [
        MediaItem(index=1, type="IMAGE", url="https://example.com/cover.png", notes="首图封面"),
        MediaItem(index=2, type="IMAGE", url="https://example.com/step1.png", notes="方案图解"),
    ]

    zip_buf = generate_package_zip_stream(
        channel=channel,
        title=title,
        body=body,
        tags=tags,
        media_items=media_items
    )

    assert zip_buf is not None
    assert zip_buf.getvalue()[:4] == b"PK\x03\x04"  # ZIP magic number

    with zipfile.ZipFile(zip_buf, "r") as zf:
        namelist = zf.namelist()
        assert "README.md" in namelist
        assert "content.txt" in namelist
        assert "metadata.json" in namelist
        assert "images/image_manifest.txt" in namelist

        # 检查 README.md
        readme = zf.read("README.md").decode("utf-8")
        assert "# GeoLens 人工发布辅助包 - XIAOHONGSHU" in readme
        assert "小红书爆款图文实战指南" in readme
        assert "#小红书运营" in readme
        assert "发布核对清单" in readme
        assert "https://creator.xiaohongshu.com/publish/publish?source=official" in readme

        # 检查 content.txt
        content = zf.read("content.txt").decode("utf-8")
        assert content == body

        # 检查 metadata.json
        meta_raw = zf.read("metadata.json").decode("utf-8")
        meta = json.loads(meta_raw)
        assert meta["channel"] == "XIAOHONGSHU"
        assert meta["title"] == title
        assert meta["body_length"] == len(body)
        assert meta["media_count"] == 2
        assert len(meta["checklist"]) >= 5

        # 检查 images manifest
        manifest = zf.read("images/image_manifest.txt").decode("utf-8")
        assert "01: URL=https://example.com/cover.png" in manifest
        assert "02: URL=https://example.com/step1.png" in manifest
