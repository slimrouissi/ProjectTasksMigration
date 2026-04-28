/**
 * Live log of migration operations (auto-scrolling)
 */

import { useRef, useEffect } from 'react';
import {
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import { MigrationLogEntry } from '../../types/ui';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    maxHeight: '300px',
    overflow: 'auto',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingVerticalS,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: tokens.fontSizeBase200,
  },
  entry: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    padding: '2px 4px',
  },
  timestamp: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  info: {
    color: tokens.colorNeutralForeground1,
  },
  warn: {
    color: tokens.colorPaletteYellowForeground1,
  },
  error: {
    color: tokens.colorPaletteRedForeground1,
  },
  success: {
    color: tokens.colorPaletteGreenForeground1,
  },
});

interface OperationSetLogProps {
  logs: MigrationLogEntry[];
}

export function OperationSetLog({ logs }: OperationSetLogProps) {
  const styles = useStyles();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs.length]);

  const getLevelStyle = (level: MigrationLogEntry['level']) => {
    switch (level) {
      case 'warn': return styles.warn;
      case 'error': return styles.error;
      case 'success': return styles.success;
      default: return styles.info;
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div>
      <Text weight="semibold" size={400}>Migration Log</Text>
      <div ref={containerRef} className={styles.container}>
        {logs.map((entry, idx) => (
          <div key={idx} className={styles.entry}>
            <span className={styles.timestamp}>[{formatTime(entry.timestamp)}]</span>
            <span className={getLevelStyle(entry.level)}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
