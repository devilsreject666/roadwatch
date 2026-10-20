import type { CapacitorConfig } from '@capacitor/cli';
import { APP_ID, APP_NAME } from './src/config';

const config: CapacitorConfig = {
  appId: APP_ID,
  appName: APP_NAME,
  webDir: 'dist',
  backgroundColor: '#0b1220',
  android: {
    allowMixedContent: false,
  },
};

export default config;
