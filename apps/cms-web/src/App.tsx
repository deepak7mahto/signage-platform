import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, AuthGuard } from './components/Layout';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { LoginPage } from './pages/LoginPage';
import { MediaPage } from './pages/MediaPage';
import { MultiScreenWallPage } from './pages/MultiScreenWallPage';
import { OperationsPage } from './pages/OperationsPage';
import { PlaylistDetailPage } from './pages/PlaylistDetailPage';
import { PlaylistsPage } from './pages/PlaylistsPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { ScreenDetailPage } from './pages/ScreenDetailPage';
import { ScreensPage } from './pages/ScreensPage';
import { SitesPage } from './pages/SitesPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Navigate to="/screens" replace />} />
              <Route path="/screens" element={<ScreensPage />} />
              <Route path="/screens/:id" element={<ScreenDetailPage />} />
              <Route path="/sites" element={<SitesPage />} />
              <Route path="/wall" element={<MultiScreenWallPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
              <Route path="/playlists" element={<PlaylistsPage />} />
              <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
              <Route path="/media" element={<MediaPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/audit-logs" element={<AuditLogsPage />} />
              <Route path="/ops" element={<OperationsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/screens" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
