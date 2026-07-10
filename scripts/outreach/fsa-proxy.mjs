/** Re-exports for outreach scripts — logic lives in fsa-proxy-shared.mjs */
export {
  getFsaProxyList,
  getFsaProxyUrl,
  rememberWorkingFsaProxy,
  playwrightLaunchOptions,
  playwrightProxyOptions,
  isPaidProxy,
  isSocksProxy,
} from "./fsa-proxy-shared.mjs";
