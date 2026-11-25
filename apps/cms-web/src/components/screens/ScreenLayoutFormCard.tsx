import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Save } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  FitMode,
  LayoutTemplateType,
  Orientation,
  RotationDeg,
  Screen,
  SyncMode,
  TransitionType,
  VenueType,
} from '@signage/shared';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { api } from '../../lib/api';

interface ScreenLayoutFormCardProps {
  screen: Screen;
}

export function ScreenLayoutFormCard({ screen }: ScreenLayoutFormCardProps) {
  const queryClient = useQueryClient();
  const [city, setCity] = useState('');
  const [venueType, setVenueType] = useState<VenueType>('retail');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [slotDurationSec, setSlotDurationSec] = useState('15');
  const [programmaticFillUrl, setProgrammaticFillUrl] = useState('');
  const [layoutTemplate, setLayoutTemplate] = useState<LayoutTemplateType>('fullscreen');
  const [fitMode, setFitMode] = useState<FitMode>('contain');
  const [rotationDeg, setRotationDeg] = useState<RotationDeg>(0);
  const [transition, setTransition] = useState<TransitionType>('fade');
  const [syncMode, setSyncMode] = useState<SyncMode>('independent');
  const [tickerText, setTickerText] = useState('');
  const [sidebarTitle, setSidebarTitle] = useState('');
  const [sidebarLinesText, setSidebarLinesText] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setCity(screen.city ?? '');
    setVenueType(screen.venueType ?? 'retail');
    setOrientation(screen.orientation ?? 'landscape');
    setSlotDurationSec(String(screen.slotDurationSec ?? 15));
    setProgrammaticFillUrl(screen.programmaticFillUrl ?? '');
    setLayoutTemplate(screen.layout?.template ?? 'fullscreen');
    setFitMode(screen.layout?.fitMode ?? 'contain');
    setRotationDeg(screen.layout?.rotationDeg ?? 0);
    setTransition(screen.layout?.transition ?? 'fade');
    setSyncMode(screen.layout?.syncMode ?? 'independent');
    setTickerText(screen.layout?.tickerText ?? '');
    setSidebarTitle(screen.layout?.sidebarTitle ?? '');
    setSidebarLinesText((screen.layout?.sidebarLines ?? []).join('\n'));
  }, [screen]);

  const saveConfigMutation = useMutation({
    mutationFn: () =>
      api.updateScreen(screen.id, {
        city: city.trim() || null,
        venueType,
        orientation,
        slotDurationSec: Math.max(5, Math.min(300, Number(slotDurationSec) || 15)),
        programmaticFillUrl: programmaticFillUrl.trim() || null,
        layout: {
          template: layoutTemplate,
          fitMode,
          rotationDeg,
          transition,
          syncMode,
          tickerText: tickerText.trim() || null,
          sidebarTitle: sidebarTitle.trim() || null,
          sidebarLines: sidebarLinesText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 12),
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens', screen.id] });
      setSavedNotice('Layout & inventory saved and pushed to display.');
      setTimeout(() => setSavedNotice(null), 3500);
    },
  });

  const handleSaveConfig = (e: FormEvent) => {
    e.preventDefault();
    saveConfigMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
          Multi-Zone Layout & DOOH Inventory
        </CardTitle>
        <CardDescription>
          Configure split-screen overlays, fit modes, transitions, clock sync, and programmatic inventory metadata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Layout Template</Label>
              <Select value={layoutTemplate} onValueChange={(v) => setLayoutTemplate(v as LayoutTemplateType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fullscreen">Fullscreen Video / Image</SelectItem>
                  <SelectItem value="bottom_ticker">Main + Bottom Ticker</SelectItem>
                  <SelectItem value="split_sidebar">Split Sidebar (Auto-Reflows Portrait)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Media Fit Mode</Label>
              <Select value={fitMode} onValueChange={(v) => setFitMode(v as FitMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contain">Contain (Fit / No Crop)</SelectItem>
                  <SelectItem value="cover">Cover (Fill Frame)</SelectItem>
                  <SelectItem value="blur_fill">Blur Fill (Ambient Backdrop)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Hardware Rotation</Label>
              <Select value={String(rotationDeg)} onValueChange={(v) => setRotationDeg(Number(v) as RotationDeg)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0° (Standard)</SelectItem>
                  <SelectItem value="90">90° Clockwise (Portrait Mount)</SelectItem>
                  <SelectItem value="180">180° (Inverted Mount)</SelectItem>
                  <SelectItem value="270">270° (Counter-Clockwise)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Transition Animation</Label>
              <Select value={transition} onValueChange={(v) => setTransition(v as TransitionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Instant Cut (None)</SelectItem>
                  <SelectItem value="fade">Smooth Crossfade</SelectItem>
                  <SelectItem value="slide_left">Slide Left</SelectItem>
                  <SelectItem value="zoom">Cinema Zoom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Multi-Screen Sync</Label>
              <Select value={syncMode} onValueChange={(v) => setSyncMode(v as SyncMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="independent">Independent Loop</SelectItem>
                  <SelectItem value="clock_sync">Mall / Wall Clock Sync</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inv-city">City</Label>
              <Input
                id="inv-city"
                type="text"
                placeholder="e.g. New Delhi"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Venue Type</Label>
              <Select value={venueType} onValueChange={(v) => setVenueType(v as VenueType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retail">Retail</SelectItem>
                  <SelectItem value="clinic">Clinic / Hospital</SelectItem>
                  <SelectItem value="transit">Transit</SelectItem>
                  <SelectItem value="highway">Highway DOOH</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Orientation & Slot (s)</Label>
              <div className="flex gap-2">
                <Select value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="landscape">Landscape</SelectItem>
                    <SelectItem value="portrait">Portrait</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={5}
                  max={300}
                  value={slotDurationSec}
                  onChange={(e) => setSlotDurationSec(e.target.value)}
                  className="w-20"
                />
              </div>
            </div>
          </div>

          {layoutTemplate === 'bottom_ticker' && (
            <div className="space-y-1.5">
              <Label htmlFor="layout-ticker">Bottom Ticker Text</Label>
              <Input
                id="layout-ticker"
                type="text"
                placeholder="Welcome to City Care Clinic • Pharmacy open until 9 PM"
                value={tickerText}
                onChange={(e) => setTickerText(e.target.value)}
              />
            </div>
          )}

          {layoutTemplate === 'split_sidebar' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="layout-sidebar-title">Sidebar Title</Label>
                <Input
                  id="layout-sidebar-title"
                  type="text"
                  placeholder="OPD Token Queue"
                  value={sidebarTitle}
                  onChange={(e) => setSidebarTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="layout-sidebar-lines">Sidebar Lines (one per row)</Label>
                <textarea
                  id="layout-sidebar-lines"
                  rows={3}
                  placeholder={'Dr. Sharma — Room 102 • Token #14\nDr. Verma — Room 105 • Token #09'}
                  value={sidebarLinesText}
                  onChange={(e) => setSidebarLinesText(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="inv-vast">Programmatic SSP / VAST Fill URL (optional)</Label>
            <Input
              id="inv-vast"
              type="url"
              placeholder="https://ssp.example.com/vast?screen_id=..."
              value={programmaticFillUrl}
              onChange={(e) => setProgrammaticFillUrl(e.target.value)}
            />
          </div>

          {savedNotice && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-300">
              {savedNotice}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={saveConfigMutation.isPending}>
              <Save className="h-4 w-4" />
              {saveConfigMutation.isPending ? 'Saving...' : 'Save & Push Layout'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
