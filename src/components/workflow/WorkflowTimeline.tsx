import { useState, useEffect } from 'react';
import {
  GitCommitHorizontal,
  ArrowRightLeft,
  FileCode,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { TimelineEvent, TimelineData } from '../../services/workflowService';
import { getTimeline } from '../../services/workflowService';

interface WorkflowTimelineProps {
  projectPath?: string | null;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return '??:??';
  }
}

function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function getEventIcon(type: TimelineEvent['type']) {
  switch (type) {
    case 'transition':
      return <ArrowRightLeft size={12} style={{ color: '#89b4fa' }} />;
    case 'commit':
      return <GitCommitHorizontal size={12} style={{ color: '#a6e3a1' }} />;
    default:
      return <FileCode size={12} style={{ color: 'var(--text-muted)' }} />;
  }
}

function getEventColor(type: TimelineEvent['type']): string {
  switch (type) {
    case 'transition': return '#89b4fa';
    case 'commit': return '#a6e3a1';
    default: return 'var(--text-muted, #6c7086)';
  }
}

export function WorkflowTimeline({ projectPath }: WorkflowTimelineProps) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const timeline = await getTimeline(projectPath ?? null);
        setData(timeline);
      } catch {
        // ignore
      }
      setLoading(false);
    }
    load();
  }, [projectPath]);

  if (loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading timeline...</div>;
  }

  if (!data || data.events.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No timeline events yet.</div>;
  }

  // Group events by date
  const grouped: Record<string, TimelineEvent[]> = {};
  for (const event of data.events) {
    const dateKey = event.timestamp ? formatDate(event.timestamp) : 'Unknown';
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(event);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Summary */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--text-muted, #6c7086)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ArrowRightLeft size={10} style={{ color: '#89b4fa' }} />
          {data.eventCounts.transitions} transitions
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <GitCommitHorizontal size={10} style={{ color: '#a6e3a1' }} />
          {data.eventCounts.commits} commits
        </span>
      </div>

      {/* Timeline */}
      <div style={{
        maxHeight: '400px',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}>
        {Object.entries(grouped).map(([date, events]) => (
          <div key={date}>
            {/* Date header */}
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--text-muted, #6c7086)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              {date}
            </div>

            {/* Events for this date */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {events.map((event, i) => {
                const isLast = i === events.length - 1;
                const isCommitExpanded = event.type === 'commit' && expandedCommit === event.commit;

                return (
                  <div key={`${event.type}-${event.timestamp}-${i}`}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '11px',
                        padding: '3px 0',
                        cursor: event.type === 'commit' && event.files?.length ? 'pointer' : 'default',
                      }}
                      onClick={() => {
                        if (event.type === 'commit' && event.files?.length && event.commit) {
                          setExpandedCommit(isCommitExpanded ? null : event.commit);
                        }
                      }}
                    >
                      {/* Timeline connector */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '12px', flexShrink: 0 }}>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: getEventColor(event.type),
                          marginTop: '3px',
                          border: `2px solid ${getEventColor(event.type)}33`,
                        }} />
                        {!isLast && (
                          <div style={{ width: '1px', height: '14px', background: 'var(--border-color, #45475a)' }} />
                        )}
                      </div>

                      {/* Icon */}
                      <div style={{ marginTop: '2px', flexShrink: 0 }}>
                        {getEventIcon(event.type)}
                      </div>

                      {/* Time */}
                      <div style={{
                        width: '38px',
                        color: 'var(--text-muted, #6c7086)',
                        flexShrink: 0,
                        fontFamily: 'monospace',
                        fontSize: '10px',
                        marginTop: '1px',
                      }}>
                        {event.timestamp ? formatTime(event.timestamp) : ''}
                      </div>

                      {/* Description */}
                      <div style={{
                        flex: 1,
                        color: 'var(--text-secondary, #a6adc8)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {event.commit && (
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: '10px',
                            color: '#a6e3a1',
                            marginRight: '6px',
                            background: 'rgba(166, 227, 161, 0.1)',
                            padding: '1px 4px',
                            borderRadius: '3px',
                          }}>
                            {event.commit}
                          </span>
                        )}
                        {event.description}
                      </div>

                      {/* Expand indicator for commits with files */}
                      {event.type === 'commit' && event.files && event.files.length > 0 && (
                        <div style={{ flexShrink: 0, color: 'var(--text-muted)' }}>
                          {isCommitExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>
                      )}
                    </div>

                    {/* Expanded file list */}
                    {isCommitExpanded && event.files && (
                      <div style={{
                        marginLeft: '32px',
                        padding: '4px 8px',
                        background: 'var(--bg-tertiary, #313244)',
                        borderRadius: '4px',
                        marginBottom: '4px',
                      }}>
                        {event.files.map((file, fi) => (
                          <div key={fi} style={{
                            fontSize: '10px',
                            fontFamily: 'monospace',
                            color: 'var(--text-muted, #6c7086)',
                            padding: '1px 0',
                          }}>
                            {file}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
