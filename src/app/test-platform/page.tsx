"use client";
import { useState, useEffect } from "react";
export default function TestPlatform() {
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    document.body.dataset.testReady = "true";
  }, []);
  return (
    <section className="card">
      <div className="eyebrow">本地流程验证 / 非真实平台</div>
      <h1>自动填写测试平台</h1>
      <label>
        上传图片或视频
        <input
          id="media"
          type="file"
          multiple
          onChange={(e) =>
            setFiles(Array.from(e.target.files || []).map((f) => f.name))
          }
        />
      </label>
      {files.length > 0 && <p id="upload-done">上传完成：{files.join(", ")}</p>}
      <label>
        标题
        <input id="title" />
      </label>
      <label>
        正文
        <textarea id="body" rows={8} />
      </label>
      <label>
        话题
        <input id="tags" />
      </label>
      <button
        id="final-publish"
        onClick={() => (document.body.dataset.published = "true")}
      >
        测试最终提交（执行器禁止点击）
      </button>
    </section>
  );
}
