"""
GeoLens 本地浏览器助手 - FastAPI 服务端入口
提供受控 Localhost HTTP 接口，严格实施 Origin 白名单和本地配对令牌鉴权
"""
import io
import json
import zipfile
import urllib.request
import ssl
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, StreamingResponse

from .config import settings, BASE_DIR
from .security import (
    CURRENT_TOKEN, verify_origin, verify_request_auth
)
from .models import (
    CreatePublishTaskRequest, ConfirmPublishRequest, TaskStatusResponse,
    ExportPackageZipRequest
)
from .browser_manager import browser_manager
from .adapters.registry import registry
from .adapters.fallback import CREATOR_URL_MAP
from .task_runner import task_manager

app = FastAPI(
    title="GeoLens Browser Assistant",
    description="GeoLens 本地浏览器自动化辅助发布服务",
    version="0.1.0"
)

# 1. 跨域配置 (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. 挂载静态文件目录 (用于本地仿真测试页面)
static_dir = BASE_DIR / "src" / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


# 3. 来源与令牌安全检查依赖
async def require_auth(request: Request):
    # 优先校验请求来源
    if not verify_origin(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Origin / Referer 不在 GeoLens 白名单中"
        )
    # 校验本地令牌
    if not verify_request_auth(request):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: 缺少有效配对令牌 (X-Assistant-Token 或 Bearer Token)"
        )
    return True


@app.get("/api/health")
async def health_check():
    """健康探测端点（允许非鉴权探测连接状态）"""
    return {
        "status": "ok",
        "service": "GeoLens Browser Assistant",
        "version": "0.1.0",
        "auth_enabled": settings.auth_enabled
    }


@app.get("/api/auth-info")
async def get_auth_info(request: Request):
    """
    仅允许同机 Localhost 访问，用于 GeoLens 前端自动配对本地助手
    """
    client_host = request.client.host if request.client else "unknown"
    if client_host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅限本机访问")
    return {
        "token": CURRENT_TOKEN,
        "allowed_origins": settings.allowed_origins
    }


@app.get("/api/status", dependencies=[Depends(require_auth)])
async def get_system_status():
    """获取助手与浏览器运行状态、支持平台矩阵"""
    return {
        "channels": registry.get_supported_channels(),
        "active_drivers_count": len(browser_manager._active_drivers),
        "profiles_dir": str(browser_manager.get_profile_path("dummy").parent)
    }


# ---- 浏览器管理端点 ----

@app.post("/api/browser/launch", dependencies=[Depends(require_auth)])
async def launch_browser(payload: dict):
    channel = payload.get("channel", "ZHIHU")
    account_id = payload.get("account_id", "default")
    headless = payload.get("headless", False)
    try:
        driver = browser_manager.get_or_create_driver(channel, account_id, headless)
        publisher = registry.get_publisher(channel, driver)
        # 默认导航到官方创作页
        publisher.open_editor()
        return {
            "success": True,
            "channel": channel,
            "account_id": account_id,
            "profile_path": str(browser_manager.get_profile_path(channel, account_id)),
            "message": f"{channel} 受控浏览器已启动"
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/browser/close", dependencies=[Depends(require_auth)])
async def close_browser(payload: dict):
    channel = payload.get("channel", "ZHIHU")
    account_id = payload.get("account_id", "default")
    closed = browser_manager.close_driver(channel, account_id)
    return {"success": True, "closed": closed}


@app.post("/api/browser/open-login", dependencies=[Depends(require_auth)])
async def open_platform_login(payload: dict):
    """
    调起受控桌面 Chrome 浏览器并直接导航至官方扫码登录页面
    供创作者通过手机 App 扫码登录，会话持久化保存在本地独立 Profile
    """
    channel = payload.get("channel", "XIAOHONGSHU")
    account_id = payload.get("account_id", "default")
    try:
        driver = browser_manager.get_or_create_driver(channel, account_id, headless=False)
        publisher = registry.get_publisher(channel, driver)
        ok, msg = publisher.open_login_page()
        return {
            "success": ok,
            "channel": channel,
            "account_id": account_id,
            "message": msg,
            "current_url": driver.current_url
        }
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@app.post("/api/browser/check-login", dependencies=[Depends(require_auth)])
async def check_platform_login(payload: dict):
    channel = payload.get("channel", "ZHIHU")
    account_id = payload.get("account_id", "default")
    if not browser_manager.is_driver_running(channel, account_id):
        # 自动启动受控浏览器
        browser_manager.get_or_create_driver(channel, account_id, headless=False)
    driver = browser_manager.get_or_create_driver(channel, account_id)
    publisher = registry.get_publisher(channel, driver)

    # 若当前处于空标签页，自动加载创作平台以提取登录态
    try:
        curr = driver.current_url.lower()
        if not curr or curr in ["data:,", "about:blank", "chrome://new-tab-page/", "chrome://newtab/"]:
            publisher.open_editor()
    except Exception:
        pass

    is_logged_in, msg, extra = publisher.check_login()
    return {
        "channel": channel,
        "is_logged_in": is_logged_in,
        "message": msg,
        "extra": extra
    }


@app.post("/api/browser/clear-profile", dependencies=[Depends(require_auth)])
async def clear_profile(payload: dict):
    channel = payload.get("channel", "ZHIHU")
    account_id = payload.get("account_id", "default")
    try:
        browser_manager.clear_profile(channel, account_id)
        return {"success": True, "message": f"{channel} ({account_id}) 本地 Profile 已成功清理重置"}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ---- 发布任务编排端点 ----

@app.post("/api/tasks", response_model=TaskStatusResponse, dependencies=[Depends(require_auth)])
async def create_and_start_task(req: CreatePublishTaskRequest):
    """创建并启动自动化辅助发布任务"""
    return task_manager.start_task(req)


@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse, dependencies=[Depends(require_auth)])
async def get_task_status(task_id: str):
    """获取当前任务状态、执行步进日志与比对结果"""
    state = task_manager.get_task(task_id)
    if not state:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return state.to_response()


