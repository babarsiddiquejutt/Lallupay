import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lalupay.app',
  appName: 'LaluPay',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#000000',
      showSpinner: true,
      spinnerColor: '#38bdf8',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#000000',
    },
    App: {
      // Handle deep links
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK',
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#000000',
  },
};

export default config;
