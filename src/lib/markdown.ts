import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function parseMarkdown(content: string): string {
  try {
    if (typeof content !== 'string') {
      content = String(content);
    }
    
    const rawHtml = marked.parse(content, {
      breaks: true,
      gfm: true
    });
    
    const htmlString = typeof rawHtml === 'string' ? rawHtml : String(rawHtml);
    
    const cleanHtml = DOMPurify.sanitize(htmlString, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'code', 'pre', 
        'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'img', 'hr', 'del', 'ins', 'mark', 'small', 'sub', 'sup'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    }); // why just why bro
    
    return cleanHtml;
  } catch (error) {
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export function isMarkdown(content: string): boolean {
  if (typeof content !== 'string') {
    content = String(content);
  }
  
  const markdownPatterns = [
    /^\s*#+\s/,
    /\*\*.*\*\*/,
    /\*.*\*/,
    /`.*`/,
    /```[\s\S]*```/,
    /^\s*-\s/,
    /^\s*\d+\.\s/,
    /\[.*\]\(.*\)/,
    /^\s*>\s/,
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
} 