@app.post("/api/tasks/{task_id}/pause", dependencies=[Depends(require_auth)])
async def pause_task(task_id: str):
    ok = task_manager.pause_task(task_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return {"success": True, "message": "任务已暂停"}


@app.post("/api/tasks/{task_id}/resume", dependencies=[Depends(require_auth)])
async def resume_task(task_id: str):
    ok = task_manager.resume_task(task_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return {"success": True, "message": "任务已恢复"}


@app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(require_auth)])
async def cancel_task(task_id: str):
    ok = task_manager.cancel_task(task_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    return {"success": True, "message": "任务已取消"}


@app.post("/api/tasks/{task_id}/takeover", dependencies=[Depends(require_auth)])
async def manual_takeover(task_id: str):
    """人工接管：暂停自动化，保持受控浏览器，开启人工发布包"""
    ok = task_manager.takeover_task(task_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    state = task_manager.get_task(task_id)
    return {
        "success": True,
        "message": "已成功切换至人工接管模式",
        "manual_package": state.manual_package if state else None
    }


def download_remote_asset(url: str, timeout: int = 15) -> tuple[bytes | None, str | None, str | None]:
    """
    下载远程图片素材，返回 (bytes, ext, error_msg)
    保证非空、无虚假字节
    """
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GeoLens-Assistant/2.0"
            }
        )
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            if resp.status != 200:
                return None, None, f"HTTP {resp.status}"
            content = resp.read()
            if not content or len(content) == 0:
                return None, None, "下载内容为空 (0 bytes)"
            
            content_type = resp.headers.get("Content-Type", "")
            parsed = urlparse(url)
            p_ext = Path(parsed.path).suffix.lower()
            if p_ext in [".png", ".jpg", ".jpeg", ".webp", ".gif"]:
                ext = p_ext
            elif "image/jpeg" in content_type:
                ext = ".jpg"
            elif "image/png" in content_type:
                ext = ".png"
            elif "image/webp" in content_type:
                ext = ".webp"
            elif "image/gif" in content_type:
                ext = ".gif"
            else:
                ext = ".png"
            return content, ext, None
    except Exception as e:
        return None, None, str(e)


