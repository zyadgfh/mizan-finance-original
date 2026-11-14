import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.mizan.finance",
  appName: "ميزان",
  webDir: "native-dist",
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_launcher",
      iconColor: "#0088ff",
    },
  },
};

export default config;
