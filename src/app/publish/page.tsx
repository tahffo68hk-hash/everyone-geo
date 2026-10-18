export default function Page() {
  return (
    <section className="card placeholder">
      <div className="eyebrow">统一内容发布 · 后续工作包</div>
      <h1>内容发布工作台</h1>
      <div className="notice">
        默认模式 PREPARE_ONLY ·
        当前尚未接通浏览器执行器，没有上传、自动填写或公开发布行为。
      </div>
      <p>后续支持平台选择、登录检查、媒体上传、自动填写与人工审核。</p>
      <div className="platforms">
        {[
          "小红书",
          "抖音",
          "B站",
          "微信视频号",
          "快手",
          "微博",
          "微信公众号",
          "知乎",
          "今日头条",
          "百家号",
          "WordPress",
        ].map((x) => (
          <div key={x}>
            {x}
            <span className="small">待接入 / 未真实验证</span>
          </div>
        ))}
      </div>
    </section>
  );
}
