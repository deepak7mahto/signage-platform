import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3,
  Building2,
  CalendarClock,
  ExternalLink,
  Film,
  LayoutGrid,
  ListVideo,
  LogOut,
  Monitor,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { WorkspaceScopeBanner } from './WorkspaceScopeBanner';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

export function AuthGuard() {
  const location = useLocation();
  const { data, isLoading, error } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.me,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return count < 1;
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Verifying session...
      </div>
    );
  }

  if (error || !data?.user) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    const nextParam = encodeURIComponent(target);
    return <Navigate to={`/login?next=${nextParam}`} replace />;
  }

  return <Outlet context={{ user: data.user }} />;
}

export function AppShell() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orgParam = searchParams.get('org');
  const { data } = useQuery({ queryKey: ['auth', 'me'], queryFn: api.me });

  const handleLogout = async () => {
    await api.logout();
    queryClient.clear();
    navigate('/login', { replace: true });
  };

  const navItems = [
    { to: '/screens', label: 'Screens', icon: Monitor },
    { to: '/sites', label: 'Sites & Profiles', icon: Building2 },
    { to: '/wall', label: 'Multi-Screen Wall', icon: LayoutGrid },
    { to: '/schedules', label: 'Schedules', icon: CalendarClock },
    { to: '/playlists', label: 'Playlists', icon: ListVideo },
    { to: '/media', label: 'Media Library', icon: Film },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
    { to: '/ops', label: 'Feeds, Triggers & 2FA', icon: Zap },
  ];

  const withScope = (to: string) => (orgParam ? `${to}?org=${encodeURIComponent(orgParam)}` : to);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            S
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">SignageOS</div>
            <div className="text-xs text-muted-foreground">4K Fleet Controller</div>
          </div>
        </div>

        <Separator />

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={withScope(item.to)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}

          <div className="pt-3">
            <Button variant="outline" size="sm" className="w-full justify-between" asChild>
              <a href="/sim/?hud=1" target="_blank" rel="noreferrer">
                <span>Launch Web Player</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </a>
            </Button>
          </div>
        </nav>

        <Separator />

        <div className="space-y-3 p-4">
          <div className="truncate text-xs text-muted-foreground">{data?.user.email}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl">
          <WorkspaceScopeBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
