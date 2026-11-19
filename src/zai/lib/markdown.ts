// File: src/zai/lib/markdown.ts — safe pipeline: marked → DOMPurify
// Uses isomorphic-dompurify (wraps jsdom on the server) instead of the plain
// "dompurify" package because this route is server-rendered by TanStack
// Start: plain DOMPurify throws "sanitize is not a function" with no window.
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
marked.setOptions({ breaks: true, gfm: true });
const ALLOWED_TAGS = ["p","br","strong","em","del","code","pre","blockquote","ul","ol","li","h1","h2","h3","h4","h5","h6","table","thead","tbody","tr","th","td","a","hr","img","figure","figcaption","span","div"];
const ALLOWED_ATTR = ["href","src","alt","title","loading","dir","class"];
export function renderMarkdownSafe(md: string): string {
  const raw = marked.parse(md ?? "", { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS, ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: ["script","style","iframe","object","embed","form","input","button","svg","math"],
    FORBID_ATTR: ["onerror","onclick","onload","style","srcdoc"],
  });
}
export function extractCodeBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /```[\w-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}
