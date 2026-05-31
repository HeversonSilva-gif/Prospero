import type { AccountSnapshot, TweetSnapshot } from "./x-metrics-repository.js";

export type XInsightsData = {
  accountSeries: AccountSnapshot[]; // oldest → newest
  posts: Array<{ tweetId: string; text: string; metric: TweetSnapshot | null }>;
};

const engagement = (m: TweetSnapshot): number => m.likes + m.replies + m.reposts + m.quotes;

// Pure "what's working" digest derived from the ingested X metrics. Markdown
// string the posting agent reads before composing. Never throws; empty data →
// a clear no-data message.
export const buildXInsights = (data: XInsightsData): string => {
  const hasAccount = data.accountSeries.length > 0;
  const withMetric = data.posts.filter(
    (p): p is { tweetId: string; text: string; metric: TweetSnapshot } => p.metric !== null,
  );
  if (!hasAccount && withMetric.length === 0) {
    return "Sem dados de X ainda — poste e aguarde a coleta de métricas para receber insights.";
  }

  const lines: string[] = ["# X — o que está funcionando", ""];

  if (hasAccount) {
    const first = data.accountSeries[0]!;
    const last = data.accountSeries[data.accountSeries.length - 1]!;
    const delta = last.followers - first.followers;
    const sign = delta >= 0 ? `+${delta}` : `${delta}`;
    lines.push(`Seguidores: ${last.followers} (${sign} na janela).`, "");
  }

  if (withMetric.length > 0) {
    const top = [...withMetric]
      .sort((a, b) => engagement(b.metric) - engagement(a.metric))
      .slice(0, 5);
    lines.push("Posts com melhor engajamento:");
    for (const p of top) {
      const m = p.metric;
      const snippet = p.text.length > 80 ? `${p.text.slice(0, 80)}…` : p.text;
      lines.push(
        `- "${snippet}" — ${engagement(m)} interações (${m.likes}❤ ${m.replies}💬 ${m.reposts}🔁 ${m.quotes}❝), ${m.impressions} impressões.`,
      );
    }
    lines.push("", "Use os padrões dos que funcionaram (tema, formato, gancho) ao compor.");
  }

  return lines.join("\n");
};
