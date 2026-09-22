const GITHUB_API = "https://api.github.com";
const SEMANTIC_API = "https://api.semanticscholar.org/graph/v1";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { ...corsHeaders, ...headers } });

const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { ...corsHeaders, ...headers } });

const githubHeaders = (accept = "application/vnd.github+json") => {
  const headers = {
    Accept: accept,
    "User-Agent": "collavio-sandbox",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const semanticHeaders = () => {
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "ResearchHub-Educational-Project/1.0",
  };
  if (process.env.SEMANTIC_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_API_KEY;
  }
  return headers;
};

const notionHeaders = () => {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) throw new Error("NOTION_TOKEN missing");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
};

const fetchWithRetry = async (url, options, retries = 4, backoff = 500) => {
  let response;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    response = await fetch(url, options);
    if (response.status !== 429 || attempt === retries - 1) return response;
    await new Promise((resolve) =>
      setTimeout(resolve, backoff * (2 ** attempt) + Math.random() * 250),
    );
  }
  return response;
};

const proxyJson = async (url, options) => {
  const response = await fetch(url, options);
  const body = await response.json();
  return json(body, response.status);
};

const semanticJson = async (url, options = {}) => {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: semanticHeaders(),
  });
  return json(await response.json(), response.status);
};

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return {};
  }
};

export default async (request) => {
  if (request.method === "OPTIONS") return text("", 204);

  const incomingUrl = new URL(request.url);
  const path = incomingUrl.pathname;
  const query = incomingUrl.searchParams;

  try {
    if (request.method === "GET" && path === "/api/github/repo") {
      const { owner, repo } = Object.fromEntries(query);
      return proxyJson(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: githubHeaders(),
      });
    }

    if (request.method === "GET" && path === "/api/github/readme") {
      const { owner, repo } = Object.fromEntries(query);
      const response = await fetch(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`,
        { headers: githubHeaders("application/vnd.github.html+json") },
      );
      return text(await response.text(), response.status, {
        "Content-Type": response.headers.get("content-type") || "text/html; charset=utf-8",
      });
    }

    if (request.method === "GET" && path === "/api/github/commits") {
      const url = new URL(`${GITHUB_API}/repos/${encodeURIComponent(query.get("owner"))}/${encodeURIComponent(query.get("repo"))}/commits`);
      if (query.get("sha")) url.searchParams.set("sha", query.get("sha"));
      return proxyJson(url, { headers: githubHeaders() });
    }

    if (request.method === "POST" && path === "/api/github/repos") {
      const { name, description, isPrivate } = await parseBody(request);
      return proxyJson(`${GITHUB_API}/user/repos`, {
        method: "POST",
        headers: githubHeaders(),
        body: JSON.stringify({ name, description, private: Boolean(isPrivate), auto_init: true }),
      });
    }

    if (request.method === "GET" && path === "/api/github/prs") {
      const url = new URL(`${GITHUB_API}/repos/${encodeURIComponent(query.get("owner"))}/${encodeURIComponent(query.get("repo"))}/pulls`);
      for (const [key, fallback] of [["state", "open"], ["per_page", "50"], ["page", "1"]]) {
        url.searchParams.set(key, query.get(key) || fallback);
      }
      return proxyJson(url, { headers: githubHeaders() });
    }

    if (request.method === "GET" && path === "/api/semantic/search") {
      if (!query.get("query")) return json({ error: "Query is required" }, 400);
      const url = new URL(`${SEMANTIC_API}/paper/search`);
      for (const [key, fallback] of [["query", null], ["limit", "10"], ["offset", "0"], ["year", null], ["fieldsOfStudy", null]]) {
        const value = query.get(key) || fallback;
        if (value) url.searchParams.set(key, value);
      }
      if (query.get("openAccessPdf") === "true") url.searchParams.set("openAccessPdf", "");
      url.searchParams.set("fields", "title,abstract,year,authors,venue,citationCount,referenceCount,openAccessPdf,url");
      return semanticJson(url);
    }

    const semanticPaper = path.match(/^\/api\/semantic\/paper\/([^/]+)$/);
    if (request.method === "GET" && semanticPaper) {
      const url = new URL(`${SEMANTIC_API}/paper/${encodeURIComponent(semanticPaper[1])}`);
      url.searchParams.set("fields", "title,abstract,year,authors,venue,citationCount,referenceCount,openAccessPdf,url");
      return semanticJson(url);
    }

    const semanticNetwork = path.match(/^\/api\/semantic\/paper\/([^/]+)\/(citations|references)$/);
    if (request.method === "GET" && semanticNetwork) {
      const url = new URL(`${SEMANTIC_API}/paper/${encodeURIComponent(semanticNetwork[1])}/${semanticNetwork[2]}`);
      url.searchParams.set("fields", "title,year,authors,venue,citationCount,url");
      url.searchParams.set("limit", query.get("limit") || "10");
      return semanticJson(url);
    }

    if (request.method === "GET" && path === "/api/semantic/author/search") {
      if (!query.get("query")) return json({ error: "Query is required" }, 400);
      const url = new URL(`${SEMANTIC_API}/author/search`);
      url.searchParams.set("query", query.get("query"));
      url.searchParams.set("limit", query.get("limit") || "10");
      url.searchParams.set("offset", query.get("offset") || "0");
      url.searchParams.set("fields", "name,paperCount,citationCount,affiliations");
      return semanticJson(url);
    }

    const semanticAuthor = path.match(/^\/api\/semantic\/author\/([^/]+)$/);
    if (request.method === "GET" && semanticAuthor) {
      const url = new URL(`${SEMANTIC_API}/author/${encodeURIComponent(semanticAuthor[1])}`);
      url.searchParams.set("fields", "name,affiliations,paperCount,citationCount,papers.title,papers.year,papers.citationCount,papers.url");
      return semanticJson(url);
    }

    if (request.method === "POST" && path === "/api/semantic/paper/batch") {
      const url = new URL(`${SEMANTIC_API}/paper/batch`);
      url.searchParams.set("fields", "title,abstract,year,authors,venue,citationCount");
      return semanticJson(url, { method: "POST", body: JSON.stringify(await parseBody(request)) });
    }

    if (request.method === "GET" && path === "/api/semantic/fields") {
      return json({ data: [
        "Computer Science", "Medicine", "Chemistry", "Biology", "Materials Science",
        "Physics", "Geology", "Psychology", "Art", "History", "Geography", "Sociology",
        "Business", "Political Science", "Economics", "Philosophy", "Mathematics", "Engineering",
      ] });
    }

    if (request.method === "POST" && path === "/api/notion/pages") {
      return proxyJson(`${NOTION_API}/pages`, {
        method: "POST",
        headers: notionHeaders(),
        body: JSON.stringify(await parseBody(request)),
      });
    }

    const notionAppend = path.match(/^\/api\/notion\/blocks\/([^/]+)\/append$/);
    if (request.method === "PATCH" && notionAppend) {
      return proxyJson(`${NOTION_API}/blocks/${encodeURIComponent(notionAppend[1])}/children`, {
        method: "PATCH",
        headers: notionHeaders(),
        body: JSON.stringify(await parseBody(request)),
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
};

export const config = {
  path: "/api/*",
};
