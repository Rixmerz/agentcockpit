import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { clsx } from 'clsx';

interface CodeBlockProps {
  code: string;
  language?: string;
}

// Simple token-based syntax highlighting using regex
// Covers keywords, strings, comments, numbers for common languages
function highlightTokens(code: string, language: string): React.ReactNode[] {
  const patterns: { className: string; regex: RegExp }[] = [];

  // Comments (single-line)
  patterns.push({ className: 'code-token--comment', regex: /(?:\/\/.*|#.*)/g });
  // Multi-line comments
  patterns.push({ className: 'code-token--comment', regex: /\/\*[\s\S]*?\*\//g });
  // Strings (double-quoted, single-quoted, template literals)
  patterns.push({ className: 'code-token--string', regex: /(?:`(?:\\[\s\S]|[^`])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')/g });
  // Numbers
  patterns.push({ className: 'code-token--number', regex: /\b(?:0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/g });

  // Language-specific keywords
  const jsKeywords = /\b(?:const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|from|default|new|this|super|typeof|instanceof|void|delete|throw|try|catch|finally|async|await|yield|of|in|null|undefined|true|false|interface|type|enum|namespace|declare|as|is|keyof|readonly|abstract|implements|private|protected|public|static|get|set)\b/g;
  const pyKeywords = /\b(?:def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|raise|with|yield|lambda|and|or|not|in|is|None|True|False|self|pass|break|continue|global|nonlocal|assert|del|print|async|await)\b/g;
  const bashKeywords = /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|return|local|export|source|echo|exit|cd|ls|grep|sed|awk|cat|rm|cp|mv|mkdir|chmod|chown|sudo|apt|npm|pnpm|yarn|git|docker|curl|wget)\b/g;
  const cssKeywords = /\b(?:display|flex|grid|position|margin|padding|border|background|color|font|width|height|top|left|right|bottom|overflow|z-index|opacity|transition|transform|animation|align|justify|gap|none|auto|inherit|initial|var)\b/g;
  const htmlKeywords = /\b(?:div|span|a|p|h[1-6]|ul|ol|li|img|input|button|form|table|tr|td|th|head|body|html|script|style|link|meta|section|article|nav|header|footer|main)\b/g;
  const rustKeywords = /\b(?:fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|return|if|else|for|while|loop|match|break|continue|move|ref|as|in|where|async|await|unsafe|extern|type|dyn|static|true|false|Some|None|Ok|Err)\b/g;
  const goKeywords = /\b(?:func|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|default|break|continue|package|import|true|false|nil|make|len|cap|append|error|string|int|bool|byte|float64)\b/g;

  const lang = language.toLowerCase();
  if (['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: jsKeywords });
  } else if (['py', 'python'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: pyKeywords });
  } else if (['bash', 'sh', 'shell', 'zsh'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: bashKeywords });
  } else if (['css', 'scss', 'less'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: cssKeywords });
  } else if (['html', 'xml', 'svg', 'jsx', 'tsx'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: htmlKeywords });
  } else if (['rust', 'rs'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: rustKeywords });
  } else if (['go', 'golang'].includes(lang)) {
    patterns.push({ className: 'code-token--keyword', regex: goKeywords });
  } else {
    // Fallback: use JS-like keywords for unknown languages
    patterns.push({ className: 'code-token--keyword', regex: jsKeywords });
  }

  // Build a merged list of all matches with positions
  const matches: { start: number; end: number; className: string; text: string }[] = [];

  for (const { className, regex } of patterns) {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(code)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, className, text: m[0] });
    }
  }

  // Sort by start position, longer matches first for ties
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlapping matches (keep first/longest)
  const filtered: typeof matches = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  // Build React elements
  const result: React.ReactNode[] = [];
  let pos = 0;
  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    if (m.start > pos) {
      result.push(code.slice(pos, m.start));
    }
    result.push(
      <span key={i} className={m.className}>{m.text}</span>
    );
    pos = m.end;
  }
  if (pos < code.length) {
    result.push(code.slice(pos));
  }

  return result;
}

export function CodeBlock({ code, language = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const highlighted = language
    ? highlightTokens(code, language)
    : [code];

  return (
    <div className="code-block">
      <div className="code-block__header">
        {language && <span className="code-block__lang">{language}</span>}
        <button
          className={clsx('code-block__copy', copied && 'code-block__copy--copied')}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="code-block__pre">
        <code className="code-block__code">{highlighted}</code>
      </pre>
    </div>
  );
}
