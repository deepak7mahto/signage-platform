import { KeyRound, Rss, Zap } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { FeedsPanel } from '../components/ops/FeedsPanel';
import { Security2faPanel } from '../components/ops/Security2faPanel';
import { TriggersPanel } from '../components/ops/TriggersPanel';

export function OperationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = rawTab === 'triggers' || rawTab === 'security' ? rawTab : 'feeds';

  const setTab = (tab: 'feeds' | 'triggers' | 'security') => {
    const next = new URLSearchParams(searchParams);
    if (tab === 'feeds') next.delete('tab');
    else next.set('tab', tab);
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feeds, Triggers & Security</h1>
        <p className="text-sm text-muted-foreground">
          Configure server-polled offline data feeds, real-time webhook playlist triggers, and account TOTP 2FA.
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setTab('feeds')}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
            activeTab === 'feeds' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
        >
          <Rss className="h-3.5 w-3.5" />
          Data Feeds
        </button>
        <button
          type="button"
          onClick={() => setTab('triggers')}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
            activeTab === 'triggers' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
        >
          <Zap className="h-3.5 w-3.5" />
          Event Triggers
        </button>
        <button
          type="button"
          onClick={() => setTab('security')}
          className={`flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-xs font-medium ${
            activeTab === 'security' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" />
          2FA Security
        </button>
      </div>

      {activeTab === 'feeds' && <FeedsPanel />}
      {activeTab === 'triggers' && <TriggersPanel />}
      {activeTab === 'security' && <Security2faPanel />}
    </div>
  );
}
