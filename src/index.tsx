#!/usr/bin/env node
import { render } from 'ink';
import { loadConfig, usage } from './config.js';
import { App } from './ui/app.js';
import { resetScreen } from './ui/screen.js';

const VERSION = '0.1.0';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(usage);
  process.exit(0);
}
if (argv.includes('--version') || argv.includes('-v')) {
  console.log(`denpi ${VERSION}`);
  process.exit(0);
}

try {
  const config = loadConfig(argv);
  // clean screen with the prompt anchored to the bottom of the window
  resetScreen();
  render(<App config={config} />);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
