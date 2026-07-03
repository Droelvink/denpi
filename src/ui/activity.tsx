import { Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { colors, spinnerFrames } from '../theme.js';

interface ActivityProps {
  label: string;
}

/** The calm spinner shown while clover is thinking or running a tool. */
export function Activity({ label }: ActivityProps): React.JSX.Element {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => value + 1), 100);
    return (): void => clearInterval(timer);
  }, []);

  return (
    <Text>
      <Text color={colors.accent}>{spinnerFrames[frame % spinnerFrames.length]}</Text>
      <Text color={colors.dim}>
        {' '}
        {label} · esc to cancel
      </Text>
    </Text>
  );
}
