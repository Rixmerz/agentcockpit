import { useState, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import {
  onMediaStateChange,
  sendMediaCommand,
  type MediaState,
} from '../../services/browserService';

interface MediaControlBarProps {
  onTabFocus?: (tabId: string) => void;
}

export function MediaControlBar({ onTabFocus }: MediaControlBarProps) {
  const [mediaStates, setMediaStates] = useState<Map<string, MediaState>>(new Map());
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const [shouldMarquee, setShouldMarquee] = useState(false);

  // Setup media state listener
  useEffect(() => {
    onMediaStateChange((state) => {
      setMediaStates((prev) => {
        const newMap = new Map(prev);
        newMap.set(state.tabId, state);
        return newMap;
      });

      // Auto-focus on playing tab
      if (state.isPlaying) {
        setActiveTabId(state.tabId);
      }
    });
  }, []);

  // Check if title needs marquee effect
  useEffect(() => {
    if (titleRef.current) {
      const isOverflowing = titleRef.current.scrollWidth > titleRef.current.clientWidth;
      setShouldMarquee(isOverflowing);
    }
  }, [activeTabId, mediaStates]);

  // Get active media state
  const activeMedia = activeTabId ? mediaStates.get(activeTabId) : null;

  // Find any playing media if no active
  const displayMedia = activeMedia || Array.from(mediaStates.values()).find(s => s.isPlaying);

  if (!displayMedia) {
    return null;
  }

  const handlePlayPause = async () => {
    if (displayMedia) {
      await sendMediaCommand(displayMedia.tabId, 'toggle');
    }
  };

  const handleNext = async () => {
    if (displayMedia) {
      await sendMediaCommand(displayMedia.tabId, 'next');
    }
  };

  const handlePrev = async () => {
    if (displayMedia) {
      await sendMediaCommand(displayMedia.tabId, 'prev');
    }
  };

  const handleTitleClick = () => {
    if (displayMedia && onTabFocus) {
      onTabFocus(displayMedia.tabId);
    }
  };

  const getPlatformBadge = (platform: string) => {
    switch (platform) {
      case 'youtube-music':
        return 'YT Music';
      case 'youtube':
        return 'YouTube';
      default:
        return null;
    }
  };

  return (
    <div className="media-control-bar">
      <button
        className="media-btn"
        onClick={handlePrev}
        title="Previous"
      >
        <SkipBack size={14} />
      </button>

      <button
        className="media-btn media-btn-play"
        onClick={handlePlayPause}
        title={displayMedia.isPlaying ? 'Pause' : 'Play'}
      >
        {displayMedia.isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <button
        className="media-btn"
        onClick={handleNext}
        title="Next"
      >
        <SkipForward size={14} />
      </button>

      <div
        className="media-title-container"
        onClick={handleTitleClick}
        title={displayMedia.title}
      >
        {getPlatformBadge(displayMedia.platform) && (
          <span className="media-platform-badge">
            {getPlatformBadge(displayMedia.platform)}
          </span>
        )}
        <div className="media-title-wrapper">
          <div
            ref={titleRef}
            className={`media-title ${shouldMarquee ? 'marquee' : ''}`}
          >
            <span>{displayMedia.title}</span>
            {shouldMarquee && <span>{displayMedia.title}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
