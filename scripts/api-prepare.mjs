// Operator HTTP client: deliberately exposes preparation actions only.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const base = "http://127.0.0.1:3100",
  jar = "data/operator-cookies.json";
let cookie = "";
try {
  cookie = JSON.parse(await readFile(jar, "utf8")).cookie || "";
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
async function request(route, body) {
  const form = body instanceof FormData;
  const res = await fetch(base + "/api/" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      ...(body !== undefined && !form
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    redirect: "error",
  });
  const next = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("geo_session="));
  if (next) {
    cookie = next.split(";")[0];
    await mkdir("data", { recursive: true });
    await writeFile(jar, JSON.stringify({ cookie }), { mode: 0o600 });
  }
  const data = await res.json();
  if (!res.ok) throw Error(data.error || "HTTP " + res.status);
  return data;
}
const [command, ...args] = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf("--" + name);
  return i < 0 ? undefined : args[i + 1];
};
try {
  let result;
  if (command === "claim" && args[0])
    result = await request("publish/claim", { code: args[0] });
  else if (command === "workspace") result = await request("publish/workspace");
  else if (command === "status" && args[0])
    result = await request("publish/status/" + encodeURIComponent(args[0]));
  else if (command === "fill" && args[0])
    result = await request("publish/fill/" + encodeURIComponent(args[0]), {});
  else if (command === "upload") {
    const content = option("content"),
      file = args[args.length - 1];
    if (!content || !file || file === content)
      throw Error("需要 --content <id> <file>");
    const form = new FormData();
    form.set("contentId", content);
    form.set("file", new Blob([await readFile(file)]), path.basename(file));
    result = await request("media", form);
  } else if (command === "create") {
    if (
      option("platform") !== "bilibili" ||
      !option("account") ||
      !option("media")
    )
      throw Error("需要 --platform bilibili --account <id> --media <id>");
    const workspace = await request("publish/workspace"),
      content = workspace.contents.find((c) => c.id === option("content"));
    if (!content) throw Error("当前会话草稿不存在，请先绑定包含该检测的账号码");
    const body = JSON.parse(content.body);
    result = await request("publish/create", {
      contentId: content.id,
      targets: [
        {
          platform: "bilibili",
          accountId: option("account"),
          type: "video",
          title: body.title,
          body: body.body,
          tags: body.hashtags,
          mediaIds: [option("media")],
          coverId: option("cover"),
          declaration: option("declaration") || "内容无需标注",
          selfMadeAuth: false,
        },
      ],
    });
  } else
    throw Error(
      "用法：api-prepare.mjs claim <code> | workspace | upload --content <id> <file> | create --content <id> --platform bilibili --account <id> --media <id> [--cover <id>] [--declaration <text>] | fill <jobId> | status <jobId>",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
