import type { Metadata } from "next";
import { getPrivacyText } from "@/lib/content";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description:
    "Соглашение на обработку персональных данных центра сертификации Нависерт.",
  robots: { index: true, follow: true },
};

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key++}>
          {listItems.map((item) => (
            <li key={item}>{item.replace(/^- /, "")}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  }

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flushList();
      elements.push(<h1 key={key++}>{line.slice(2)}</h1>);
    } else if (line.startsWith("**") && line.endsWith("**")) {
      flushList();
      elements.push(
        <p key={key++}>
          <strong>{line.slice(2, -2)}</strong>
        </p>
      );
    } else if (line.startsWith("- ")) {
      listItems.push(line);
    } else if (line.trim()) {
      flushList();
      elements.push(<p key={key++}>{line}</p>);
    }
  }
  flushList();
  return elements;
}

export default function PrivacyPage() {
  const text = getPrivacyText();

  return (
    <div className="section surface-white">
      <div className="prose-privacy mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        {renderMarkdown(text)}
      </div>
    </div>
  );
}
