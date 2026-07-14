/** Re-exports for outreach scripts — logic lives in fsa-proxy-shared.mjs */
export {
  getFsaProxyList,
  getFsaProxyUrl,
  rememberWorkingFsaProxy,
  playwrightLaunchOptions,
  playwrightProxyOptions,
  isSocksProxy,
} from "./fsa-proxy-shared.mjs";
