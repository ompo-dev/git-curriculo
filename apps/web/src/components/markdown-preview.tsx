import React from "react";

function renderInline(text: string): string {
  const S = "color:var(--gc-accent);text-decoration:underline;text-underline-offset:2px";

  function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  type Pat = { re: RegExp; toHtml: (m: RegExpMatchArray) => string };
  const patterns: Pat[] = [
    {
      re: /\[([^\]]+)\]\((https?:\/\/[^)]+|mailto:[^)]+)\)/,
      toHtml: m => `<a href="${m[2]!}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[1]!)}</a>`
    },
    { re: /\*\*(.+?)\*\*/, toHtml: m => `<strong>${esc(m[1]!)}</strong>` },
    { re: /\*(.+?)\*/, toHtml: m => `<em>${esc(m[1]!)}</em>` },
    { re: /`(.+?)`/, toHtml: m => esc(m[1]!) },
    {
      re: /https?:\/\/[^\s<>"&)]+/,
      toHtml: m => `<a href="${m[0]}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[0])}</a>`
    },
    {
      re: /(?:github\.com|linkedin\.com)\/[\w\-./#?=&%]+/,
      toHtml: m => `<a href="https://${m[0]}" target="_blank" rel="noopener noreferrer" style="${S}">${esc(m[0])}</a>`
    },
    {
      re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      toHtml: m => `<a href="mailto:${m[0]}" style="${S}">${esc(m[0])}</a>`
    }
  ];

  let out = "";
  let rem = text;
  while (rem.length > 0) {
    let best: { index: number; m: RegExpMatchArray; p: Pat } | null = null;
    for (const p of patterns) {
      const m = rem.match(p.re);
      if (m && m.index !== undefined && (!best || m.index < best.index)) {
        best = { index: m.index, m, p };
      }
    }
    if (!best) {
      out += esc(rem);
      break;
    }
    if (best.index > 0) out += esc(rem.slice(0, best.index));
    out += best.p.toHtml(best.m);
    rem = rem.slice(best.index + best.m[0].length);
  }
  return out;
}

interface MarkdownPreviewProps {
  content: string;
  variant?: "default" | "panel";
}

export function MarkdownPreview({ content, variant = "default" }: MarkdownPreviewProps): JSX.Element {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  const isPanel = variant === "panel";
  const h1Class = isPanel
    ? "text-base font-bold text-[var(--gc-text)] mb-1 mt-0"
    : "text-xl font-bold text-[var(--gc-text)] mb-0.5 mt-0";
  const h2Class = isPanel
    ? "text-sm font-bold text-[var(--gc-text)] border-b border-[var(--gc-border)] pb-1 mt-4 mb-2"
    : "text-[15px] font-bold text-[var(--gc-text)] border-b border-[var(--gc-border)] pb-1 mt-5 mb-2";
  const h3Class = isPanel
    ? "text-xs font-semibold text-[var(--gc-text)] mt-2 mb-0.5"
    : "text-[12px] font-semibold text-[var(--gc-text)] mt-2.5 mb-0.5";
  const pClass = isPanel
    ? "text-sm text-[var(--gc-text)] leading-relaxed mb-1"
    : "text-[12px] text-[var(--gc-text)] leading-snug mb-0.5";
  const liClass = isPanel
    ? "text-sm text-[var(--gc-text)] leading-relaxed list-disc marker:text-[var(--gc-text-muted)]"
    : "text-[12px] text-[var(--gc-text)] leading-snug list-disc marker:text-[var(--gc-text-muted)]";
  const wrapperClass = isPanel ? "font-sans" : "font-sans px-6 py-5";

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={i} className={h1Class}>
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={i} className={h2Class}>
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={i} className={h3Class}>
          {line.slice(4)}
        </h3>
      );
    } else if (/^[-*•] /.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^[-*•] /.test(lines[i] ?? "")) {
        bullets.push((lines[i] ?? "").replace(/^[-*•] /, ""));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className={`my-1 space-y-1 ${isPanel ? "pl-5" : "pl-4"}`}>
          {bullets.map((b, j) => (
            <li key={j} className={liClass} dangerouslySetInnerHTML={{ __html: renderInline(b) }} />
          ))}
        </ul>
      );
      continue;
    } else if (line.trim()) {
      nodes.push(
        <p key={i} className={pClass} dangerouslySetInnerHTML={{ __html: renderInline(line) }} />
      );
    } else {
      nodes.push(<div key={i} className={isPanel ? "h-2" : "h-1"} />);
    }

    i++;
  }

  return (
    <div
      className={wrapperClass}
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >
      {nodes}
    </div>
  );
}
