import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chatbeauty.app',
  appName: 'ChatBeauty',
  webDir: 'dist',
  android: {
    backgroundColor: '#000000',
  },
  plugins: {
    Keyboard: {
      resize: 'none',
      style: 'DARK',
    },
    StatusBar: {
      overlaysWebView: false,
      backgroundColor: '#000000',
      style: 'DARK',
    },
  },
};

export default config;
