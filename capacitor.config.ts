import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chatbeaty.app',
  appName: 'ChatBeaty',
  webDir: 'dist',
  android: {
    backgroundColor: '#000000',
  },
  plugins: {
    Keyboard: {
      resize: 'body',
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
