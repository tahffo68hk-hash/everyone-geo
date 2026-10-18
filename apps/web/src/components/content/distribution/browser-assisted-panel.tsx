"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  assistantClient,
  type AssistantHealth,
  type TaskStatusResponse,
  type StepLogItem,
  type ValidationDiff,
  type AssistantManualPackage,
} from "@/lib/assistant-api";
import {
  confirmManualPublished,
  getAssistantPairingInfo,
  channelLimitViolations,
  type DistributionChannel,
  type PublicationListItem,
} from "@/lib/distribution-api";
import type { Draft } from "@/lib/content-api";

interface BrowserAssistedPanelProps {
  projectId: string;
  selectedDraft: Draft | null;
  channels: DistributionChannel[];
  activeChannelKey: string;
  onChannelSelect: (ch: string) => void;
  onPublicationUpdated?: () => void;
}

export function BrowserAssistedPanel({
  projectId,
  selectedDraft,
  channels,
  activeChannelKey,
  onChannelSelect,
  onPublicationUpdated,
}: BrowserAssistedPanelProps) {
  // 助手与浏览器状态
  const [assistantOnline, setAssistantOnline] = useState<boolean | null>(null);
  const [assistantPort, setAssistantPort] = useState<number>(8765);
  const [pairingToken, setPairingToken] = useState<string>("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [browserRunning, setBrowserRunning] = useState(false);
  const [loginChecked, setLoginChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");
  const [checkingLogin, setCheckingLogin] = useState(false);
  const [openingLogin, setOpeningLogin] = useState(false);
  const [loginPollingActive, setLoginPollingActive] = useState(false);
  const loginPollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (loginPollTimerRef.current) {
        clearInterval(loginPollTimerRef.current);
      }
    };
  }, []);

  // 任务执行状态
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskState, setTaskState] = useState<TaskStatusResponse | null>(null);
  const [executing, setExecuting] = useState(false);
  const [pollingLogs, setPollingLogs] = useState(false);

  // 编辑区内容 (可微调标题/正文/标签)
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInputText, setTagInputText] = useState("");

  // 素材配图管理 (支持顺序调整与编号，小红书支持 1-9 张图，首图为封面)
  const [mediaItems, setMediaItems] = useState<
    Array<{
      index: number;
      type: string;
      url: string;
      local_path?: string | null;
      mime_type?: string;
      notes?: string | null;
    }>
  >([]);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [showAddMediaInput, setShowAddMediaInput] = useState(false);
  const [customMediaPath, setCustomMediaPath] = useState("");
  const [customMediaType, setCustomMediaType] = useState<"VIDEO" | "IMAGE" | "COVER">("VIDEO");

  // 人工接管与发布包
  const [manualTakeoverMode, setManualTakeoverMode] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // 最终发布回填确认 Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [backfillUrl, setBackfillUrl] = useState("");
  const [backfillAssetId, setBackfillAssetId] = useState("");
  const [backfillNote, setBackfillNote] = useState("人工在受控 Chrome 核对无误并自主发布，确认公开落地链接");
  const [backfillStatus, setBackfillStatus] = useState<"PUBLISHED" | "PENDING_REVIEW">("PUBLISHED");
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmSuccess, setConfirmSuccess] = useState<string | null>(null);

  // 当前渠道配置
  const activeChannel = channels.find((c) => c.channel === activeChannelKey) || channels[0];
  const isVideoChannel = Boolean(activeChannel?.requiresVideo || ["BILIBILI", "DOUYIN", "WECHAT_CHANNELS", "KUAISHOU"].includes(activeChannelKey));

  // 开发调试模式：仅在本地研发或附带 ?dev 参数时暴露测试素材注入按钮，生产正式用户界面严格隐藏
  const isDevMode = typeof window !== "undefined" && (
    process.env.NODE_ENV === "development" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    new URLSearchParams(window.location.search).has("dev")
  );

  // 同步草稿内容到编辑态与配图列表
  useEffect(() => {
    if (selectedDraft) {
      setEditTitle(selectedDraft.title || "");
      const latestRev = selectedDraft.revisions?.[0];
      setEditBody(latestRev?.body || "");
      const rawTags = (latestRev as any)?.tags || [];
      setEditTags(Array.isArray(rawTags) ? rawTags : []);

      // 初始化素材图片
      const draftAssets = (selectedDraft as any)?.assets || (selectedDraft as any)?.media_items || [];
      if (Array.isArray(draftAssets) && draftAssets.length > 0) {
        setMediaItems(
          draftAssets.map((a: any, idx: number) => ({
            index: idx + 1,
            type: a.type || "IMAGE",
            url: a.url || a.previewUrl || `https://assets.geolens.local/images/${selectedDraft.id}/${idx + 1}.png`,
            local_path: a.local_path || null,
            notes: a.notes || (idx === 0 ? "封面首图" : `配图 ${idx + 1}`),
          }))
        );
      } else {
        // 正式用户由草稿或本地真实文件指定素材，不自动塞入假素材
        setMediaItems([]);
      }
    }
  }, [selectedDraft]);

  // 页面加载时自动探测本地助手与配对令牌
  useEffect(() => {
    let unmounted = false;

    async function probeAssistant() {
      setConnecting(true);
      setConnectError(null);
      try {
        // 先从本地 API 获取配对凭据
        const pairInfo = await getAssistantPairingInfo().catch(() => null);
        if (pairInfo?.token) {
          assistantClient.setToken(pairInfo.token);
          setPairingToken(pairInfo.token);
        }
        if (pairInfo?.port) {
          setAssistantPort(pairInfo.port);
          assistantClient.setBaseUrl(`http://127.0.0.1:${pairInfo.port}`);
        }

        const health = await assistantClient.checkHealth();
        if (!unmounted && health?.status === "ok") {
          setAssistantOnline(true);
        }
      } catch (err: any) {
        if (!unmounted) {
          setAssistantOnline(false);
          setConnectError("本地受控浏览器发布助手未连接。受控 Chrome 需在您的桌面运行以便您亲自审核与发布。请在项目根目录运行 START_ASSISTANT.cmd 启动服务。");
        }
      } finally {
        if (!unmounted) setConnecting(false);
      }
    }

    probeAssistant();
    return () => {
      unmounted = true;
    };
  }, []);

  // 定时轮询任务状态
  useEffect(() => {
    if (!currentTaskId || !assistantOnline) return;

    let timer: NodeJS.Timeout;
    let cancelled = false;

    async function poll() {
      try {
        const resp = await assistantClient.getTask(currentTaskId!);
        if (cancelled) return;
        setTaskState(resp);
        setBrowserRunning(resp.browser_running);
        if (resp.is_manual_takeover) {
          setManualTakeoverMode(true);
        }

        // 终态或需人工最终审核时停止自动轮询 executing 状态
        if (["PUBLISHED", "FAILED", "AWAITING_CONFIRMATION", "MANUAL_REQUIRED"].includes(resp.status)) {
          setExecuting(false);
        } else if (resp.status === "WAITING_FOR_LOGIN" || resp.status === "PENDING_ACCOUNT_AUTH") {
          // 正在等待创作者扫码授权：继续轮询以在扫码完成后自动推进流水线
          setExecuting(true);
          timer = setTimeout(poll, 1500);
        } else {
          timer = setTimeout(poll, 1000);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, 2000);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTaskId, assistantOnline]);

  // 手动测试重连
  async function handleReconnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      assistantClient.setBaseUrl(`http://127.0.0.1:${assistantPort}`);
      if (pairingToken) assistantClient.setToken(pairingToken);
      const health = await assistantClient.checkHealth();
      if (health?.status === "ok") {
        setAssistantOnline(true);
      }
    } catch (e: any) {
      setAssistantOnline(false);
      setConnectError(`连接失败：${e.message}。请确认本地助手已在端口 ${assistantPort} 启动。`);
    } finally {
      setConnecting(false);
    }
  }

  // 启动浏览器
  async function handleLaunchBrowser() {
    if (!activeChannelKey) return;
    if (assistantOnline === false) {
      alert("本地浏览器助手未连接！受控 Chrome 必须由本地助手唤起才能在您的桌面显示。\n\n请在项目根目录运行 START_ASSISTANT.cmd 启动服务后再试。");
      return;
    }
    try {
      const res = await assistantClient.launchBrowser(activeChannelKey, "default", false);
      setBrowserRunning(true);
      handleCheckLogin();
    } catch (e: any) {
      alert(`调起浏览器失败：${e.message}`);
    }
  }

  // 关闭浏览器
  async function handleCloseBrowser() {
    try {
      await assistantClient.closeBrowser(activeChannelKey, "default");
      setBrowserRunning(false);
    } catch (e: any) {
      alert(`关闭浏览器失败：${e.message}`);
    }
  }

  // 检查登录态
  async function handleCheckLogin() {
    setCheckingLogin(true);
    try {
      const res = await assistantClient.checkLogin(activeChannelKey, "default");
      setLoginChecked(true);
      setIsLoggedIn(res.is_logged_in);
      setLoginMsg(res.message);
      setBrowserRunning(true);
    } catch (e: any) {
      setLoginChecked(true);
      setIsLoggedIn(false);
      setLoginMsg(`检测失败：${e.message}`);
    } finally {
      setCheckingLogin(false);
    }
  }

  // 调起受控 Chrome 打开官方登录/扫码页并自动监听扫码状态
  async function handleOpenLoginPage() {
    if (!activeChannelKey) return;
    if (loginPollTimerRef.current) {
      clearInterval(loginPollTimerRef.current);
      loginPollTimerRef.current = null;
    }
    setOpeningLogin(true);
    setConnectError(null);
    try {
      const res = await assistantClient.openLoginPage(activeChannelKey, "default");
      setBrowserRunning(true);
      setLoginMsg(res.message || "已调起官方创作者扫码登录页面，请在受控 Chrome 窗口中完成扫码");

      // 开启自动轮询登录状态（每 2.5 秒检测一次，最多持续 60 秒）
      setLoginPollingActive(true);
      let attempts = 0;
      const maxAttempts = 24; // ~60s
      loginPollTimerRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const checkRes = await assistantClient.checkLogin(activeChannelKey, "default");
          if (checkRes.is_logged_in) {
            setIsLoggedIn(true);
            setLoginChecked(true);
            setLoginMsg(checkRes.message || "检测到登录成功！");
            if (loginPollTimerRef.current) {
              clearInterval(loginPollTimerRef.current);
              loginPollTimerRef.current = null;
            }
            setLoginPollingActive(false);
          } else if (attempts >= maxAttempts) {
            if (loginPollTimerRef.current) {
              clearInterval(loginPollTimerRef.current);
              loginPollTimerRef.current = null;
            }
            setLoginPollingActive(false);
            setLoginMsg("扫码等待已超时。若已扫码完成，请点击【检查登录】刷新状态");
          }
        } catch {
          if (attempts >= maxAttempts) {
            if (loginPollTimerRef.current) {
              clearInterval(loginPollTimerRef.current);
              loginPollTimerRef.current = null;
            }
            setLoginPollingActive(false);
          }
        }
      }, 2500);
    } catch (e: any) {
      alert(`调起扫码登录失败：${e.message}。请确保本地助手已启动。`);
    } finally {
      setOpeningLogin(false);
    }
  }

  // 清除本地 Profile 重置会话
  async function handleClearProfile() {
    if (!confirm(`确定要清理 ${activeChannel?.name || activeChannelKey} 的本地登录会话并重新登录吗？`)) return;
    try {
      await assistantClient.clearProfile(activeChannelKey, "default");
      setBrowserRunning(false);
      setIsLoggedIn(false);
      setLoginChecked(false);
      setLoginMsg("本地会话已清除");
    } catch (e: any) {
      alert(`清理失败：${e.message}`);
    }
  }

  // 启动自动化发布任务
  async function handleStartPublishTask() {
    if (!selectedDraft) {
      alert("请先在左侧选择需要发布的草稿内容");
      return;
    }
    if (assistantOnline === false) {
      alert("本地浏览器助手未连接！受控 Chrome 必须由本地助手唤起才能在您的桌面显示。\n\n请在项目根目录运行 START_ASSISTANT.cmd 启动服务后再试。");
      return;
    }
    const taskId = `geo-task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCurrentTaskId(taskId);
    setExecuting(true);
    setManualTakeoverMode(false);
    setConfirmSuccess(null);

    try {
      const resp = await assistantClient.startTask({
        task_id: taskId,
        channel: activeChannelKey,
        account_id: "default",
        title: editTitle,
        body: editBody,
        tags: editTags,
        media_items: mediaItems,
        source_draft_id: selectedDraft.id,
        source_revision_id: selectedDraft.revisions?.[0]?.id,
        headless: false, // 保证用户桌面可见受控 Chrome 窗口
      });
      setTaskState(resp);
      setBrowserRunning(true);
    } catch (e: any) {
      setExecuting(false);
      alert(`发起发布任务失败：${e.message}`);
    }
  }

  // 一键载入本地真实测试素材 (可解码 MP4 视频与高清封面)
  function handleLoadTestFixtures() {
    const videoFixturePath = "D:\\dev\\geo-platform\\apps\\browser-assistant\\tests\\fixtures\\sample_test_video.mp4";
    const coverFixturePath = "D:\\dev\\geo-platform\\apps\\browser-assistant\\tests\\fixtures\\sample_test_cover.jpg";

    if (isVideoChannel) {
      setMediaItems([
        {
          index: 1,
          type: "VIDEO",
          url: "file:///D:/dev/geo-platform/apps/browser-assistant/tests/fixtures/sample_test_video.mp4",
          local_path: videoFixturePath,
          notes: "测试成片 (H.264 / 1080p 标准 MP4)",
        },
        {
          index: 2,
          type: "COVER",
          url: "file:///D:/dev/geo-platform/apps/browser-assistant/tests/fixtures/sample_test_cover.jpg",
          local_path: coverFixturePath,
          notes: "视频横版封面 (16:9 / 1080p JPG)",
        },
      ]);
      setCopyFeedback("已一键载入本地测试成片与封面 (sample_test_video.mp4, sample_test_cover.jpg)！");
    } else {
      setMediaItems([
        {
          index: 1,
          type: "COVER",
          url: "file:///D:/dev/geo-platform/apps/browser-assistant/tests/fixtures/sample_test_cover.jpg",
          local_path: coverFixturePath,
          notes: "测试封面首图 (高清 JPG)",
        },
        {
          index: 2,
          type: "IMAGE",
          url: "file:///D:/dev/geo-platform/apps/browser-assistant/tests/fixtures/sample_test_cover.jpg",
          local_path: coverFixturePath,
          notes: "测试插图 2 (高清 JPG)",
        },
      ]);
      setCopyFeedback("已一键载入本地测试配图 (sample_test_cover.jpg)！");
    }
  }

  // 下载完整人工发布包 (ZIP)
  async function handleDownloadPackageZip() {
    setDownloadingZip(true);
    try {
      let blob: Blob;
      if (currentTaskId && taskState?.manual_package) {
        blob = await assistantClient.downloadTaskPackageZip(currentTaskId);
      } else {
        blob = await assistantClient.exportPackageZip({
          channel: activeChannelKey,
          title: editTitle,
          body: editBody,
          tags: editTags,
          media_items: mediaItems,
        });
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeChannelKey.toLowerCase()}_manual_package_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setCopyFeedback("已成功生成并下载完整人工发布包 (ZIP)！包含 README.md、content.txt、metadata.json 及编号素材");
    } catch (err: any) {
      alert(`下载发布包失败: ${err.message}`);
    } finally {
      setDownloadingZip(false);
    }
  }

  // 暂停任务
  async function handlePauseTask() {
    if (!currentTaskId) return;
    try {
      await assistantClient.pauseTask(currentTaskId);
    } catch (e: any) {
      alert(`暂停失败：${e.message}`);
    }
  }

  // 恢复任务
  async function handleResumeTask() {
    if (!currentTaskId) return;
    try {
      await assistantClient.resumeTask(currentTaskId);
    } catch (e: any) {
      alert(`恢复失败：${e.message}`);
    }
  }

  // 取消任务
  async function handleCancelTask() {
    if (!currentTaskId) return;
    if (!confirm("确定要取消本次自动化发布流程吗？")) return;
    try {
      await assistantClient.cancelTask(currentTaskId);
      setExecuting(false);
    } catch (e: any) {
      alert(`取消失败：${e.message}`);
    }
  }

  // 人工接管
  async function handleManualTakeover() {
    if (!currentTaskId) {
      setManualTakeoverMode(true);
      return;
    }
    try {
      await assistantClient.manualTakeover(currentTaskId);
      setManualTakeoverMode(true);
      setExecuting(false);
    } catch (e: any) {
      alert(`切换人工接管失败：${e.message}`);
    }
  }

  // 复制文本辅助
  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopyFeedback(`已复制${label}`);
    setTimeout(() => setCopyFeedback(null), 2500);
  }

  // 提交人工回填确认 (创建真实 PublishedAsset 或登记 PENDING_REVIEW)
  async function handleSubmitConfirmBackfill() {
    if (!backfillUrl.trim() && !backfillAssetId.trim()) {
      setConfirmError("必须填写文章落地链接 (URL) 或平台文章 ID");
      return;
    }
    if (!backfillNote.trim()) {
      setConfirmError("必须填写明确的人工核验说明 (verificationNote) 以保证审计真实性");
      return;
    }

    const cLow = backfillUrl.trim().toLowerCase();
    if (cLow) {
      if (cLow.includes("mock://") || cLow.includes("fake://") || cLow.includes("example.com/mock") || cLow.includes("fake_")) {
        setConfirmError("禁止使用虚假/Mock 外部链接作为发布凭证");
        return;
      }
      if (activeChannelKey !== "SIMULATION" && (cLow.includes("localhost") || cLow.includes("127.0.0.1") || cLow.includes("0.0.0.0"))) {
        setConfirmError("真实平台发布凭证禁止使用 localhost 或本地回环地址");
        return;
      }
      if (activeChannelKey === "XIAOHONGSHU" && !cLow.includes("xiaohongshu.com") && !cLow.includes("xhslink.com")) {
        setConfirmError("小红书发布落地链接必须包含 xiaohongshu.com 或 xhslink.com 域名");
        return;
      }
      if (activeChannelKey === "ZHIHU" && !cLow.includes("zhihu.com")) {
        setConfirmError("知乎专栏发布链接必须包含 zhihu.com 域名");
        return;
      }
      if (activeChannelKey === "BILIBILI" && !cLow.includes("bilibili.com") && !cLow.includes("b23.tv")) {
        setConfirmError("B站发布链接必须包含 bilibili.com 或 b23.tv 域名");
        return;
      }
      if (activeChannelKey === "DOUYIN" && !cLow.includes("douyin.com") && !cLow.includes("iesdouyin.com")) {
        setConfirmError("抖音发布链接必须包含 douyin.com 或 iesdouyin.com 域名");
        return;
      }
      if (activeChannelKey === "WECHAT_CHANNELS" && !cLow.includes("weixin.qq.com") && !cLow.includes("qq.com")) {
        setConfirmError("微信视频号发布链接必须包含 weixin.qq.com 或 qq.com 域名");
        return;
      }
      if (activeChannelKey === "KUAISHOU" && !cLow.includes("kuaishou.com") && !cLow.includes("kwai.com")) {
        setConfirmError("快手发布链接必须包含 kuaishou.com 或 kwai.com 域名");
        return;
      }
      if (activeChannelKey === "WEIBO" && !cLow.includes("weibo.com") && !cLow.includes("weibo.cn")) {
        setConfirmError("微博发布链接必须包含 weibo.com 或 weibo.cn 域名");
        return;
      }
      if (activeChannelKey === "BAIJIAHAO" && !cLow.includes("baidu.com")) {
        setConfirmError("百家号发布链接必须包含 baidu.com 域名");
        return;
      }
      if (activeChannelKey === "WECHAT_OFFICIAL_ACCOUNT" && !cLow.includes("mp.weixin.qq.com") && !cLow.includes("weixin.qq.com") && !cLow.includes("qq.com")) {
        setConfirmError("微信公众号发布链接必须包含 weixin.qq.com 或 qq.com 域名");
        return;
      }
      if (activeChannelKey === "TOUTIAO" && !cLow.includes("toutiao.com")) {
        setConfirmError("今日头条发布链接必须包含 toutiao.com 域名");
        return;
      }
    }

    setConfirmSubmitting(true);
    setConfirmError(null);
    try {
      if (currentTaskId) {
        // 在本地助手记录终态
        await assistantClient.confirmPublish(currentTaskId, {
          canonicalUrl: backfillUrl.trim() || undefined,
          externalAssetId: backfillAssetId.trim() || undefined,
          verificationNote: backfillNote.trim(),
          status: backfillStatus,
        });
      }

      setShowConfirmModal(false);
      const statusLabel = backfillStatus === "PUBLISHED" ? "已确认公开发布 (PUBLISHED)" : "已登记平台审核中 (PENDING_REVIEW)";
      setConfirmSuccess(`发布确认成功！状态：${statusLabel}，落地链接：${backfillUrl || backfillAssetId}`);
      if (onPublicationUpdated) onPublicationUpdated();
    } catch (e: any) {
      setConfirmError(`确认失败：${e.message}`);
    } finally {
      setConfirmSubmitting(false);
    }
  }

  // 限制校验
  const violations = channelLimitViolations(activeChannel?.limits, {
    title: editTitle,
    body: editBody,
    tags: editTags,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* 顶部：助手健康与连接状态条 */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3">
          <div
            className={`w-3.5 h-3.5 rounded-full ${
              assistantOnline === true
                ? "bg-emerald-500 ring-4 ring-emerald-100"
                : assistantOnline === false
                ? "bg-rose-500 ring-4 ring-rose-100"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800 text-sm">本地浏览器发布助手</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                  assistantOnline === true
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}
              >
                {assistantOnline === true ? "127.0.0.1:8765 已连接" : "未连接"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              受控 ChromeDriver 本地运行 · 独立 Profile 隔离 · 凭据不出域
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {assistantOnline === false && (
            <button
              type="button"
              onClick={handleReconnect}
              disabled={connecting}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition"
            >
              {connecting ? "探测中..." : "重新探测"}
            </button>
          )}

          <button
            type="button"
            onClick={handleClearProfile}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
            title="清理本地独立 Profile 缓存（重置登录态）"
          >
            清理本地会话
          </button>
        </div>
      </div>

      {connectError && (
        <div className="p-3.5 text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-2.5 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{connectError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-[11px] bg-amber-100/80 text-amber-900 border border-amber-300/60 px-2.5 py-1 rounded-md font-semibold select-all">
              START_ASSISTANT.cmd
            </span>
            <button
              type="button"
              onClick={handleReconnect}
              disabled={connecting}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-medium transition"
            >
              {connecting ? "探测中..." : "重新探测"}
            </button>
          </div>
        </div>
      )}

      {/* 平台选择矩阵 */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {channels.map((ch) => {
          const isActive = ch.channel === activeChannelKey;
          const isVideo = ch.requiresVideo || ["BILIBILI", "DOUYIN", "WECHAT_CHANNELS", "KUAISHOU"].includes(ch.channel);
          return (
            <button
              key={ch.channel}
              type="button"
              onClick={() => onChannelSelect(ch.channel)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${
                isActive
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span>{ch.name}</span>
              {isVideo ? (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                    isActive ? "bg-purple-500 text-white" : "bg-purple-50 text-purple-700 border border-purple-200"
                  }`}
                >
                  视频 · 人工确认
                </span>
              ) : (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                    isActive ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-600 border border-slate-200"
                  }`}
                >
                  {ch.channel === "XIAOHONGSHU" ? "笔记 · 人工确认" : "图文 · 人工确认"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 主体两栏布局：左侧内容预览与编辑，右侧账号/发布状态与控制 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左栏：内容检查与微调 (7 列) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 text-sm">发布内容预览与校验</span>
                <span className="text-xs text-slate-500">({activeChannel?.name || activeChannelKey})</span>
              </div>
              {selectedDraft && (
                <span className="text-xs text-slate-400 font-mono">Draft: {selectedDraft.id.slice(0, 8)}</span>
              )}
            </div>

            {/* 违规报警 */}
            {violations.length > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs flex flex-col gap-1">
                <span className="font-semibold">⚠️ 超出目标平台字数或限制：</span>
                <ul className="list-disc list-inside">
                  {violations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 标题 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2">
                  <label className="font-semibold text-slate-700">
                    {activeChannelKey === "XIAOHONGSHU" ? "笔记标题 (限 20 字)" : "文章标题"}
                  </label>
                  {activeChannelKey === "XIAOHONGSHU" && editTitle.length > 20 && (
                    <button
                      type="button"
                      onClick={() => setEditTitle(editTitle.slice(0, 20))}
                      className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-medium transition"
                    >
                      按 20 字截断
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono ${
                      (activeChannel?.limits?.title && editTitle.length > activeChannel.limits.title) ||
                      (activeChannelKey === "XIAOHONGSHU" && editTitle.length > 20)
                        ? "text-rose-600 font-bold"
                        : "text-slate-400"
                    }`}
                  >
                    {editTitle.length} {activeChannelKey === "XIAOHONGSHU" ? "/ 20" : activeChannel?.limits?.title ? `/ ${activeChannel.limits.title}` : ""} 字
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(editTitle, "标题")}
                    className="text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    一键复制
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={activeChannelKey === "XIAOHONGSHU" ? "请输入小红书笔记标题 (建议醒目、痛点突出，限 20 字)..." : "请输入文章标题..."}
                maxLength={activeChannelKey === "XIAOHONGSHU" ? 30 : undefined}
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium text-slate-900"
              />
            </div>

            {/* 正文 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs">
                <label className="font-semibold text-slate-700">正文内容 (富文本)</label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono">{editBody.length} 字</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(editBody, "正文")}
                    className="text-blue-600 hover:text-blue-700 hover:underline"
                  >
                    一键复制
                  </button>
                </div>
              </div>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={10}
                placeholder="文章正文..."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 text-sm font-normal text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 font-sans resize-y"
              />
            </div>

            {/* 话题标签 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center text-xs">
                <label className="font-semibold text-slate-700">话题标签</label>
                <button
                  type="button"
                  onClick={() => copyToClipboard(editTags.map((t) => `#${t.replace(/#/g, "")}`).join(" "), "话题标签")}
                  className="text-blue-600 hover:text-blue-700 hover:underline"
                >
                  一键复制标签
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 p-2 border border-slate-200 rounded-lg min-h-[42px] bg-slate-50/50">
                {editTags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium border border-blue-200"
                  >
                    #{tag.replace(/#/g, "")}
                    <button
                      type="button"
                      onClick={() => setEditTags(editTags.filter((_, i) => i !== idx))}
                      className="text-blue-400 hover:text-blue-700 font-bold ml-0.5"
                    >
                      &times;
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagInputText}
                  onChange={(e) => setTagInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && tagInputText.trim()) {
                      e.preventDefault();
                      const cleaned = tagInputText.trim().replace(/#/g, "");
                      if (cleaned && !editTags.includes(cleaned)) {
                        setEditTags([...editTags, cleaned]);
                      }
                      setTagInputText("");
                    }
                  }}
                  placeholder="输入话题按回车添加..."
                  className="flex-1 min-w-[120px] bg-transparent text-xs outline-none text-slate-800 px-1 py-0.5"
                />
              </div>
            </div>

            {/* 素材配图/视频成片列表 */}
            <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2">
                  <label className="font-semibold text-slate-700">
                    {isVideoChannel ? "视频成片与封面素材" : activeChannelKey === "XIAOHONGSHU" ? "小红书笔记配图 (1-9 张)" : "素材配图列表"}
                  </label>
                  <span className="text-[11px] text-slate-400">
                    共 {mediaItems.length} 个素材 · {isVideoChannel ? "受控Chrome优先上传成片" : "首图决定点击率"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isDevMode && (
                    <button
                      type="button"
                      onClick={handleLoadTestFixtures}
                      className="text-xs text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md border border-indigo-200 flex items-center gap-1 font-medium transition shadow-xs"
                      title="[开发测试模式专用] 一键载入本地可解码真实 MP4 视频与高清封面 (sample_test_video.mp4 / sample_test_cover.jpg)"
                    >
                      🧪 [Dev] 载入测试素材
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAddMediaInput(!showAddMediaInput)}
                    className="text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 font-medium"
                  >
                    {showAddMediaInput ? "收起输入" : isVideoChannel ? "＋ 添加本地成片/素材" : "＋ 添加本地素材"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPackageZip}
                    disabled={downloadingZip}
                    className="text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 font-medium"
                  >
                    {downloadingZip ? "打包中..." : "📦 下载完整人工发布包 (ZIP)"}
                  </button>
                </div>
              </div>

              {isVideoChannel && (
                <div className="p-2.5 rounded-lg bg-purple-50/80 border border-purple-200 text-purple-900 text-xs flex items-center gap-2 shadow-xs">
                  <span className="text-base shrink-0">🎥</span>
                  <span className="leading-snug">
                    <strong>视频发布说明：</strong>系统将在桌面受控 Chrome 中优先上传视频文件，并在视频解析后自动填写标题、简介与标签，PREPARE_ONLY 停留在最终发布页供作者审核。
                  </span>
                </div>
              )}

              {showAddMediaInput && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-2 text-xs animate-fade-in">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={customMediaType}
                      onChange={(e) => setCustomMediaType(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-xs text-slate-700"
                    >
                      <option value="VIDEO">🎬 视频成片 (VIDEO)</option>
                      <option value="COVER">🖼️ 封面图片 (COVER)</option>
                      <option value="IMAGE">🖼️ 插图/配图 (IMAGE)</option>
                    </select>
                    <input
                      type="text"
                      value={customMediaPath}
                      onChange={(e) => setCustomMediaPath(e.target.value)}
                      placeholder="输入本地视频或图片文件绝对路径 (如 D:\videos\demo.mp4 或 file://...)"
                      className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-mono text-xs text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!customMediaPath.trim()) return;
                        const trimmed = customMediaPath.trim();
                        const nextItem = {
                          index: mediaItems.length + 1,
                          type: customMediaType,
                          url: trimmed.startsWith("http") || trimmed.startsWith("file://") ? trimmed : `file:///${trimmed.replace(/\\/g, "/")}`,
                          local_path: trimmed.startsWith("file://") ? null : trimmed,
                          notes: customMediaType === "VIDEO" ? "本地成片视频" : customMediaType === "COVER" ? "指定封面图片" : `素材 ${mediaItems.length + 1}`,
                        };
                        setMediaItems([...mediaItems, nextItem]);
                        setCustomMediaPath("");
                        setShowAddMediaInput(false);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-xs transition"
                    >
                      确定添加
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    安全保证：本地素材由受控 Chrome 助手直接通过本地文件句柄载入，无需云端中转或 Base64 编码。
                  </p>
                </div>
              )}

              {mediaItems.length === 0 ? (
                <div className="p-3 text-xs bg-slate-50 border border-dashed border-slate-200 rounded-lg text-slate-500 text-center">
                  {isVideoChannel
                    ? "暂无视频素材。请点击上方【＋ 添加本地成片/素材】指定成片 .mp4 路径，或在草稿中挂载视频资产。"
                    : "暂无配图素材。笔记建议配置 1~9 张图片，启动受控浏览器后将按序辅助上传。"}
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {mediaItems.map((img, idx) => {
                    const isVideo = img.type === "VIDEO" || img.url.endsWith(".mp4") || img.url.endsWith(".mov");
                    return (
                      <div
                        key={idx}
                        className="group relative rounded-lg border border-slate-200 overflow-hidden bg-slate-50 aspect-[3/4] flex flex-col justify-between p-1.5 hover:shadow-md transition"
                      >
                        <div className="flex items-center justify-between z-10">
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                              isVideo
                                ? "bg-purple-600 text-white"
                                : idx === 0 || img.type === "COVER"
                                ? "bg-rose-500 text-white"
                                : "bg-black/60 text-white"
                            }`}
                          >
                            {isVideo ? "🎬 视频" : idx === 0 || img.type === "COVER" ? "封面 #1" : `#${idx + 1}`}
                          </span>
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition">
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = [...mediaItems];
                                  const temp = next[idx - 1];
                                  next[idx - 1] = next[idx];
                                  next[idx] = temp;
                                  setMediaItems(next);
                                }}
                                className="w-4 h-4 rounded bg-white text-slate-700 text-[10px] flex items-center justify-center shadow"
                                title="前移（调整展示顺序）"
                              >
                                ←
                              </button>
                            )}
                            {idx < mediaItems.length - 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const next = [...mediaItems];
                                  const temp = next[idx + 1];
                                  next[idx + 1] = next[idx];
                                  next[idx] = temp;
                                  setMediaItems(next);
                                }}
                                className="w-4 h-4 rounded bg-white text-slate-700 text-[10px] flex items-center justify-center shadow"
                                title="后移（调整展示顺序）"
                              >
                                →
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMediaItems(mediaItems.filter((_, i) => i !== idx));
                              }}
                              className="w-4 h-4 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] flex items-center justify-center shadow"
                              title="移除此素材"
                            >
                              &times;
                            </button>
                          </div>
                        </div>

                        {/* 图片背景或缩略图 */}
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 bg-slate-100 overflow-hidden">
                          {isVideo ? (
                            <div className="flex flex-col items-center justify-center gap-1 text-purple-700 p-2 text-center">
                              <span className="text-2xl">🎬</span>
                              <span className="text-[10px] font-mono break-all line-clamp-2">
                                {img.local_path ? img.local_path.split(/[\\/]/).pop() : "本地视频"}
                              </span>
                            </div>
                          ) : img.url.startsWith("http") ? (
                            <img
                              src={img.url}
                              alt={img.notes || `Image ${idx + 1}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <span>🖼️ 图 {idx + 1}</span>
                          )}
                        </div>

                        <div className="z-10 bg-black/60 backdrop-blur-xs text-white text-[9px] px-1 py-0.5 rounded truncate">
                          {img.notes || (isVideo ? "视频成片" : `配图 ${idx + 1}`)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 复制反馈 */}
            {copyFeedback && (
              <div className="text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-md font-medium border border-emerald-200 animate-fade-in">
                ✓ {copyFeedback}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：浏览器控制、登录检测与发布进度 (5 列) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* 账号与浏览器状态卡片 */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
            <h4 className="font-bold text-slate-800 text-sm border-b border-slate-100 pb-2">受控浏览器与账号状态</h4>

            {/* 浏览器运行状态 */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">浏览器进程：</span>
              <div className="flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 rounded font-medium ${
                    browserRunning
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {browserRunning ? "运行中" : "未启动"}
                </span>
                {browserRunning ? (
                  <button
                    type="button"
                    onClick={handleCloseBrowser}
                    className="text-rose-600 hover:underline font-medium"
                  >
                    断开
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleLaunchBrowser}
                    className="text-blue-600 hover:underline font-medium"
                  >
                    启动浏览器
                  </button>
                )}
              </div>
            </div>

            {/* 登录态检测 */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600">平台登录态：</span>
              <div className="flex items-center gap-2">
                {loginChecked ? (
                  <span
                    className={`px-2 py-0.5 rounded font-medium ${
                      isLoggedIn
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {isLoggedIn ? "已登录 (会话有效)" : "未登录 (需扫码)"}
                  </span>
                ) : (
                  <span className="text-slate-400">尚未检查</span>
                )}
                <button
                  type="button"
                  onClick={handleCheckLogin}
                  disabled={checkingLogin || loginPollingActive}
                  className="text-blue-600 hover:underline font-medium"
                >
                  {checkingLogin ? "检测中..." : "检查登录"}
                </button>
              </div>
            </div>

            {/* 扫码登录引导区 */}
            {!isLoggedIn && (
              <div className="p-2.5 bg-amber-50/80 border border-amber-200 rounded-lg flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-amber-900 flex items-center gap-1">
                    <span>📱</span>
                    <span>{activeChannel?.name || activeChannelKey} 创作者扫码</span>
                  </div>
                  {loginPollingActive && (
                    <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono animate-pulse">
                      正在检测扫码...
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-amber-800 leading-snug">
                  点击按钮将唤起受控 Chrome 并直接打开官方创作者登录页，使用对应手机 App 扫码即可完成持久化授权。
                </div>
                <button
                  type="button"
                  onClick={handleOpenLoginPage}
                  disabled={openingLogin || !assistantOnline}
                  className={`w-full py-2 rounded-md font-medium text-xs transition flex items-center justify-center gap-1.5 shadow-sm ${
                    loginPollingActive
                      ? "bg-amber-600 text-white animate-pulse"
                      : "bg-amber-600 hover:bg-amber-700 text-white"
                  }`}
                >
                  {openingLogin
                    ? "正在调起浏览器..."
                    : loginPollingActive
                    ? "⏳ 浏览器已就绪，等待手机扫码中..."
                    : "📱 调起浏览器扫码登录"}
                </button>
              </div>
            )}

            {isLoggedIn && (
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs text-emerald-800">
                <span className="flex items-center gap-1 font-medium">
                  <span>✅</span> 平台登录态持久化有效
                </span>
                <button
                  type="button"
                  onClick={handleOpenLoginPage}
                  className="text-xs text-emerald-700 hover:underline"
                  title="在受控 Chrome 打开创作者中心"
                >
                  打开创作者中心
                </button>
              </div>
            )}

            {loginMsg && (
              <div className="text-[11px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-200">
                💬 {loginMsg}
              </div>
            )}

            {/* 主操作按钮 */}
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleStartPublishTask}
                disabled={executing || violations.length > 0}
                className={`w-full py-2.5 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 shadow-sm ${
                  executing
                    ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                    : violations.length > 0
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {executing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>辅助填写执行中...</span>
                  </>
                ) : (
                  <span>开始辅助填写与双向校验 (PREPARE_ONLY)</span>
                )}
              </button>
              <p className="text-[10px] text-slate-400 text-center leading-normal">
                安全保障：自动填入内容并核对，停留在最终发布页供作者审核，绝不擅自越权点击发布
              </p>

              {/* 辅助控制按钮 */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleManualTakeover}
                  className="flex-1 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition"
                >
                  手动接管发布
                </button>
                {executing && (
                  <>
                    <button
                      type="button"
                      onClick={taskState?.is_paused ? handleResumeTask : handlePauseTask}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition"
                    >
                      {taskState?.is_paused ? "恢复" : "暂停"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelTask}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition"
                    >
                      取消
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 自动化流转进度与状态 */}
          {taskState && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-800 text-sm">操作进度跟踪</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    taskState.status === "PUBLISHED"
                      ? "bg-emerald-100 text-emerald-800"
                      : taskState.status === "AWAITING_CONFIRMATION"
                      ? "bg-sky-100 text-sky-800"
                      : taskState.status === "FAILED"
                      ? "bg-rose-100 text-rose-800"
                      : taskState.status === "MANUAL_REQUIRED"
                      ? "bg-amber-100 text-amber-800"
                      : taskState.status === "WAITING_FOR_LOGIN" || taskState.status === "PENDING_ACCOUNT_AUTH"
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-blue-50 text-blue-700"
                  }`}
                >
                  {taskState.status === "PENDING_ACCOUNT_AUTH"
                    ? "待账号授权 (PENDING_ACCOUNT_AUTH)"
                    : taskState.status === "WAITING_FOR_LOGIN"
                    ? "等待登录 (WAITING_FOR_LOGIN)"
                    : taskState.status}
                </span>
              </div>

              {/* 比对校验结果卡片 */}
              {taskState.validation && (
                <div
                  className={`p-3 rounded-lg border text-xs flex flex-col gap-1.5 ${
                    taskState.validation.passed
                      ? "bg-emerald-50/70 border-emerald-200 text-emerald-900"
                      : "bg-amber-50/70 border-amber-200 text-amber-900"
                  }`}
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    <span>{taskState.validation.passed ? "✓" : "⚠️"}</span>
                    <span>双向一致性比对结果：{taskState.validation.passed ? "完全一致" : "存在微调差异"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] opacity-90 font-mono">
                    <div>标题比对: {taskState.validation.title_match ? "✓ 匹配" : "✗ 不一致"}</div>
                    <div>正文字数: {taskState.validation.body_length_actual} / {taskState.validation.body_length_expected} 字</div>
                  </div>
                  {taskState.validation.discrepancies.length > 0 && (
                    <div className="text-[11px] text-amber-800 bg-amber-100/60 p-1.5 rounded mt-1">
                      {taskState.validation.discrepancies.join("；")}
                    </div>
                  )}
                </div>
              )}

              {/* 步骤日志时间线 */}
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                {taskState.steps.map((st, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0 mt-0.5 font-bold ${
                        st.status === "SUCCESS"
                          ? "bg-emerald-100 text-emerald-700"
                          : st.status === "FAILED"
                          ? "bg-rose-100 text-rose-700"
                          : st.status === "RUNNING"
                          ? "bg-blue-100 text-blue-700 animate-pulse"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {st.status === "SUCCESS" ? "✓" : st.status === "FAILED" ? "✗" : "•"}
                    </span>
                    <div className="flex-1 leading-snug">
                      <div className="flex items-center justify-between text-slate-700 font-medium">
                        <span>{st.name}</span>
                        {st.duration_ms && <span className="text-[10px] text-slate-400">{st.duration_ms}ms</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{st.message}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 等待创作者扫码登录提示 (PENDING_ACCOUNT_AUTH / WAITING_FOR_LOGIN) */}
              {(taskState.status === "WAITING_FOR_LOGIN" || taskState.status === "PENDING_ACCOUNT_AUTH") && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex flex-col gap-2.5">
                  <div className="font-semibold flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">🔑</span>
                      <span>等待创作者扫码登录 (PENDING_ACCOUNT_AUTH)</span>
                    </div>
                    <span className="text-[10px] bg-amber-200/80 text-amber-900 px-1.5 py-0.5 rounded font-mono">
                      受控 Chrome 保持打开中
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    检测到创作者账号尚未授权。受控 Chrome 已打开并展示官方扫码界面，请使用手机客户端扫码登录。
                    <strong className="text-amber-950 font-medium"> 扫码成功后系统将自动继续原发布任务，无需重新创建内容。</strong>
                  </p>
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={handleOpenLoginPage}
                      disabled={openingLogin}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-medium text-xs transition shadow-sm flex items-center gap-1"
                    >
                      {openingLogin ? "调起中..." : "📱 激活扫码登录页"}
                    </button>
                    <button
                      type="button"
                      onClick={handleResumeTask}
                      className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium text-xs transition shadow-sm flex items-center justify-center gap-1 font-semibold"
                    >
                      <span>🔄 已完成扫码，立即继续原任务</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleManualTakeover}
                      className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 rounded-md font-medium text-xs transition"
                    >
                      切换人工接管
                    </button>
                  </div>
                </div>
              )}

              {/* 停留在最终确认阶段时的提示与回填入口 */}
              {taskState.status === "AWAITING_CONFIRMATION" && (
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900 flex flex-col gap-2">
                  <div className="font-semibold">🎯 已停留在最终确认阶段</div>
                  <p className="text-[11px] text-sky-800">
                    页面表单已自动填妥。请在受控 Chrome 窗口亲自完成内容核对后点击【发布】。发布完成后，请回填落地链接生成已发布资产。
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold text-xs transition"
                  >
                    已在平台发布，回填落地链接
                  </button>
                </div>
              )}

              {/* 终态发布成功提示 */}
              {confirmSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg text-xs">
                  <div className="font-bold">🎉 发布已确认成功！</div>
                  <p className="text-[11px] text-emerald-700 mt-1 break-all">{confirmSuccess}</p>
                </div>
              )}
            </div>
          )}

          {/* 人工发布回退包 (当处于人工接管模式或未适配渠道时) */}
          {(manualTakeoverMode || activeChannel?.browserAssistantCapability === "MANUAL_FALLBACK") && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-800 text-sm">人工发布辅助包</span>
                <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium border border-amber-200">
                  可独立使用
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                受控浏览器保持打开。如果自动化中断或遇到验证码，您可直接从发布包一键复制内容到平台编辑器：
              </p>
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                  <span className="font-medium text-slate-700">官方创作者后台链接</span>
                  <a
                    href={
                      {
                        ZHIHU: "https://zhuanlan.zhihu.com/write",
                        XIAOHONGSHU: "https://creator.xiaohongshu.com/publish/publish",
                        WECHAT_OFFICIAL_ACCOUNT: "https://mp.weixin.qq.com/",
                        WECHAT: "https://mp.weixin.qq.com/",
                        BILIBILI: "https://member.bilibili.com/",
                        DOUYIN: "https://creator.douyin.com/",
                        WECHAT_CHANNELS: "https://channels.weixin.qq.com/",
                        KUAISHOU: "https://cp.kuaishou.com/article/publish/video",
                        WEIBO: "https://weibo.com/",
                        BAIJIAHAO: "https://baijiahao.baidu.com/builder/rc/edit?type=news",
                        TOUTIAO: "https://mp.toutiao.com/profile_v4/graphic/publish",
                      }[activeChannelKey] || "https://zhuanlan.zhihu.com/write"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 font-semibold hover:underline"
                  >
                    打开创作页 ↗
                  </a>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={handleDownloadPackageZip}
                  disabled={downloadingZip}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span>📦</span>
                  <span>{downloadingZip ? "正在打包..." : "下载完整人工发布包 (ZIP)"}</span>
                </button>
                <p className="text-[10px] text-slate-400 text-center">
                  打包包含 README.md 核对清单、content.txt 纯文本、metadata.json 与按序素材配图
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(true)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-semibold text-xs transition mt-1"
              >
                人工发布完成，回填公开链接
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 回填发布结果 Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-base">确认公开发布落地结果</h3>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              严格遵循系统真实性约束：区分已公开发布与平台审核中，只有具备可信公开落地链接或平台内容 ID 且通过核验说明方可记录资产。
            </p>

            {confirmError && (
              <div className="p-3 bg-rose-50 text-rose-700 rounded-lg text-xs border border-rose-200">
                {confirmError}
              </div>
            )}

            <div className="flex flex-col gap-3 text-xs">
              {/* 状态选择：已确认公开 vs 平台审核中 */}
              <div className="flex flex-col gap-1.5">
                <label className="font-semibold text-slate-700 block text-xs">
                  发布落成状态 <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBackfillStatus("PUBLISHED")}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 transition ${
                      backfillStatus === "PUBLISHED"
                        ? "border-emerald-500 bg-emerald-50/60 text-emerald-950 font-semibold ring-1 ring-emerald-400"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-xs flex items-center gap-1.5">
                      <span className="text-emerald-600">●</span> 已确认公开发布
                    </span>
                    <span className="text-[10px] text-slate-500">落地链接已全网公开可访问</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackfillStatus("PENDING_REVIEW")}
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 transition ${
                      backfillStatus === "PENDING_REVIEW"
                        ? "border-amber-500 bg-amber-50/60 text-amber-950 font-semibold ring-1 ring-amber-400"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="text-xs flex items-center gap-1.5">
                      <span className="text-amber-600">●</span> 平台审核中
                    </span>
                    <span className="text-[10px] text-slate-500">已提交审核，待平台审批通过</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  公开发布链接 (URL) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="url"
                  value={backfillUrl}
                  onChange={(e) => setBackfillUrl(e.target.value)}
                  placeholder={
                    activeChannelKey === "XIAOHONGSHU"
                      ? "https://www.xiaohongshu.com/explore/... 或 https://xhslink.com/..."
                      : activeChannelKey === "ZHIHU"
                      ? "https://zhuanlan.zhihu.com/p/..."
                      : activeChannelKey === "BILIBILI"
                      ? "https://www.bilibili.com/video/BV... 或 https://b23.tv/..."
                      : activeChannelKey === "DOUYIN"
                      ? "https://www.douyin.com/video/..."
                      : activeChannelKey === "WECHAT_CHANNELS"
                      ? "https://channels.weixin.qq.com/..."
                      : activeChannelKey === "KUAISHOU"
                      ? "https://www.kuaishou.com/short-video/..."
                      : activeChannelKey === "WEIBO"
                      ? "https://weibo.com/..."
                      : activeChannelKey === "BAIJIAHAO"
                      ? "https://baijiahao.baidu.com/s?id=..."
                      : activeChannelKey === "WECHAT_OFFICIAL_ACCOUNT"
                      ? "https://mp.weixin.qq.com/s/..."
                      : activeChannelKey === "TOUTIAO"
                      ? "https://www.toutiao.com/article/..."
                      : "https://..."
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  平台内容/文章 ID (可选)
                </label>
                <input
                  type="text"
                  value={backfillAssetId}
                  onChange={(e) => setBackfillAssetId(e.target.value)}
                  placeholder="例如: 651a2b3c4d5e..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 block mb-1">
                  人工核验说明 (Auditing Note) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={backfillNote}
                  onChange={(e) => setBackfillNote(e.target.value)}
                  placeholder="例如: 创作者在受控 Chrome 亲自核对并确认发布"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmitConfirmBackfill}
                disabled={confirmSubmitting}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition flex items-center gap-1.5"
              >
                {confirmSubmitting
                  ? "正在确认..."
                  : backfillStatus === "PUBLISHED"
                  ? "确认公开发布并建立 PublishedAsset"
                  : "登记为平台审核中 (PENDING_REVIEW)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
