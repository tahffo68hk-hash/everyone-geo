"""
GeoLens 本地浏览器助手 - 平台适配器注册表 (PublisherRegistry)
支持按渠道名称动态解析与实例化对应的适配器
"""
from typing import Type
from selenium import webdriver
from .base import BasePublisher
from .zhihu import ZhihuPublisher
from .simulation import LocalSimulationPublisher
from .fallback import FallbackPublisher, CREATOR_URL_MAP


class PublisherRegistry:
    """管理所有支持的平台适配器"""
    
    _REGISTRY: dict[str, Type[BasePublisher]] = {
        "ZHIHU": ZhihuPublisher,
        "SIMULATION": LocalSimulationPublisher,
    }

    @classmethod
    def get_publisher(cls, channel: str, driver: webdriver.Chrome) -> BasePublisher:
        norm_channel = channel.upper()
        if norm_channel in cls._REGISTRY:
            publisher_cls = cls._REGISTRY[norm_channel]
            return publisher_cls(driver)
        # 未适配平台降级为 FallbackPublisher
        return FallbackPublisher(driver, norm_channel)

    @classmethod
    def is_fully_automated(cls, channel: str) -> bool:
        """判断该平台是否已具备全流程自动填写能力"""
        return channel.upper() in cls._REGISTRY

    @classmethod
    def get_supported_channels(cls) -> list[dict]:
        """返回所有支持的渠道能力清单"""
        all_channels = ["ZHIHU", "SIMULATION", "XIAOHONGSHU", "BILIBILI", "DOUYIN", "WECHAT_CHANNELS", "WEIBO"]
        results = []
        for ch in all_channels:
            is_auto = ch in cls._REGISTRY
            results.append({
                "channel": ch,
                "is_fully_automated": is_auto,
                "capability": "FULL_AUTOMATION" if is_auto else "MANUAL_FALLBACK",
                "creator_url": CREATOR_URL_MAP.get(ch, "https://zhuanlan.zhihu.com/write" if ch == "ZHIHU" else "/simulation-editor.html")
            })
        return results


registry = PublisherRegistry()
