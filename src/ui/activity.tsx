import { Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { colors, waveFrames } from '../theme.js';

interface ActivityProps {
  label: string;
}

/** The animated signal wave shown while denpi is thinking or running a tool. */
export function Activity({ label }: ActivityProps): React.JSX.Element {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => value + 1), 100);
    return (): void => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color={colors.accent}>{waveFrames[frame % waveFrames.length]}</Text>
      <Text color={colors.dim}>
        {' '}
        {label} · esc to cancel
      </Text>
    </Text>
  );
}
