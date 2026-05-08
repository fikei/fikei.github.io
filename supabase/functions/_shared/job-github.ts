// Shared GitHub Contents API helpers for the /job product.
// All functions read/write the private fikei/job repo on the user's behalf
// using a server-only GITHUB_PAT secret.

const REPO = 'fikei/job';
const REF = 'main';
const API = 'https://api.github.com';

function pat(): string {
  const t = Deno.env.get('GITHUB_PAT');
  if (!t) throw new Error('GITHUB_PAT not configured');
  return t;
}

const HEADERS = () => ({
  Authorization: `Bearer ${pat()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ctrl-rodeo-job-product',
});

export interface FileResult { path: string; sha: string; content: string; }

export async function ghReadFile(path: string): Promise<FileResult | null> {
  const res = await fetch(`${API}/repos/${REPO}/contents/${path}?ref=${REF}`, { headers: HEADERS() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`gh read ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (Array.isArray(data) || data.type !== 'file') throw new Error(`expected file at ${path}`);
  const content = data.encoding === 'base64' ? atob(data.content.replace(/\n/g, '')) : data.content;
  return { path: data.path, sha: data.sha, content };
}

export async function ghReadDir(path: string): Promise<{ name: string; path: string; type: string; size: number }[]> {
  const res = await fetch(`${API}/repos/${REPO}/contents/${path.replace(/\/$/, '')}?ref=${REF}`, { headers: HEADERS() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`gh dir ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`expected directory at ${path}`);
  return data.map((e: { name: string; path: string; type: string; size: number }) => ({
    name: e.name, path: e.path, type: e.type, size: e.size,
  }));
}

// Recursive tree listing (one API call). Returns file blobs only.
export async function ghTree(path = ''): Promise<{ path: string; sha: string }[]> {
  const res = await fetch(`${API}/repos/${REPO}/git/trees/${REF}?recursive=1`, { headers: HEADERS() });
  if (!res.ok) throw new Error(`gh tree ${res.status}`);
  const data = await res.json() as { tree: { path: string; type: string; sha: string }[] };
  return (data.tree || [])
    .filter(t => t.type === 'blob' && (!path || t.path.startsWith(path)))
    .map(t => ({ path: t.path, sha: t.sha }));
}

export async function ghWriteFile(path: string, content: string, message: string, baseSha?: string): Promise<{ path: string; sha: string }> {
  const body: Record<string, string> = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
    branch: REF,
  };
  if (baseSha) body.sha = baseSha;
  // If no baseSha and the file already exists, GitHub returns 422; fetch the
  // existing sha and retry once.
  let res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...HEADERS(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 422 && !baseSha) {
    const existing = await ghReadFile(path);
    if (existing) {
      body.sha = existing.sha;
      res = await fetch(`${API}/repos/${REPO}/contents/${path}`, {
        method: 'PUT',
        headers: { ...HEADERS(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
  }
  if (!res.ok) throw new Error(`gh write ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { content: { path: string; sha: string } };
  return { path: data.content.path, sha: data.content.sha };
}
