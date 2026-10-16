"""
人工发布辅助包 ZIP 生成与导出完整性测试
严格验证：
1. generate_package_zip_stream 生成合法规范 ZIP
2. 真实测试图片打包与解压校验：文件数量、内容一致性、非零文件大小、顺序编号与清单一致性
3. 远程 HTTP 素材真实下载与打包
4. 远程素材不存在或下载失败时明确记录在 DOWNLOAD_FAILURES.txt，绝不以 0 字节空文件或纯 URL 替代
5. 结构化元数据 (metadata.json) 与发布指引 (README.md) 的完整性与一致性
"""
import io
import json
import zipfile
import tempfile
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from src.server import generate_package_zip_stream
from src.models import MediaItem


def test_generate_manual_package_zip_with_real_local_images(tmp_path: Path):
    """验证真实本地图片的打包、解压、文件大小与顺序清单一致性"""
    channel = "XIAOHONGSHU"
    title = "小红书爆款图文实战指南"
    body = "这是完整正文内容，包含痛点挖掘、方案展开与促动呼吁。\n第二段：真实落地数据。"
    tags = ["小红书运营", "AI生产力", "GEO实战"]

    # 创建两个带真实非空内容的本地临时图片
    img1_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x01" * 200
    img2_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x02" * 450
    file1 = tmp_path / "slide_cover.png"
    file2 = tmp_path / "slide_detail.png"
    file1.write_bytes(img1_bytes)
    file2.write_bytes(img2_bytes)

    media_items = [
        MediaItem(index=1, type="IMAGE", url=f"file:///{file1.as_posix()}", local_path=str(file1), notes="首图封面"),
        MediaItem(index=2, type="IMAGE", url=f"file:///{file2.as_posix()}", local_path=str(file2), notes="方案图解"),
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

    # 解压并校验
    extract_dir = tmp_path / "extracted_zip"
    extract_dir.mkdir()
    with zipfile.ZipFile(zip_buf, "r") as zf:
        zf.extractall(extract_dir)
        namelist = zf.namelist()

    assert "README.md" in namelist
    assert "content.txt" in namelist
    assert "metadata.json" in namelist
    assert "images/image_manifest.txt" in namelist
    assert "images/01_slide_cover.png" in namelist
    assert "images/02_slide_detail.png" in namelist
    assert "images/DOWNLOAD_FAILURES.txt" not in namelist

    # 1. 验证解压后图片内容与大小 byte-for-byte 完全一致
    ext_img1 = extract_dir / "images" / "01_slide_cover.png"
    ext_img2 = extract_dir / "images" / "02_slide_detail.png"
    assert ext_img1.exists() and ext_img1.stat().st_size == len(img1_bytes)
    assert ext_img2.exists() and ext_img2.stat().st_size == len(img2_bytes)
    assert ext_img1.read_bytes() == img1_bytes
    assert ext_img2.read_bytes() == img2_bytes

    # 2. 验证清单与 metadata 一致性
    manifest_text = (extract_dir / "images" / "image_manifest.txt").read_text(encoding="utf-8")
    assert "01: images/01_slide_cover.png" in manifest_text
    assert f"大小: {len(img1_bytes)} bytes" in manifest_text
    assert "02: images/02_slide_detail.png" in manifest_text
    assert f"大小: {len(img2_bytes)} bytes" in manifest_text

    meta = json.loads((extract_dir / "metadata.json").read_text(encoding="utf-8"))
    assert meta["channel"] == "XIAOHONGSHU"
    assert meta["media_count"] == 2
    assert meta["packed_media_count"] == 2
    assert meta["asset_integrity"] == "COMPLETE"
    assert len(meta["download_failures"]) == 0

    # 3. 验证 README.md
    readme_text = (extract_dir / "README.md").read_text(encoding="utf-8")
    assert "小红书爆款图文实战指南" in readme_text
    assert "素材完整性状态: **COMPLETE**" in readme_text
    assert "共有 2 个素材，已全部按发布顺序保存在 `images/` 目录下" in readme_text


class MockAssetHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/assets/test1.png":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\xaa" * 300
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        elif self.path == "/assets/test2.jpg":
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            content = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\xbb" * 500
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not Found")

    def log_message(self, format, *args):
        pass  # 静默测试输出


def test_generate_manual_package_zip_remote_download_and_failure_reporting(tmp_path: Path):
    """
    验证：
    1. HTTP 远程真实素材下载并打包进 images/
    2. 远程素材不存在 (404) 时记录在 DOWNLOAD_FAILURES.txt 中
    3. 绝不创建 0 字节空文件替代失败素材
    """
    # 启动轻量级临时 HTTP 服务
    httpd = HTTPServer(("127.0.0.1", 0), MockAssetHandler)
    port = httpd.server_port
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()

    try:
        url_valid1 = f"http://127.0.0.1:{port}/assets/test1.png"
        url_valid2 = f"http://127.0.0.1:{port}/assets/test2.jpg"
        url_missing = f"http://127.0.0.1:{port}/assets/non_existent.png"

        media_items = [
            MediaItem(index=1, type="IMAGE", url=url_valid1, notes="第一张真实图"),
            MediaItem(index=2, type="IMAGE", url=url_valid2, notes="第二张真实图"),
            MediaItem(index=3, type="IMAGE", url=url_missing, notes="不存在的图"),
        ]

        zip_buf = generate_package_zip_stream(
            channel="XIAOHONGSHU",
            title="远程下载测试",
            body="正文内容",
            tags=["测试"],
            media_items=media_items
        )

        extract_dir = tmp_path / "extracted_remote"
        extract_dir.mkdir()
        with zipfile.ZipFile(zip_buf, "r") as zf:
            zf.extractall(extract_dir)
            namelist = zf.namelist()

        # 验证两个有效素材成功下载且文件大小 > 0
        assert "images/01_image.png" in namelist
        assert "images/02_image.jpg" in namelist
        img1 = extract_dir / "images" / "01_image.png"
        img2 = extract_dir / "images" / "02_image.jpg"
        assert img1.stat().st_size == 316
        assert img2.stat().st_size == 510

        # 验证绝无 0 字节虚假文件
        assert "images/03_image.png" not in namelist
        assert not (extract_dir / "images" / "03_image.png").exists()

        # 验证 DOWNLOAD_FAILURES.txt 准确记录了 404 失败
        assert "images/DOWNLOAD_FAILURES.txt" in namelist
        failures_text = (extract_dir / "images" / "DOWNLOAD_FAILURES.txt").read_text(encoding="utf-8")
        assert "03: 远程素材下载失败" in failures_text
        assert "non_existent.png" in failures_text
        assert "404" in failures_text

        # 验证 metadata.json 记录 PARTIAL_FAILURES
        meta = json.loads((extract_dir / "metadata.json").read_text(encoding="utf-8"))
        assert meta["media_count"] == 3
        assert meta["packed_media_count"] == 2
        assert meta["asset_integrity"] == "PARTIAL_FAILURES"
        assert len(meta["download_failures"]) == 1

        # 验证 README.md 呈现警告
        readme_text = (extract_dir / "README.md").read_text(encoding="utf-8")
        assert "[!WARNING] 素材下载异常警告" in readme_text
        assert "non_existent.png" in readme_text

    finally:
        httpd.shutdown()
        httpd.server_close()


def test_reject_zero_byte_local_file(tmp_path: Path):
    """验证本地 0 字节空文件被明确拒绝打包进 images/ 并记入失败"""
    zero_file = tmp_path / "empty.png"
    zero_file.write_bytes(b"")  # 0 bytes
    assert zero_file.stat().st_size == 0

    media_items = [
        MediaItem(index=1, type="IMAGE", url=f"file:///{zero_file.as_posix()}", local_path=str(zero_file)),
    ]

    zip_buf = generate_package_zip_stream(
        channel="XIAOHONGSHU",
        title="拒绝空文件测试",
        body="正文",
        tags=[],
        media_items=media_items
    )

    with zipfile.ZipFile(zip_buf, "r") as zf:
        namelist = zf.namelist()
        assert "images/01_empty.png" not in namelist
        assert "images/DOWNLOAD_FAILURES.txt" in namelist
        failures_text = zf.read("images/DOWNLOAD_FAILURES.txt").decode("utf-8")
        assert "0 bytes" in failures_text
