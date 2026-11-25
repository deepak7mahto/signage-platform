import { ExternalLink, LayoutGrid, Monitor, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  EMERGENCY_SCHEDULE_NAME,
  type AspectClass,
  type TileStatusMessage,
  type WallScenario,
} from './scenarios';

interface WallTileCardProps {
  scenario: WallScenario;
  status?: TileStatusMessage;
  showHud: boolean;
  onSyncTile: (screenId: string) => void;
  setIframeRef: (el: HTMLIFrameElement | null) => void;
}

function renderAspectFrame(
  aspectClass: AspectClass,
  slot: string,
  name: string,
  showHud: boolean,
  setRef: (el: HTMLIFrameElement | null) => void,
) {
  const src = `/sim/?slot=${slot}&compact=1${showHud ? '&hud=1' : ''}`;
  if (aspectClass === 'portrait') {
    return (
      <div className="flex items-center justify-center border-t border-border bg-zinc-950 py-3">
        <div className="aspect-[9/16] h-[380px] overflow-hidden rounded-md border border-border shadow-lg">
          <iframe
            ref={setRef}
            title={`Web Player — ${name}`}
            src={src}
            className="h-full w-full border-0"
            allow="autoplay"
          />
        </div>
      </div>
    );
  }
  if (aspectClass === 'ultrawide') {
    return (
      <div className="flex items-center justify-center border-t border-border bg-zinc-950 px-3 py-6">
        <div className="aspect-[21/9] w-full overflow-hidden rounded-md border border-border">
          <iframe
            ref={setRef}
            title={`Web Player — ${name}`}
            src={src}
            className="h-full w-full border-0"
            allow="autoplay"
          />
        </div>
      </div>
    );
  }
  return (
    <div className="aspect-video w-full border-t border-border bg-black">
      <iframe
        ref={setRef}
        title={`Web Player — ${name}`}
        src={src}
        className="h-full w-full border-0"
        allow="autoplay"
      />
    </div>
  );
}

export function WallTileCard({
  scenario,
  status: st,
  showHud,
  onSyncTile,
  setIframeRef,
}: WallTileCardProps) {
  const isPaired = st?.state === 'paired';
  const liveSchedule = st?.scheduleName ?? null;
  const livePlaylist = st?.playlistName ?? null;
  const activeFitMode = st?.fitMode ?? scenario.layout.fitMode ?? 'contain';

  return (
    <Card className="overflow-hidden" data-wall-slot={scenario.slot}>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{st?.screenName || scenario.name}</span>
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{scenario.city}</span>
              <span>•</span>
              <span>{scenario.location}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isPaired && st.screenId && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onSyncTile(st.screenId!)}
                  title="Push instant WebSocket sync"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
                  <Link to={`/screens/${st.screenId}`}>Details</Link>
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
              <a
                href={`/sim/?slot=${scenario.slot}&hud=1`}
                target="_blank"
                rel="noreferrer"
                title="Open full-screen Web Player tab"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={isPaired && st.wsConnected ? 'success' : 'secondary'}>
            {isPaired ? (
              st.wsConnected ? (
                <>
                  <Wifi className="h-3 w-3" />
                  WSS Live
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  Syncing
                </>
              )
            ) : st?.code ? (
              `Code: ${st.code}`
            ) : (
              'Booting Player...'
            )}
          </Badge>

          <Badge variant="outline" className="font-mono text-[11px]">
            <LayoutGrid className="h-3 w-3" />
            {st?.layoutTemplate ?? scenario.layout.template}
          </Badge>

          <Badge variant="outline" className="font-mono text-[11px]">
            {scenario.aspectLabel} • {activeFitMode}
          </Badge>

          {isPaired && (
            <Badge
              variant={liveSchedule === EMERGENCY_SCHEDULE_NAME ? 'destructive' : 'secondary'}
              className="max-w-full truncate text-[11px]"
              data-tile-schedule={scenario.slot}
            >
              {liveSchedule
                ? `${liveSchedule} → ${livePlaylist ?? 'Idle'}`
                : `Fallback → ${livePlaylist ?? 'Unassigned'}`}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {renderAspectFrame(scenario.aspectClass, scenario.slot, scenario.name, showHud, setIframeRef)}
      </CardContent>
    </Card>
  );
}
