"""
GeoLens 本地浏览器助手 - 平台适配器注册表 (PublisherRegistry)
支持按渠道名称动态解析与实例化对应的适配器
"""
from typing import Type
from selenium import webdriver
from .base import BasePublisher
from .zhihu import ZhihuPublisher
from .simulation import LocalSimulationPublisher
from .xiaohongshu import XiaohongshuPublisher
from .bilibili import BilibiliPublisher
from .douyin import DouyinPublisher
from .wechat_channels import WechatChannelsPublisher
from .kuaishou import KuaishouPublisher
from .weibo import WeiboPublisher
from .baijiahao import BaijiahaoPublisher
from .wechat_official_account import WechatOfficialAccountPublisher
from .toutiao import ToutiaoPublisher
from .fallback import FallbackPublisher, CREATOR_URL_MAP


class PublisherRegistry:
    """管理所有支持的平台适配器"""
    
    _REGISTRY: dict[str, Type[BasePublisher]] = {
        "ZHIHU": ZhihuPublisher,
        "SIMULATION": LocalSimulationPublisher,
        "XIAOHONGSHU": XiaohongshuPublisher,
        "BILIBILI": BilibiliPublisher,
        "DOUYIN": DouyinPublisher,
        "WECHAT_CHANNELS": WechatChannelsPublisher,
        "KUAISHOU": KuaishouPublisher,
        "WEIBO": WeiboPublisher,
        "BAIJIAHAO": BaijiahaoPublisher,
        "WECHAT_OFFICIAL_ACCOUNT": WechatOfficialAccountPublisher,
        "TOUTIAO": ToutiaoPublisher,
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
    def is_autofill_supported(cls, channel: str) -> bool:
        """判断该平台是否具备自动填写与双向校验能力 (PREPARE_ONLY)"""
        return channel.upper() in cls._REGISTRY

    @classmethod
    def is_fully_automated(cls, channel: str) -> bool:
        """兼容别名"""
        return cls.is_autofill_supported(channel)

    @classmethod
    def get_supported_channels(cls) -> list[dict]:
        """返回所有支持的渠道能力清单"""
        all_channels = [
            "ZHIHU", "SIMULATION", "XIAOHONGSHU", "BILIBILI", "DOUYIN",
            "WECHAT_CHANNELS", "KUAISHOU", "WEIBO", "BAIJIAHAO",
            "WECHAT_OFFICIAL_ACCOUNT", "TOUTIAO"
        ]
        results = []
        for ch in all_channels:
            is_auto = ch in cls._REGISTRY
            results.append({
                "channel": ch,
                "is_autofill_supported": is_auto,
                "is_fully_automated": is_auto,
                "capability": "AUTOFILL_AND_CONFIRM" if is_auto else "MANUAL_FALLBACK",
                "mode": "PREPARE_ONLY" if is_auto else "MANUAL_FALLBACK",
                "creator_url": CREATOR_URL_MAP.get(ch, "https://zhuanlan.zhihu.com/write" if ch == "ZHIHU" else "/simulation-editor.html")
            })
        return results


registry = PublisherRegistry()
