import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function parseMarkdown(content: string): string {
  try {
    // Ensure content is a string
    if (typeof content !== 'string') {
      console.warn('parseMarkdown received non-string content:', content);
      content = String(content);
    }
    
    console.log('🔍 Parsing markdown content:', content.substring(0, 200) + '...');
    
    // Parse markdown to HTML with basic configuration (no custom renderer for now)
    const rawHtml = marked.parse(content, {
      breaks: true, // Convert line breaks to <br>
      gfm: true    // GitHub Flavored Markdown
    });
    
    console.log('🔍 Raw HTML type:', typeof rawHtml);
    console.log('🔍 Raw HTML:', typeof rawHtml === 'string' ? rawHtml.substring(0, 200) + '...' : rawHtml);
    
    // Ensure rawHtml is a string
    const htmlString = typeof rawHtml === 'string' ? rawHtml : String(rawHtml);
    
    // Sanitize HTML to prevent XSS attacks
    const cleanHtml = DOMPurify.sanitize(htmlString, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'code', 'pre', 
        'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'a', 'img', 'hr', 'del', 'ins', 'mark', 'small', 'sub', 'sup'
      ],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
    });
    
    return cleanHtml;
  } catch (error) {
    console.error('Error parsing markdown:', error);
    // Fallback to plain text if parsing fails
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export function isMarkdown(content: string): boolean {
  // Ensure content is a string
  if (typeof content !== 'string') {
    console.warn('isMarkdown received non-string content:', content);
    content = String(content);
  }
  
  // Simple check for common markdown patterns
  const markdownPatterns = [
    /^\s*#+\s/, // Headers
    /\*\*.*\*\*/, // Bold
    /\*.*\*/, // Italic
    /`.*`/, // Inline code
    /```[\s\S]*```/, // Code blocks
    /^\s*-\s/, // Lists
    /^\s*\d+\.\s/, // Numbered lists
    /\[.*\]\(.*\)/, // Links
    /^\s*>\s/, // Blockquotes
  ];
  
  return markdownPatterns.some(pattern => pattern.test(content));
} 