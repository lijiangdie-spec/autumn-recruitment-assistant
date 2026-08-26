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
function cell(className, text) { const node = document.createElement("td"); node.className = className; node.textContent = text; return node; }
function render() {
  const query = queryNode.value.trim().toLocaleLowerCase(); const city = cityNode.value; const type = typeNode.value;
  const visible = state.jobs.filter((job) => (!query || `${job.company}\n${job.title}\n${job.cities.join(" ")}`.toLocaleLowerCase().includes(query)) && (!city || job.cities.includes(city)) && (!type || job.employmentType === type));
  jobsNode.replaceChildren(); emptyNode.hidden = visible.length > 0; const rendered = visible.slice(0, state.limit);
  loadMoreNode.hidden = rendered.length >= visible.length; loadMoreNode.textContent = `显示更多岗位（已显示 ${rendered.length} / ${visible.length}）`;
  for (const job of rendered) {
    const row = document.createElement("tr");
    const typeCell = cell("type", employmentLabel(job.employmentType));
    const actionCell = document.createElement("td"); actionCell.className = "action"; const href = job.applyUrl || job.officialUrl || job.sourceUrl;
    if (href) { const anchor = document.createElement("a"); anchor.textContent = job.applyUrl ? "投递 ↗" : "查看 ↗"; anchor.href = href; anchor.target = "_blank"; anchor.rel = "noreferrer"; actionCell.append(anchor); } else { actionCell.textContent = "—"; }
    row.append(cell("company", job.company), cell("title", job.title), cell("city", job.cities.join(" / ") || "待确认"), typeCell, cell("deadline", job.deadlineAt ? job.deadlineAt.slice(0, 10) : "—"), actionCell);
    jobsNode.append(row);
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
