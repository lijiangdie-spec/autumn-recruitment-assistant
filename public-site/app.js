const state = { jobs: [], limit: 120 };
const jobsNode = document.querySelector("#jobs");
const emptyNode = document.querySelector("#empty");
const queryNode = document.querySelector("#query");
const cityNode = document.querySelector("#city");
const typeNode = document.querySelector("#type");
const loadMoreNode = document.querySelector("#load-more");

function employmentLabel(value) { return value === "campus" ? "校招" : value === "internship" ? "实习" : "待确认"; }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
async function sha256(value) { const bytes = new TextEncoder().encode(typeof value === "string" ? value : stableJson(value)); return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((item) => item.toString(16).padStart(2, "0")).join(""); }
function link(label, href, primary = false) { if (!href) return null; const node = document.createElement("a"); node.textContent = label; node.href = href; node.target = "_blank"; node.rel = "noreferrer"; if (primary) node.className = "primary"; return node; }
function render() {
  const query = queryNode.value.trim().toLocaleLowerCase(); const city = cityNode.value; const type = typeNode.value;
  const visible = state.jobs.filter((job) => (!query || `${job.company}\n${job.title}\n${job.cities.join(" ")}\n${job.jdText}`.toLocaleLowerCase().includes(query)) && (!city || job.cities.includes(city)) && (!type || job.employmentType === type));
  jobsNode.replaceChildren(); emptyNode.hidden = visible.length > 0; const rendered = visible.slice(0, state.limit);
  loadMoreNode.hidden = rendered.length >= visible.length; loadMoreNode.textContent = `显示更多岗位（已显示 ${rendered.length} / ${visible.length}）`;
  for (const job of rendered) {
    const article = document.createElement("article"); const top = document.createElement("div"); top.className = "job-top";
    const meta = document.createElement("div"); const company = document.createElement("span"); company.textContent = job.company; const title = document.createElement("h2"); title.textContent = job.title; meta.append(company, title);
    const badge = document.createElement("em"); badge.textContent = employmentLabel(job.employmentType); top.append(meta, badge);
    const facts = document.createElement("p"); facts.className = "facts"; facts.textContent = `${job.cities.join(" / ") || "地点待确认"}${job.cohort ? ` · ${job.cohort}` : ""}${job.deadlineAt ? ` · 截止 ${job.deadlineAt.slice(0, 10)}` : ""}`;
    const jd = document.createElement("p"); jd.className = "jd"; jd.textContent = job.jdText.slice(0, 240) || "岗位详情请查看来源页面。";
    const actions = document.createElement("div"); actions.className = "actions"; for (const item of [link("查看来源", job.officialUrl || job.sourceUrl), link("前往投递", job.applyUrl, true)]) if (item) actions.append(item);
    article.append(top, facts, jd, actions); jobsNode.append(article);
  }
}

fetch("feed.json", { cache: "no-store" }).then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(async (feed) => {
  if (feed.schemaVersion !== 1 || !Array.isArray(feed.jobs) || feed.jobCount !== feed.jobs.length) throw new Error("feed 格式无效");
  if (await sha256(feed.jobs) !== feed.jobsHash || await sha256({ schemaVersion: 1, jobsHash: feed.jobsHash }) !== feed.revision) throw new Error("feed 完整性校验失败");
  state.jobs = feed.jobs;
  document.querySelector("#job-count").textContent = `${feed.jobCount} 个公开岗位`; document.querySelector("#updated-at").textContent = `更新于 ${new Date(feed.generatedAt).toLocaleString("zh-CN")}`;
  const cities = [...new Set(feed.jobs.flatMap((job) => job.cities))].sort((a, b) => a.localeCompare(b, "zh-CN")); for (const city of cities) { const option = document.createElement("option"); option.value = city; option.textContent = city; cityNode.append(option); } render();
}).catch((error) => { document.querySelector("#job-count").textContent = "岗位源暂不可用"; document.querySelector("#updated-at").textContent = error.message; });
for (const node of [queryNode, cityNode, typeNode]) node.addEventListener("input", () => { state.limit = 120; render(); });
loadMoreNode.addEventListener("click", () => { state.limit += 120; render(); });
