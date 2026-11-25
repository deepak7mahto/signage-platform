import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import type { Orientation, Playlist, Screen, VenueType } from '@signage/shared';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { api } from '../../lib/api';

const NONE_VALUE = '__none__';

const VENUE_OPTIONS: Array<{ value: VenueType; label: string }> = [
  { value: 'retail', label: 'Retail / Mall' },
  { value: 'clinic', label: 'Clinic / Hospital' },
  { value: 'transit', label: 'Transit / Airport' },
  { value: 'highway', label: 'Highway / DOOH' },
  { value: 'corporate', label: 'Corporate Lobby' },
  { value: 'other', label: 'Other' },
];

interface EditScreenDialogProps {
  screen: Screen | null;
  playlists: Playlist[];
  onClose: () => void;
}

export function EditScreenDialog({ screen, playlists, onClose }: EditScreenDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [city, setCity] = useState('');
  const [venueType, setVenueType] = useState<string>(NONE_VALUE);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [activePlaylistId, setActivePlaylistId] = useState(NONE_VALUE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!screen) return;
    setName(screen.name);
    setLocation(screen.location ?? '');
    setCity(screen.city ?? '');
    setVenueType(screen.venueType ?? NONE_VALUE);
    setTimezone(screen.timezone || 'UTC');
    setOrientation(screen.orientation ?? 'landscape');
    setActivePlaylistId(screen.activePlaylistId ?? NONE_VALUE);
    setError(null);
  }, [screen]);

  const mutation = useMutation({
    mutationFn: (id: string) =>
      api.updateScreen(id, {
        name: name.trim(),
        location: location.trim() || null,
        city: city.trim() || null,
        venueType: venueType === NONE_VALUE ? null : (venueType as VenueType),
        timezone: timezone.trim() || 'UTC',
        orientation,
        activePlaylistId: activePlaylistId === NONE_VALUE ? null : activePlaylistId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['screens'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update screen');
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!screen) return;
    mutation.mutate(screen.id);
  };

  return (
    <Dialog open={Boolean(screen)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Screen</DialogTitle>
          <DialogDescription>
            Update display name, venue location, orientation, and fallback playlist.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-screen-name">Screen Name *</Label>
            <Input
              id="edit-screen-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-screen-location">Location</Label>
              <Input
                id="edit-screen-location"
                type="text"
                placeholder="Main Atrium Floor 1"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-screen-city">City</Label>
              <Input
                id="edit-screen-city"
                type="text"
                placeholder="Mumbai"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Venue Type</Label>
              <Select value={venueType} onValueChange={setVenueType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— Unspecified —</SelectItem>
                  {VENUE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-screen-tz">Timezone</Label>
              <Input
                id="edit-screen-tz"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Orientation</Label>
              <Select value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="landscape">Landscape (16:9)</SelectItem>
                  <SelectItem value="portrait">Portrait (9:16)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Fallback Playlist</Label>
              <Select value={activePlaylistId} onValueChange={setActivePlaylistId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>— None —</SelectItem>
                  {playlists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
