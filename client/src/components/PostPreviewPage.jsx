import { useEffect } from 'react';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeBuf = [];

  const closeList = () => {
    if (inList) { html += '</ul>\n'; inList = false; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');

    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += `<pre class="preview-code">${esc(codeBuf.join('\n'))}</pre>\n`;
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (line.trim() === '') { closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>\n`;
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.*)/);
    if (li) {
      if (!inList) { html += '<ul>\n'; inList = true; }
      html += `<li>${inline(li[1])}</li>\n`;
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)/);
    if (ol) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += `<li>${inline(ol[1])}</li>\n`;
      continue;
    }

    closeList();
    html += `<p>${inline(line)}</p>\n`;
  }
  closeList();
  if (inCode) html += `<pre class="preview-code">${esc(codeBuf.join('\n'))}</pre>\n`;

  return html;
}

function inline(text) {
  let t = esc(text);
  t = t.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/`(.*?)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

export default function PostPreviewPage({ post, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!post) return null;

  const bodyHtml = renderMarkdown(post.body || post.excerpt || '');

  return (
    <div className="preview-overlay">
      <div className="preview-topbar">
        <div className="preview-title">{post.title || 'Untitled'}</div>
        <button className="preview-close" onClick={onClose} title="Close (Esc)">✕</button>
      </div>
      <div className="preview-scroll">
        <article className="preview-article">
          {post.cover_url && <img className="preview-cover" src={post.cover_url} alt="Cover" />}
          <header className="preview-header">
            {post.topic_name && <span className="preview-topic">{post.topic_name}</span>}
            {post.tags?.length > 0 && (
              <div className="preview-tags">
                {post.tags.map((t, i) => <span key={i} className="preview-tag">{esc(t)}</span>)}
              </div>
            )}
            {post.excerpt && <p className="preview-excerpt">{esc(post.excerpt)}</p>}
          </header>
          <div className="preview-body" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          {post.news_sources?.length > 0 && (
            <footer className="preview-sources">
              <h4>Sources</h4>
              {post.news_sources.map((s, i) => (
                <div key={i} className="preview-source">
                  {s.url ? <a href={s.url} target="_blank" rel="noopener">{esc(s.title || s.source)}</a> : esc(s.title || s.source)}
                </div>
              ))}
            </footer>
          )}
        </article>
      </div>
    </div>
  );
}
