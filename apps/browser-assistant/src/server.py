"""
GeoLens 本地浏览器助手 - FastAPI 服务端入口
提供受控 Localhost HTTP 接口，严格实施 Origin 白名单和本地配对令牌鉴权
"""
from pathlib import Path
from fastapi import FastAPI, Request, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

from .config import settings, BASE_DIR
from .security import (
    CURRENT_TOKEN, verify_origin, verify_request_auth
)
from .models import (
    CreatePublishTaskRequest, ConfirmPublishRequest, TaskStatusResponse
)
from .browser_manager import browser_manager
from .adapters.registry import registry
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


@app.post("/api/browser/check-login", dependencies=[Depends(require_auth)])
async def check_platform_login(payload: dict):
    channel = payload.get("channel", "ZHIHU")
    account_id = payload.get("account_id", "default")
    if not browser_manager.is_driver_running(channel, account_id):
        # 自动启动受控浏览器
        browser_manager.get_or_create_driver(channel, account_id, headless=False)
    driver = browser_manager.get_or_create_driver(channel, account_id)
    publisher = registry.get_publisher(channel, driver)
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


@app.post("/api/tasks/{task_id}/confirm", dependencies=[Depends(require_auth)])
async def confirm_publish_result(task_id: str, payload: ConfirmPublishRequest):
    """
    人工或自动化读取真实发布落地结果后确认
    只有具备可信公开链接或平台内容 ID 方可置为 PUBLISHED
    """
    ok, msg = task_manager.confirm_publish_result(
        task_id=task_id,
        canonical_url=payload.canonical_url,
        external_asset_id=payload.external_asset_id
    )
    if not ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg)
    state = task_manager.get_task(task_id)
    return {
        "success": True,
        "status": state.status if state else "PUBLISHED",
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
        task_manager.confirm_publish_result(task_id, data["canonical_url"], data.get("external_asset_id"))
        return {
            "success": True,
            "status": "PUBLISHED",
            "published_url": data["canonical_url"],
            "external_asset_id": data.get("external_asset_id")
        }
    return {"success": False, "message": msg}