@app.post("/api/tasks/{task_id}/confirm", dependencies=[Depends(require_auth)])
async def confirm_publish_result(task_id: str, payload: ConfirmPublishRequest):
    """
    人工或自动化读取真实发布落地结果后确认
    区分已公开发布 (PUBLISHED) 与平台审核中 (PENDING_REVIEW)
    """
    ok, msg = task_manager.confirm_publish_result(
        task_id=task_id,
        canonical_url=payload.canonical_url,
        external_asset_id=payload.external_asset_id,
        verification_note=payload.verification_note,
        target_status=payload.status
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    state = task_manager.get_task(task_id)
    return {
        "success": True,
        "status": state.status if state else payload.status,
        "message": msg,
        "published_url": state.published_url if state else None,
        "external_asset_id": state.external_asset_id if state else None
    }


@app.post("/api/tasks/{task_id}/simulate-confirm", dependencies=[Depends(require_auth)])
async def simulate_user_publish_confirm(task_id: str):
    """
    测试辅助端点：针对仿真平台模拟用户在浏览器点击确认发布并自动检测结果
    """
    state = task_manager.get_task(task_id)
    if not state:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在")
    if state.channel != "SIMULATION":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 SIMULATION 渠道")
    
    driver = browser_manager.get_or_create_driver("SIMULATION", state.account_id)
    publisher = registry.get_publisher("SIMULATION", driver)
    
    # 点击仿真页面的确认发布
    publisher.simulate_user_publish_click()
    is_pub, msg, data = publisher.read_publish_result()
    if is_pub and data.get("canonical_url"):
        task_manager.confirm_publish_result(
            task_id=task_id,
            canonical_url=data["canonical_url"],
            external_asset_id=data.get("external_asset_id"),
            verification_note="仿真自动化闭环测试自动确认",
            target_status="PUBLISHED"
        )
        return {
            "success": True,
            "status": "PUBLISHED",
            "published_url": data["canonical_url"],
            "external_asset_id": data.get("external_asset_id")
        }
    return {"success": False, "message": msg}


def generate_package_zip_stream(
    channel: str,
    title: str,
    body: str,
    tags: list[str],
    media_items: list,
    checklist: list[str] | None = None,
    creator_url: str | None = None,
    instructions: str | None = None,
    generated_at: str | None = None
) -> io.BytesIO:
    """生成包含完整 Markdown、纯文本、结构化元数据和真实图片素材的 ZIP 包"""
    norm_channel = channel.upper()
    now_str = generated_at or datetime.now(timezone.utc).isoformat()
    c_url = creator_url or CREATOR_URL_MAP.get(norm_channel, "https://creator.xiaohongshu.com/publish/publish?source=official" if norm_channel == "XIAOHONGSHU" else "https://zhuanlan.zhihu.com/write")
    
    if not checklist:
        checklist = [
            f"1. 确认登录 {norm_channel} 官方创作者账号",
            "2. 检查标题无错漏与错别字",
            "3. 核对正文排版及分段换行",
            "4. 按照编号顺序上传素材配图",
            "5. 填入相关话题标签以增加曝光",
            "6. 预览确认无误后点击发布",
            "7. 在 GeoLens 控制台回填发布落地链接"
        ]

    # 处理素材图片并检测真实完整性 (不允许以空文件替代素材)
    image_manifest: list[str] = []
    download_failures: list[str] = []
    image_entries: list[tuple[str, bytes]] = []

    for i, item in enumerate(media_items):
        local_p = item.get("local_path") if isinstance(item, dict) else getattr(item, "local_path", None)
        item_url = (item.get("url") if isinstance(item, dict) else getattr(item, "url", "")) or ""
        item_type = (item.get("type") if isinstance(item, dict) else getattr(item, "type", "IMAGE")) or "IMAGE"

        # 1. 优先检查本地路径
        if local_p and Path(local_p).exists():
            src_path = Path(local_p)
            fsize = src_path.stat().st_size
            if fsize > 0:
                ext = src_path.suffix or ".png"
                target_name = f"images/{i+1:02d}_{src_path.stem}{ext}"
                try:
                    file_bytes = src_path.read_bytes()
                    image_entries.append((target_name, file_bytes))
                    image_manifest.append(f"{i+1:02d}: {target_name} (Source: 本地文件 {src_path.name}, 大小: {fsize} bytes)")
                    continue
                except Exception as e:
                    download_failures.append(f"{i+1:02d}: 读取本地文件异常: {local_p} ({e})")
            else:
                download_failures.append(f"{i+1:02d}: 本地文件为空文件 (0 bytes)，已拒绝打包: {local_p}")
                continue

        # 2. 检查 file:// 协议本地 URL
        if item_url.startswith("file://"):
            fpath = item_url[7:]
            if fpath.startswith("/") and len(fpath) > 3 and fpath[2] == ":":
                fpath = fpath[1:]
            p = Path(fpath)
            if p.exists() and p.stat().st_size > 0:
                ext = p.suffix or ".png"
                target_name = f"images/{i+1:02d}_{p.stem}{ext}"
                file_bytes = p.read_bytes()
                image_entries.append((target_name, file_bytes))
                image_manifest.append(f"{i+1:02d}: {target_name} (Source: 本地 file:// {p.name}, 大小: {len(file_bytes)} bytes)")
                continue
            else:
                download_failures.append(f"{i+1:02d}: file:// 路径文件不存在或为空: {item_url}")
                continue

        # 3. 检查 HTTP/HTTPS 远程素材并执行真实下载
        if item_url.startswith(("http://", "https://")):
            content_bytes, ext, err = download_remote_asset(item_url, timeout=15)
            if content_bytes and len(content_bytes) > 0:
                target_name = f"images/{i+1:02d}_image{ext}"
                image_entries.append((target_name, content_bytes))
                image_manifest.append(f"{i+1:02d}: {target_name} (Source: 远程下载 {item_url}, 大小: {len(content_bytes)} bytes)")
                continue
            else:
                download_failures.append(f"{i+1:02d}: 远程素材下载失败 URL={item_url} (错误原因: {err or '内容为空'})")
                continue

        # 4. 无有效路径或 URL
        download_failures.append(f"{i+1:02d}: 素材缺少合法路径或 URL (URL={item_url}, LocalPath={local_p})")

    asset_integrity = "COMPLETE" if not download_failures else ("PARTIAL_FAILURES" if image_entries else "ALL_FAILED")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        # 1. README.md
        readme_lines = [
            f"# GeoLens 人工发布辅助包 - {norm_channel}",
            f"",
            f"- 生成时间: `{now_str}`",
            f"- 目标平台: **{norm_channel}**",
            f"- 官方创作后台链接: [{c_url}]({c_url})",
            f"- 素材完整性状态: **{asset_integrity}** (成功: {len(image_entries)} / 计划: {len(media_items)})",
            f"",
            f"---",
            f"",
            f"## 一、发布核对清单 (Checklist)",
            f"",
        ]
        for c in checklist:
            readme_lines.append(f"- [ ] {c}")

        readme_lines.extend([
            f"",
            f"## 二、文章/笔记标题",
            f"",
            f"```text",
            f"{title}",
            f"```",
            f"",
            f"## 三、正文描述预览",
            f"",
            f"```markdown",
            f"{body}",
            f"```",
            f"",
            f"## 四、话题标签",
            f"",
            f"{' '.join(['#' + t.replace('#', '') for t in tags]) if tags else '无'}",
            f"",
            f"## 五、配图与素材 (已按序号排布在 images/ 目录下)",
            f"",
        ])

        if download_failures:
            readme_lines.extend([
                f"> [!WARNING] 素材下载异常警告",
                f"> 以下 {len(download_failures)} 个素材未能成功下载或不存在，禁止以空文件替代：",
            ])
            for df in download_failures:
                readme_lines.append(f"> - {df}")
            readme_lines.append("")
        else:
            readme_lines.append(f"共有 {len(image_entries)} 个素材，已全部按发布顺序保存在 `images/` 目录下并通过非空及大小校验。\n")

        readme_lines.extend([
            f"## 六、操作指引",
            f"",
            f"{instructions or '在受控浏览器打开官方创作页面后，请直接复制上方标题、正文与配图至对应输入区。核对无误后点击发布，并将最终公开地址回填至 GeoLens 控制台。'}",
        ])
        zf.writestr("README.md", "\n".join(readme_lines))

        # 2. content.txt
        zf.writestr("content.txt", body)

        # 3. metadata.json
        meta_dict = {
            "channel": norm_channel,
            "title": title,
            "body_length": len(body),
            "hashtags": tags,
            "creator_url": c_url,
            "checklist": checklist,
            "generated_at": now_str,
            "media_count": len(media_items),
            "packed_media_count": len(image_entries),
            "asset_integrity": asset_integrity,
            "download_failures": download_failures,
        }
        zf.writestr("metadata.json", json.dumps(meta_dict, ensure_ascii=False, indent=2))

        # 4. 写入真实素材图片 (绝对不创建 0 字节虚假文件)
        for target_name, file_bytes in image_entries:
            zf.writestr(target_name, file_bytes)

        # 5. 写入清单与失败日志
        if image_manifest:
            zf.writestr("images/image_manifest.txt", "\n".join(image_manifest))
        if download_failures:
            zf.writestr("images/DOWNLOAD_FAILURES.txt", "\n".join(download_failures))

    zip_buffer.seek(0)
    return zip_buffer


@app.get("/api/tasks/{task_id}/download-package", dependencies=[Depends(require_auth)])
async def download_task_manual_package(task_id: str):
    """下载特定发布任务的完整人工发布包 ZIP"""
    state = task_manager.get_task(task_id)
    if not state or not state.manual_package:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务或发布包不存在")

    pkg = state.manual_package
    buf = generate_package_zip_stream(
        channel=pkg.channel,
        title=pkg.title,
        body=pkg.body,
        tags=pkg.hashtags,
        media_items=pkg.media_items,
        checklist=pkg.checklist,
        creator_url=pkg.creator_url,
        instructions=pkg.instructions,
        generated_at=pkg.generated_at
    )
    filename = f"{pkg.channel.lower()}_manual_package_{task_id[:8]}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/package/export-zip", dependencies=[Depends(require_auth)])
async def export_package_zip(req: ExportPackageZipRequest):
    """直接根据草稿参数生成并下载人工发布包 ZIP（无需提前创建异步任务）"""
    buf = generate_package_zip_stream(
        channel=req.channel,
        title=req.title,
        body=req.body,
        tags=req.tags,
        media_items=req.media_items
    )
    filename = f"{req.channel.lower()}_manual_package.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

