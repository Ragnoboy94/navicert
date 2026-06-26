import Script from "next/script";
import { getSite } from "@/lib/content";

export function Chaport() {
  const site = getSite();
  const appId =
    site.analytics?.chaportAppId ||
    process.env.NEXT_PUBLIC_CHAPORT_APP_ID ||
    "";

  if (!appId) return null;

  return (
    <Script id="chaport-live-chat" strategy="afterInteractive">
      {`
        (function(w,d,v3){
          w.chaportConfig = { appId: '${appId}' };
          if(w.chaport)return;v3=w.chaport={};v3._q=[];v3._l={};v3.q=function(){v3._q.push(arguments)};v3.on=function(e,fn){if(!v3._l[e])v3._l[e]=[];v3._l[e].push(fn)};var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://app.chaport.ru/javascripts/insert.js';var ss=d.getElementsByTagName('script')[0];ss.parentNode.insertBefore(s,ss)
        })(window, document);
      `}
    </Script>
  );
}
